import type { BankState } from '../domain/bankState';
import './DecisionControls.css';
import { Department } from '../game/departments';
import type { CapitalMarketsInstrument } from '../domain/capitalMarkets';
import { buildLatestCapitalMarketsReceipt, type CapitalMarketsPlanImpact, type PlayerCapitalMarketsQuote } from '../presentation/quotes';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { formatCurrency, formatPct } from '../utils/formatters';
import { parseMoneyInput } from '../utils/parsers';
import {
  capitalMarketsInstrumentsForArea,
  choicesForFormField,
  FORM_FIELDS_BY_DEPARTMENT,
  updateActionFormFields,
  type ActionFormField,
  type ActionFormState,
} from '../application/playerControls';
export type { Department } from '../game/departments';
export type { ActionFormState } from '../application/playerControls';

export type TransactionKind = 'capitalMarkets' | 'giltTrade' | 'boeFunding' | 'hedge';

export interface QueuedTransactionSummary {
  id: number;
  kind: TransactionKind;
  label: string;
}

interface Props {
  department: Department;
  bankState?: BankState;
  state: ActionFormState;
  onChange: (s: ActionFormState) => void;
  disabled?: boolean;
  errors?: Partial<Record<keyof ActionFormState,string>>;
  hasValidationErrors?: boolean;
  giltQuotedYield?: number;
  capitalMarketsQuote?: PlayerCapitalMarketsQuote;
  capitalMarketsPlanImpact?: CapitalMarketsPlanImpact;
  maxGiltSaleAmount?: number;
  maxBoeFundingAmount?: number;
  queuedTransactions?: QueuedTransactionSummary[];
  onQueueTransaction?: (kind: TransactionKind) => void;
  onCancelQueuedTransaction?: (id: number) => void;
}

interface FieldProps {
  label: string;
  hint: string;
  field: keyof ActionFormState;
  state: ActionFormState;
  update: (key:keyof ActionFormState,value:string)=>void;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
}

const Field = ({label,hint,field,state,update,disabled,error,placeholder}:FieldProps) => (
  <label className="field">
    <strong>{label}</strong>
    <input inputMode="decimal" value={state[field]} disabled={disabled} aria-invalid={!!error} onChange={e=>update(field,e.target.value)} placeholder={placeholder}/>
    {hint&&<small>{hint}</small>}
    {error&&<span role="alert">{error}</span>}
  </label>
);

const percentageDisplay = (raw: string): string => {
  const text = raw.trim().toLowerCase();
  if (text.endsWith('%')) return text.slice(0,-1);
  if (text.endsWith('pct')) return text.slice(0,-3);
  if (text.endsWith('bps')) {
    const bps=Number(text.slice(0,-3));
    return Number.isFinite(bps) ? String(bps/100) : raw;
  }
  return raw;
};

const PercentageField = ({label,hint,field,state,update,disabled,error,max=100}:{label:string;hint:string;field:keyof ActionFormState;state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;error?:string;max?:number}) => (
  <label className="field">
    <strong>{label}</strong>
    <div className="input-with-suffix"><input type="number" inputMode="decimal" step="0.01" min="0" max={max} value={percentageDisplay(state[field])} disabled={disabled} aria-invalid={!!error} onChange={e=>{if(e.target.value!=='')update(field,`${e.target.value}%`);}}/><span aria-hidden="true">%</span></div>
    {hint&&<small>{hint}</small>}
    {error&&<span role="alert">{error}</span>}
  </label>
);

const RatioField = ({label,field,state,update,disabled,error}:{label:string;hint?:string;field:keyof ActionFormState;state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;error?:string}) => (
  <div className="field selectivity-control">
    <strong>{label}</strong>
    <div className="selectivity-inputs"><input aria-label={`${label} slider`} type="range" min="0" max="1" step="0.05" value={state[field]} disabled={disabled} onChange={e=>update(field,e.target.value)}/><input aria-label={`${label} exact value`} type="number" inputMode="decimal" step="0.05" min="0" max="1" value={state[field]} disabled={disabled} aria-invalid={!!error} onChange={e=>{if(e.target.value!=='')update(field,e.target.value);}}/></div>
    <div className="selectivity-labels"><span>Loose</span><span>Balanced</span><span>Tight</span></div>
    {error&&<span role="alert">{error}</span>}
  </div>
);

const RateComparison = ({offer,market}:{offer:string;market?:number}) => {
  if(market===undefined)return null;
  const rate=Number(percentageDisplay(offer))/100;
  const gap=Math.round((rate-market)*10000);
  return <div className="rate-comparison"><span>Market <strong>{formatPct(market)}</strong></span><strong>{Number.isFinite(gap)?gap===0?'At market':`${Math.abs(gap)}bp ${gap>0?'above':'below'} market`:'Enter a rate'}</strong></div>;
};
const moneyMillions=(value:number)=>`£${(value/1e6).toFixed(2)}m`;

const editableMoney = (amount:number):string => amount>=1e9?`${(amount/1e9).toFixed(2).replace(/\.00$/,'')}bn`:`${(amount/1e6).toFixed(1).replace(/\.0$/,'')}m`;
const MoneyField = ({label,hint,field,state,update,disabled,error,placeholder,maxAmount}:{label:string;hint:string;field:keyof ActionFormState;state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;error?:string;placeholder?:string;maxAmount?:number}) => {
  const capacityHint=maxAmount!==undefined&&Number.isFinite(maxAmount)?`${hint} Maximum executable now: ${formatCurrency(Math.max(0,maxAmount))}.`:hint;
  return <label className="field">
    <strong>{label}</strong>
    <div className="money-input-row"><input inputMode="decimal" value={state[field]} disabled={disabled} aria-invalid={!!error} onChange={e=>update(field,e.target.value)} onBlur={()=>{if(maxAmount===undefined)return;const parsed=parseMoneyInput(state[field]);if(parsed.value!==undefined&&parsed.value>maxAmount)update(field,editableMoney(Math.max(0,maxAmount)));}} placeholder={placeholder}/>{maxAmount!==undefined&&maxAmount>0&&!disabled&&<button type="button" className="button ghost" onClick={()=>update(field,editableMoney(maxAmount))}>Max</button>}</div>
    <small>{capacityHint}</small>
    {error&&<span role="alert">{error}</span>}
  </label>;
};

const FIELD_LABELS: Partial<Record<keyof ActionFormState,string>> = {
  retailCurrentAccountRate:'Retail current account rate', termDepositRate:'Fixed-term savings offer', corporateDepositRate:'SME/business deposit offer',
  mortgageRate:'Mortgage new rate', consumerLoanRate:'Personal-credit new rate', corporateLoanRate:'SME/business new rate',
  mortgageUnderwritingTightness:'Mortgage selectivity', consumerUnderwritingTightness:'Personal-credit selectivity', corporateUnderwritingTightness:'SME/business selectivity',
  capitalMarketsTargetAmount:'Capital-markets target amount', capitalMarketsMaxDiscount:'Maximum equity discount', capitalMarketsMaxSpreadBps:'Maximum spread',
  boeFundingAmount:'BoE drawing amount', hedgeNotional:'Swap notional', hedgeFixedRate:'Swap fixed rate', dividendPayoutRatio:'Profit payout',
  giltTradeAmount:'Gilt trade amount',
};

const tenorLabel = (months: number): string => months % 12 === 0 ? `${months / 12} years` : `${months} months`;
const yearLabel = (months: number): string => `${months / 12} ${months === 12 ? 'year' : 'years'}`;
const choiceLabel = (field: ActionFormField, value: string | number): string => {
  switch (field) {
    case 'termDepositTenorMonths':
    case 'mortgageFixedPeriodMonths':
    case 'hedgeMaturityMonths': return yearLabel(Number(value));
    case 'mortgageMaxLtv': return `${(Number(value) * 100).toFixed(0)}%`;
    case 'giltDurationYears': return `${value} years`;
    case 'giltTradeDirection': return value === 'buy' ? 'Buy gilts' : 'Sell gilts';
    case 'boeFacility': return value === 'STR' ? 'STR · 1 week / Level A collateral' : 'ILTR · 6 months';
    case 'hedgeDirection': return value === 'payFixedReceiveFloat' ? 'Pay fixed, receive floating' : 'Receive fixed, pay floating';
    default: return String(value);
  }
};

const CapitalMarketsTicket = ({state,onChange,disabled,errors,quote,planImpact,allowedInstruments,title,otherArea,bankState,queuedTransactions,onQueueTransaction}:{bankState?:BankState;state:ActionFormState;onChange:(s:ActionFormState)=>void;disabled?:boolean;errors?:Partial<Record<keyof ActionFormState,string>>;quote?:PlayerCapitalMarketsQuote;planImpact?:CapitalMarketsPlanImpact;allowedInstruments:CapitalMarketsInstrument[];title:string;otherArea:string;queuedTransactions:QueuedTransactionSummary[];onQueueTransaction:()=>void}) => {
  const update=(key:keyof ActionFormState,value:string)=>onChange(updateActionFormFields(state,{[key]:value}));
  const queuedInstrument = state.capitalMarketsInstrument;
  const instrument = queuedInstrument !== 'none' && allowedInstruments.includes(queuedInstrument) ? queuedInstrument : 'none';
  const queuedElsewhere = queuedInstrument !== 'none' && instrument === 'none';
  const definition = instrument === 'none' ? undefined : getCapitalMarketsInstrument(instrument);
  const isDiscountPriced = definition?.pricingKind === 'discount';
  const tenors = definition?.permittedTenorMonths ?? [];
  const selectInstrument=(value:string)=>onChange(updateActionFormFields(state,{capitalMarketsInstrument:value as ActionFormState['capitalMarketsInstrument']}));
  const validOrder=Boolean(definition&&((parseMoneyInput(state.capitalMarketsTargetAmount).value??0)>0)&&!Object.entries(errors??{}).some(([key,value])=>key.startsWith('capitalMarkets')&&value));
  const transactionAlreadyQueued=queuedTransactions.some(transaction=>transaction.kind==='capitalMarkets');
  const latestTransaction=bankState?.capitalMarkets?.transactions.filter(t=>allowedInstruments.includes(t.instrument)).at(-1);
  const receipt=buildLatestCapitalMarketsReceipt(bankState,allowedInstruments);
  return <section className="policy-disclosure capital-markets-ticket" aria-label="Capital markets">
    <div className="policy-section-title"><h3>{title}</h3><span className="order-status">{definition?(validOrder?'Draft · not queued':'Draft · enter valid terms'):transactionAlreadyQueued?'Queued for next close':'No transaction drafted'}</span></div>
    {queuedElsewhere&&<div className="alert info"><strong>{getCapitalMarketsInstrument(queuedInstrument as CapitalMarketsInstrument).label} is drafted in {otherArea}.</strong><div className="muted">Switch areas to queue or discard this draft.</div></div>}{transactionAlreadyQueued&&!definition&&<p className="order-status">Remove the queued order above before adding another capital-markets transaction.</p>}
    <div className="policy-fields policy-fields-primary">
      <label className="field"><strong>Instrument</strong><select value={instrument} disabled={disabled||queuedElsewhere||transactionAlreadyQueued} onChange={e=>selectInstrument(e.target.value)}><option value="none">Select an instrument</option>{allowedInstruments.map(key => { const item=getCapitalMarketsInstrument(key); return <option key={key} value={key}>{item.label}</option>; })}</select></label>
      <MoneyField field="capitalMarketsTargetAmount" label="Target size (£)" hint="" state={state} update={update} disabled={disabled||queuedElsewhere||transactionAlreadyQueued||!definition} error={errors?.capitalMarketsTargetAmount} placeholder="e.g. 150m"/>
      {isDiscountPriced
        ? <PercentageField field="capitalMarketsMaxDiscount" label="Maximum acceptable discount" hint="" state={state} update={update} disabled={disabled||queuedElsewhere||transactionAlreadyQueued||!definition} error={errors?.capitalMarketsMaxDiscount}/>
        : <Field field="capitalMarketsMaxSpreadBps" label="Maximum acceptable spread (bp)" hint="" state={state} update={update} disabled={disabled||queuedElsewhere||transactionAlreadyQueued||!definition} error={errors?.capitalMarketsMaxSpreadBps} placeholder="e.g. 750"/>}
      {tenors.length>0&&<label className="field"><strong>Tenor</strong><select value={state.capitalMarketsTenorMonths} disabled={disabled||queuedElsewhere||transactionAlreadyQueued||!definition} onChange={e=>update('capitalMarketsTenorMonths',e.target.value)}>{tenors.map(tenor=><option key={tenor} value={tenor}>{tenorLabel(tenor)}</option>)}</select></label>}
    </div>
    {definition&&quote&&<div className={`capital-markets-book ${quote.status.startsWith('failed')?'warning':'info'}`}>
      <div className="forecast-heading"><strong>Indicative book · {quote.label}</strong><span>{quote.statusLabel}</span></div>
      <dl className="deal-flow"><div><dt>Requested</dt><dd>{quote.targetAmount}</dd></div><div><dt>Expected fill</dt><dd>{quote.executedAmount}</dd></div><div><dt>Net proceeds</dt><dd>{quote.netProceeds}</dd></div></dl>
      <div className="book-coverage"><span>Investor demand {quote.demandAmount}</span><strong>{quote.coverageRatio}× coverage</strong><progress aria-label="Investor demand coverage" max="2" value={Math.min(2,Number(quote.coverageRatio))}/></div>
      <dl className="deal-details">
        {isDiscountPriced?<><div><dt>Clearing discount</dt><dd>{quote.clearingDiscount}</dd></div><div><dt>Expected issue price</dt><dd>{quote.issuePrice}</dd></div><div><dt>Ownership dilution</dt><dd>{quote.ownershipDilution}</dd></div></>:<><div><dt>Clearing spread</dt><dd>{quote.clearingSpreadBps}</dd></div>{quote.allInYield!==undefined&&<><div><dt>Expected all-in yield</dt><dd>{quote.allInYield}</dd></div><div><dt>Annual coupon cost</dt><dd>{quote.annualCouponCost}</dd></div></>}</>}
        <div><dt>Fees</dt><dd>{quote.fees}</dd></div>
        {quote.equityPostIssueRoe!==undefined&&<div><dt>Post-raise ROE proxy</dt><dd>{quote.equityPostIssueRoe}</dd></div>}
        {quote.equityPostIssueDps!==undefined&&<div><dt>Expected dividend/share</dt><dd>{quote.equityPostIssueDps}</dd></div>}
        {quote.equityExpectedReturn!==undefined&&<div><dt>Expected total return proxy</dt><dd>{quote.equityExpectedReturn}</dd></div>}
        {quote.equityCostOfEquity!==undefined&&<div><dt>Cost of equity</dt><dd>{quote.equityCostOfEquity}</dd></div>}
        {quote.equityReturnDemandFactor!==undefined&&<div><dt>Investor demand factor</dt><dd>{quote.equityReturnDemandFactor}</dd></div>}
      </dl>
      {quote.equityPostIssueRoe!==undefined&&<small>ROE estimate assumes proceeds earn the cash reserve rate.</small>}
      {quote.recentIssuanceNotice&&<small>Recent issuance reduces capacity and worsens terms.</small>}
    </div>}
    {receipt&&<details className="transaction-receipt"><summary>Last execution · {receipt.label} · {receipt.statusLabel}</summary><dl className="deal-details"><div><dt>Date</dt><dd>{receipt.date}</dd></div><div><dt>Executed</dt><dd>{receipt.executedAmount}</dd></div><div><dt>Net proceeds</dt><dd>{receipt.netProceeds}</dd></div><div><dt>Fees</dt><dd>{receipt.fees}</dd></div></dl></details>}
    {definition&&planImpact&&<div className="capital-markets-plan-impact"><strong>Three-Year Plan impact</strong><div className="muted">If queued, one-month preview: CET1 {formatPct(planImpact.cet1Before)} → {formatPct(planImpact.cet1After)} · EPS {(planImpact.epsBefore*100).toFixed(1)}p → {(planImpact.epsAfter*100).toFixed(1)}p.</div></div>}
    {definition&&<><button type="button" className="button primary" disabled={disabled||!validOrder||transactionAlreadyQueued||queuedElsewhere} onClick={onQueueTransaction}>Queue transaction</button><button type="button" className="button ghost" disabled={disabled} onClick={()=>onChange({...state,capitalMarketsInstrument:'none',capitalMarketsTargetAmount:''})}>Discard draft</button></>}

  </section>;
};

export default function ActionsPanel({department,bankState,state,onChange,disabled,errors,hasValidationErrors,giltQuotedYield,capitalMarketsQuote,capitalMarketsPlanImpact,maxGiltSaleAmount,maxBoeFundingAmount,queuedTransactions=[],onQueueTransaction=()=>{},onCancelQueuedTransaction=()=>{}}:Props) {
  const update=(key:keyof ActionFormState,value:string)=>onChange(updateActionFormFields(state,{[key]:value}));
  const localFields=FORM_FIELDS_BY_DEPARTMENT[department];
  const firstError = Object.entries(errors ?? {}).find(([field,message]) => !!message&&localFields.includes(field as keyof ActionFormState)) as [keyof ActionFormState,string] | undefined;
  const hasLocalValidationErrors=Boolean(firstError);
  const treasuryCapitalInstruments=capitalMarketsInstrumentsForArea('Treasury');
  const capitalInstruments=capitalMarketsInstrumentsForArea('Capital');
  const localCapitalQueued=department==='Capital'?capitalInstruments.includes(state.capitalMarketsInstrument as CapitalMarketsInstrument):treasuryCapitalInstruments.includes(state.capitalMarketsInstrument as CapitalMarketsInstrument);
  const setGiltDirection=(value:ActionFormState['giltTradeDirection'])=>onChange(updateActionFormFields(state,{giltTradeDirection:value}));
  const setBoeFacility=(value:ActionFormState['boeFacility'])=>onChange(updateActionFormFields(state,{boeFacility:value}));
  const setHedgeDirection=(value:ActionFormState['hedgeDirection'])=>onChange(updateActionFormFields(state,{hedgeDirection:value}));
  const transactionAlreadyQueued=(kind:TransactionKind)=>queuedTransactions.some(transaction=>transaction.kind===kind);

  return <div className="stack department-policy-panel">
    <div className="policy-section-title"><h3>{department==='Treasury'?'Treasury actions':'Standing policy'}</h3></div>
    {queuedTransactions.length>0&&<section className="alert info queued-transaction-summary" aria-label="Queued transactions for next close" role="status"><strong>{queuedTransactions.length===1?'Transaction':'Transactions'} queued for next close</strong><p>They will execute once when you roll the game forward one month.</p><ul>{queuedTransactions.map(transaction=><li key={transaction.id}><span>{transaction.label}</span><button type="button" className="button ghost" onClick={()=>onCancelQueuedTransaction(transaction.id)}>Remove</button></li>)}</ul></section>}
    {hasLocalValidationErrors && <div role="alert" className="alert danger">Fix this management area's invalid input before advancing time.{firstError && <> <strong>{FIELD_LABELS[firstError[0]] ?? firstError[0]}:</strong> {firstError[1]}</>}</div>}

    {department==='Customers'&&<div className="decision-product-grid" aria-label="Deposit product policies">
      {([
        ['retailCurrentAccountRate','Retail current accounts','Retail current account rate',bankState?.market.competitorRetailCurrentAccountRate,'Everyday, accessible balances'],
        ['termDepositRate','Fixed-term savings','Fixed-term savings offer',bankState?.market.competitorTermDepositRate,'Lock in funding and its cost'],
        ['corporateDepositRate','Business deposits','SME/business deposit offer',bankState?.market.competitorCorporateDepositRate??bankState?.market.competitorRetailCurrentAccountRate,'More sensitive to competing offers'],
      ] as const).map(([field,title,label,market])=><section className="decision-product-card" key={field} aria-label={title}>
        <header><h4>{title}</h4></header>
        <PercentageField field={field} label={label} hint="" state={state} update={update} disabled={disabled} error={errors?.[field]}/>
        <RateComparison offer={state[field]} market={market}/>
        {field==='termDepositRate'&&<label className="field"><strong>Term</strong><select value={state.termDepositTenorMonths} disabled={disabled} onChange={e=>update('termDepositTenorMonths',e.target.value)}>{choicesForFormField('termDepositTenorMonths').map(value=><option value={String(value)} key={value}>{choiceLabel('termDepositTenorMonths',value)}</option>)}</select><small>Market comparison uses the 1-year benchmark.</small></label>}
      </section>)}
    </div>}

    {department==='Lending'&&<div className="decision-product-grid" aria-label="Lending product policies">
      {([
        ['mortgageRate','mortgageUnderwritingTightness','Mortgages',bankState?.market.competitorMortgageRate,'Low loss · long duration'],
        ['consumerLoanRate','consumerUnderwritingTightness','Personal credit',bankState?.market.competitorConsumerLoanRate,'Higher yield · higher loss'],
        ['corporateLoanRate','corporateUnderwritingTightness','SME & business',bankState?bankState.market.riskFreeLong+bankState.market.corporateLoanSpread:undefined,'Cyclical · capital intensive'],
      ] as const).map(([field,selectivity,title,market])=><section className="decision-product-card" key={field} aria-label={title}>
        <header><h4>{title}</h4></header>
        <PercentageField field={field} label="New rate" hint="" state={state} update={update} disabled={disabled} error={errors?.[field]}/>
        <RateComparison offer={state[field]} market={market}/>
        <RatioField field={selectivity} label="New lending selectivity" state={state} update={update} disabled={disabled} error={errors?.[selectivity]}/>
        {field==='mortgageRate'&&<div className="mortgage-structure-controls">
          <label className="field"><strong>Maximum LTV</strong><select value={state.mortgageMaxLtv} disabled={disabled} onChange={e=>update('mortgageMaxLtv',e.target.value)}>{choicesForFormField('mortgageMaxLtv').map(value=><option value={Number(value).toFixed(2)} key={value}>{choiceLabel('mortgageMaxLtv',value)}</option>)}</select></label>
          <label className="field"><strong>Initial fixed period</strong><select value={state.mortgageFixedPeriodMonths} disabled={disabled} onChange={e=>update('mortgageFixedPeriodMonths',e.target.value)}>{choicesForFormField('mortgageFixedPeriodMonths').map(value=><option value={String(value)} key={value}>{choiceLabel('mortgageFixedPeriodMonths',value)}</option>)}</select></label>
        </div>}
      </section>)}

    </div>}

    {department==='Capital'&&<>
      <div className="policy-fields policy-fields-primary">
        <PercentageField field="dividendPayoutRatio" label="Share of profit paid out" hint="" state={state} update={update} disabled={disabled} error={errors?.dividendPayoutRatio}/>
      </div>

    </>}

    {department==='Capital'&&<CapitalMarketsTicket state={state} onChange={onChange} disabled={disabled} errors={errors} quote={localCapitalQueued?capitalMarketsQuote:undefined} planImpact={capitalMarketsPlanImpact} bankState={bankState} allowedInstruments={capitalInstruments} title="Raise capital" otherArea="Treasury & Funding" queuedTransactions={queuedTransactions} onQueueTransaction={()=>onQueueTransaction('capitalMarkets')}/>}
    {department==='Treasury'&&<CapitalMarketsTicket state={state} onChange={onChange} disabled={disabled} errors={errors} quote={localCapitalQueued?capitalMarketsQuote:undefined} planImpact={capitalMarketsPlanImpact} bankState={bankState} allowedInstruments={treasuryCapitalInstruments} title="Wholesale funding markets" otherArea="Finance & Capital" queuedTransactions={queuedTransactions} onQueueTransaction={()=>onQueueTransaction('capitalMarkets')}/>}

    {department==='Treasury'&&<>
      <div className="policy-fields policy-fields-primary">
        <label className="field"><strong>Gilt transaction</strong><select value={state.giltTradeDirection} disabled={disabled||transactionAlreadyQueued('giltTrade')} onChange={e=>setGiltDirection(e.target.value as ActionFormState['giltTradeDirection'])}><option value="none">Select a gilt trade</option>{choicesForFormField('giltTradeDirection').map(value=><option value={String(value)} key={value}>{choiceLabel('giltTradeDirection',value)}</option>)}</select></label>
        <MoneyField field="giltTradeAmount" label="Gilt trade amount (£)" hint="" state={state} update={update} disabled={disabled||transactionAlreadyQueued('giltTrade')||state.giltTradeDirection==='none'} error={errors?.giltTradeAmount} placeholder="e.g. 250m" maxAmount={state.giltTradeDirection==='sell'?maxGiltSaleAmount:undefined}/>
        <label className="field"><strong>Maturity</strong><select value={state.giltDurationYears} disabled={disabled||transactionAlreadyQueued('giltTrade')||state.giltTradeDirection==='none'||state.giltTradeDirection==='sell'} onChange={e=>update('giltDurationYears',e.target.value)}>{choicesForFormField('giltDurationYears').map(value=><option value={String(value)} key={value}>{choiceLabel('giltDurationYears',value)}</option>)}</select><small>{state.giltTradeDirection==='sell'?'Proportional sale across maturities.':giltQuotedYield!==undefined?`Yield: ${formatPct(giltQuotedYield)}`:''}</small></label>
      </div>
      {state.giltTradeDirection!=='none'&&<p className="order-status">Draft · not queued</p>}
      {state.giltTradeDirection!=='none'&&<><button type="button" className="button primary" disabled={disabled||transactionAlreadyQueued('giltTrade')||(parseMoneyInput(state.giltTradeAmount).value??0)<=0||!!errors?.giltTradeAmount} onClick={()=>onQueueTransaction('giltTrade')}>Queue transaction</button><button type="button" className="button ghost" disabled={disabled} onClick={()=>setGiltDirection('none')}>Discard draft</button></>}{transactionAlreadyQueued('giltTrade')&&<p className="order-status">A gilt transaction is already queued for the next close.</p>}

      <details className="department-advanced policy-disclosure"><summary>Central-bank funding</summary><div className="policy-fields"><label className="field"><strong>Bank of England facility</strong><select value={state.boeFacility} disabled={disabled||transactionAlreadyQueued('boeFunding')} onChange={e=>setBoeFacility(e.target.value as ActionFormState['boeFacility'])}><option value="none">Select a facility</option>{choicesForFormField('boeFacility').map(value=><option value={String(value)} key={value}>{choiceLabel('boeFacility',value)}</option>)}</select></label><MoneyField field="boeFundingAmount" label="BoE drawing (£)" hint="" state={state} update={update} disabled={disabled||transactionAlreadyQueued('boeFunding')||state.boeFacility==='none'} error={errors?.boeFundingAmount} placeholder="e.g. 250m" maxAmount={state.boeFacility==='none'?undefined:maxBoeFundingAmount}/></div>{state.boeFacility!=='none'&&<p className="order-status">Draft · not queued</p>}{state.boeFacility!=='none'&&<><button type="button" className="button primary" disabled={disabled||transactionAlreadyQueued('boeFunding')||(parseMoneyInput(state.boeFundingAmount).value??0)<=0||!!errors?.boeFundingAmount} onClick={()=>onQueueTransaction('boeFunding')}>Queue transaction</button><button type="button" className="button ghost" disabled={disabled} onClick={()=>setBoeFacility('none')}>Discard draft</button></>}{transactionAlreadyQueued('boeFunding')&&<p className="order-status">A Bank of England drawing is already queued for the next close.</p>}</details>
      <details className="department-advanced policy-disclosure"><summary>Interest-rate hedging</summary><label className="field"><strong>Swap direction</strong><select value={state.hedgeDirection} disabled={disabled||transactionAlreadyQueued('hedge')} onChange={e=>setHedgeDirection(e.target.value as ActionFormState['hedgeDirection'])}><option value="none">Select a swap direction</option>{choicesForFormField('hedgeDirection').map(value=><option value={String(value)} key={value}>{choiceLabel('hedgeDirection',value)}</option>)}</select></label><div className="policy-fields"><MoneyField field="hedgeNotional" label="Swap notional (£)" hint="" state={state} update={update} disabled={disabled||transactionAlreadyQueued('hedge')||state.hedgeDirection==='none'} error={errors?.hedgeNotional}/><label className="field"><strong>Swap term</strong><select value={state.hedgeMaturityMonths} disabled={disabled||transactionAlreadyQueued('hedge')||state.hedgeDirection==='none'} onChange={e=>update('hedgeMaturityMonths',e.target.value)}>{choicesForFormField('hedgeMaturityMonths').map(value=><option value={String(value)} key={value}>{choiceLabel('hedgeMaturityMonths',value)}</option>)}</select></label></div>{state.hedgeDirection!=='none'&&<p className="order-status">Draft · not queued</p>}{state.hedgeDirection!=='none'&&<><button type="button" className="button primary" disabled={disabled||transactionAlreadyQueued('hedge')||(parseMoneyInput(state.hedgeNotional).value??0)<=0||!!errors?.hedgeNotional||!!errors?.hedgeFixedRate} onClick={()=>onQueueTransaction('hedge')}>Queue transaction</button><button type="button" className="button ghost" disabled={disabled} onClick={()=>setHedgeDirection('none')}>Discard draft</button></>}{transactionAlreadyQueued('hedge')&&<p className="order-status">A hedge is already queued for the next close.</p>}</details>
    </>}


  </div>;
}
