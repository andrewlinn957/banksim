import type { BankState } from '../domain/bankState';
import './DecisionControls.css';
import { Department } from '../game/departments';
import type { CapitalMarketsBookbuildResult, CapitalMarketsInstrument } from '../domain/capitalMarkets';
import { CAPITAL_MARKETS_INSTRUMENT_ORDER, getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { formatCurrency, formatPct } from '../utils/formatters';
import { parseMoneyInput } from '../utils/parsers';
export type { Department } from '../game/departments';

export interface ActionFormState {
  retailCurrentAccountRate: string;
  termDepositRate: string;
  termDepositTenorMonths: string;
  corporateDepositRate: string;
  mortgageRate: string;
  consumerLoanRate: string;
  corporateLoanRate: string;
  mortgageUnderwritingTightness: string;
  consumerUnderwritingTightness: string;
  corporateUnderwritingTightness: string;
  mortgageMaxLtv: string;
  mortgageFixedPeriodMonths: string;
  capitalMarketsInstrument: 'none' | CapitalMarketsInstrument;
  capitalMarketsTargetAmount: string;
  capitalMarketsMaxDiscount: string;
  capitalMarketsMaxSpreadBps: string;
  capitalMarketsTenorMonths: string;
  dividendPayoutRatio: string;
  at1CouponMode: 'auto' | 'pay' | 'skip';
  giltTradeDirection: 'none' | 'buy' | 'sell';
  giltTradeAmount: string;
  giltDurationYears: string;
  boeFacility: 'none' | 'STR' | 'ILTR';
  boeFundingAmount: string;
  hedgeDirection: 'none' | 'payFixedReceiveFloat' | 'receiveFixedPayFloat';
  hedgeNotional: string;
  hedgeFixedRate: string;
  hedgeMaturityMonths: string;
}

export interface CapitalMarketsPlanImpact {
  cet1Before: number;
  cet1After: number;
  epsBefore: number;
  epsAfter: number;
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
  capitalMarketsQuote?: CapitalMarketsBookbuildResult;
  capitalMarketsPlanImpact?: CapitalMarketsPlanImpact;
  maxGiltSaleAmount?: number;
  maxBoeFundingAmount?: number;
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

const DEPARTMENT_FIELDS:Record<Department,Array<keyof ActionFormState>>={
  Customers:['retailCurrentAccountRate','termDepositRate','termDepositTenorMonths','corporateDepositRate'],
  Lending:['mortgageRate','consumerLoanRate','corporateLoanRate','mortgageUnderwritingTightness','consumerUnderwritingTightness','corporateUnderwritingTightness','mortgageMaxLtv','mortgageFixedPeriodMonths'],
  Capital:['dividendPayoutRatio','capitalMarketsInstrument','capitalMarketsTargetAmount','capitalMarketsMaxDiscount','capitalMarketsMaxSpreadBps','capitalMarketsTenorMonths'],
  Treasury:['capitalMarketsInstrument','capitalMarketsTargetAmount','capitalMarketsMaxDiscount','capitalMarketsMaxSpreadBps','capitalMarketsTenorMonths','giltTradeDirection','giltTradeAmount','giltDurationYears','boeFacility','boeFundingAmount','hedgeDirection','hedgeNotional','hedgeFixedRate','hedgeMaturityMonths'],
};

const tenorLabel = (months: number): string => months % 12 === 0 ? `${months / 12} years` : `${months} months`;

const CapitalMarketsTicket = ({state,onChange,disabled,errors,quote,planImpact,allowedInstruments,title,otherArea,bankState}:{bankState?:BankState;state:ActionFormState;onChange:(s:ActionFormState)=>void;disabled?:boolean;errors?:Partial<Record<keyof ActionFormState,string>>;quote?:CapitalMarketsBookbuildResult;planImpact?:CapitalMarketsPlanImpact;allowedInstruments:CapitalMarketsInstrument[];title:string;otherArea:string}) => {
  const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});
  const queuedInstrument = state.capitalMarketsInstrument;
  const instrument = queuedInstrument !== 'none' && allowedInstruments.includes(queuedInstrument) ? queuedInstrument : 'none';
  const queuedElsewhere = queuedInstrument !== 'none' && instrument === 'none';
  const definition = instrument === 'none' ? undefined : getCapitalMarketsInstrument(instrument);
  const isDiscountPriced = definition?.pricingKind === 'discount';
  const tenors = definition?.permittedTenorMonths ?? [];
  const allInYield = quote?.marketReferenceRate !== undefined && quote.clearingSpreadBps !== undefined ? quote.marketReferenceRate + quote.clearingSpreadBps / 10000 : undefined;
  const selectInstrument=(value:string)=>{
    const next=value==='none'?undefined:getCapitalMarketsInstrument(value as CapitalMarketsInstrument);
    const tenor=Number(state.capitalMarketsTenorMonths);
    onChange({...state,capitalMarketsInstrument:value as ActionFormState['capitalMarketsInstrument'],capitalMarketsTargetAmount:value==='none'?'':state.capitalMarketsTargetAmount,capitalMarketsTenorMonths:next?.permittedTenorMonths&&!next.permittedTenorMonths.includes(tenor)?String(next.defaultTenorMonths??next.permittedTenorMonths[0]):state.capitalMarketsTenorMonths});
  };
  const validOrder=definition&&((parseMoneyInput(state.capitalMarketsTargetAmount).value??0)>0)&&!Object.entries(errors??{}).some(([key,value])=>key.startsWith('capitalMarkets')&&value);
  const latestTransaction=bankState?.capitalMarkets?.transactions.filter(t=>allowedInstruments.includes(t.instrument)).at(-1);
  const newShares=quote?.issuePrice&&quote.issuePrice>0?quote.grossProceeds/quote.issuePrice:0;
  const dilution=bankState&&newShares>0?newShares/(bankState.equityMarket.sharesOutstanding+newShares):0;
  return <section className="policy-disclosure capital-markets-ticket" aria-label="Capital markets">
    <div className="policy-section-title"><h3>{title}</h3><span className="order-status">{definition?(validOrder?'Queued for next close':'Draft · enter valid terms'):'No transaction queued'}</span></div>
    {queuedElsewhere&&<div className="alert info"><strong>{getCapitalMarketsInstrument(queuedInstrument as CapitalMarketsInstrument).label} is already queued in {otherArea}.</strong><div className="muted">Finish or cancel that transaction in its owning management area before replacing it here.</div></div>}
    <div className="policy-fields policy-fields-primary">
      <label className="field"><strong>Instrument</strong><select value={instrument} disabled={disabled||queuedElsewhere} onChange={e=>selectInstrument(e.target.value)}><option value="none">No transaction queued</option>{CAPITAL_MARKETS_INSTRUMENT_ORDER.filter(key=>allowedInstruments.includes(key)).map(key => { const item=getCapitalMarketsInstrument(key); return <option key={key} value={key}>{item.label}</option>; })}</select><small></small></label>
      <MoneyField field="capitalMarketsTargetAmount" label="Target size (£)" hint="Accepts £, k, m or bn." state={state} update={update} disabled={disabled||queuedElsewhere||!definition} error={errors?.capitalMarketsTargetAmount} placeholder="e.g. 150m"/>
      {isDiscountPriced
        ? <PercentageField field="capitalMarketsMaxDiscount" label="Maximum acceptable discount" hint="Cancel if the discount exceeds this limit." state={state} update={update} disabled={disabled||queuedElsewhere||!definition} error={errors?.capitalMarketsMaxDiscount}/>
        : <Field field="capitalMarketsMaxSpreadBps" label="Maximum acceptable spread (bp)" hint="Cancel if the spread exceeds this limit." state={state} update={update} disabled={disabled||queuedElsewhere||!definition} error={errors?.capitalMarketsMaxSpreadBps} placeholder="e.g. 750"/>}
      {tenors.length>0&&<label className="field"><strong>Tenor</strong><select value={state.capitalMarketsTenorMonths} disabled={disabled||queuedElsewhere||!definition} onChange={e=>update('capitalMarketsTenorMonths',e.target.value)}>{tenors.map(tenor=><option key={tenor} value={tenor}>{tenorLabel(tenor)}</option>)}</select><small>Longer terms lock in cost longer.</small></label>}
    </div>
    {definition&&quote&&<div className={`capital-markets-book ${quote.status.startsWith('failed')?'warning':'info'}`}>
      <div className="forecast-heading"><strong>Indicative book · {definition.label}</strong><span>{quote.status==='filled'?'Full fill projected':quote.status==='partial'?'Partial fill projected':'Execution would fail'}</span></div>
      <dl className="deal-flow"><div><dt>Requested</dt><dd>{moneyMillions(quote.targetAmount)}</dd></div><div><dt>Expected fill</dt><dd>{moneyMillions(quote.executedAmount)}</dd></div><div><dt>Net proceeds</dt><dd>{moneyMillions(quote.netProceeds)}</dd></div></dl>
      <div className="book-coverage"><span>Investor demand {moneyMillions(quote.demandAmount)}</span><strong>{quote.coverageRatio.toFixed(2)}× coverage</strong><progress aria-label="Investor demand coverage" max="2" value={Math.min(2,quote.coverageRatio)}/></div>
      <dl className="deal-details">
        {isDiscountPriced?<><div><dt>Clearing discount</dt><dd>{formatPct(quote.clearingDiscount??0)}</dd></div><div><dt>Expected issue price</dt><dd>£{(quote.issuePrice??0).toFixed(3)}</dd></div>{bankState&&<div><dt>Ownership dilution</dt><dd>{formatPct(dilution)}</dd></div>}</>:<><div><dt>Clearing spread</dt><dd>{(quote.clearingSpreadBps??0).toFixed(0)}bp</dd></div>{allInYield!==undefined&&<><div><dt>Expected all-in yield</dt><dd>{formatPct(allInYield)}</dd></div><div><dt>Annual coupon cost</dt><dd>{moneyMillions(quote.executedAmount*allInYield)}</dd></div></>}</>}
        <div><dt>Fees</dt><dd>{moneyMillions(quote.fees)}</dd></div>
      </dl>
      {quote.recentIssuanceRatio>0&&<small>Recent issuance reduces capacity and worsens terms.</small>}
    </div>}
    {latestTransaction&&<details className="transaction-receipt"><summary>Last execution · {getCapitalMarketsInstrument(latestTransaction.instrument).label} · {latestTransaction.status==='filled'?'Executed':latestTransaction.status==='partial'?'Partially filled':'Failed'}</summary><dl className="deal-details"><div><dt>Date</dt><dd>{latestTransaction.date}</dd></div><div><dt>Executed</dt><dd>{moneyMillions(latestTransaction.executedAmount)}</dd></div><div><dt>Net proceeds</dt><dd>{moneyMillions(latestTransaction.netProceeds)}</dd></div><div><dt>Fees</dt><dd>{moneyMillions(latestTransaction.fees)}</dd></div></dl></details>}
    {definition&&planImpact&&<div className="capital-markets-plan-impact"><strong>Three-Year Plan impact</strong><div className="muted">One-month preview: CET1 {formatPct(planImpact.cet1Before)} → {formatPct(planImpact.cet1After)} · EPS {(planImpact.epsBefore*100).toFixed(1)}p → {(planImpact.epsAfter*100).toFixed(1)}p.</div><div className="muted">There is no direct Board Confidence effect: the transaction matters only through the plan metrics it changes.</div></div>}
    {definition&&<button className="button ghost" disabled={disabled} onClick={()=>onChange({...state,capitalMarketsInstrument:'none',capitalMarketsTargetAmount:''})}>Cancel {definition.label} transaction</button>}
    <p className="muted">Terms clear at close. A failed price limit settles nothing.</p>
  </section>;
};

export default function ActionsPanel({department,bankState,state,onChange,disabled,errors,hasValidationErrors,giltQuotedYield,capitalMarketsQuote,capitalMarketsPlanImpact,maxGiltSaleAmount,maxBoeFundingAmount}:Props) {
  const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});
  const localFields=DEPARTMENT_FIELDS[department];
  const firstError = Object.entries(errors ?? {}).find(([field,message]) => !!message&&localFields.includes(field as keyof ActionFormState)) as [keyof ActionFormState,string] | undefined;
  const hasLocalValidationErrors=Boolean(firstError);
  const treasuryCapitalInstruments:CapitalMarketsInstrument[]=['senior'];
  const capitalInstruments:CapitalMarketsInstrument[]=['cet1','at1','tier2'];
  const localCapitalQueued=department==='Capital'?capitalInstruments.includes(state.capitalMarketsInstrument as CapitalMarketsInstrument):treasuryCapitalInstruments.includes(state.capitalMarketsInstrument as CapitalMarketsInstrument);
  const setGiltDirection=(value:ActionFormState['giltTradeDirection'])=>onChange({...state,giltTradeDirection:value,giltTradeAmount:value==='none'?'':state.giltTradeAmount});
  const setBoeFacility=(value:ActionFormState['boeFacility'])=>onChange({...state,boeFacility:value,boeFundingAmount:value==='none'?'':state.boeFundingAmount});
  const setHedgeDirection=(value:ActionFormState['hedgeDirection'])=>onChange({...state,hedgeDirection:value,hedgeNotional:value==='none'?'':state.hedgeNotional,hedgeFixedRate:value==='none'?'':state.hedgeFixedRate});

  return <div className="stack department-policy-panel">
    <div className="policy-section-title"><h3>{department==='Treasury'?'Treasury actions':'Standing policy'}</h3><small>{department==='Treasury'?'Cash stays in BoE reserves until invested. Trades execute once.':'Policies persist; one-off orders clear after close.'}</small></div>
    {hasLocalValidationErrors && <div role="alert" className="alert danger">Fix this management area's invalid input before advancing time.{firstError && <> <strong>{FIELD_LABELS[firstError[0]] ?? firstError[0]}:</strong> {firstError[1]}</>}</div>}

    {department==='Customers'&&<div className="decision-product-grid" aria-label="Deposit product policies">
      {([
        ['retailCurrentAccountRate','Retail current accounts','Retail current account rate',bankState?.market.competitorRetailCurrentAccountRate,'Everyday, accessible balances'],
        ['termDepositRate','Fixed-term savings','Fixed-term savings offer',bankState?.market.competitorTermDepositRate,'Lock in funding and its cost'],
        ['corporateDepositRate','Business deposits','SME/business deposit offer',bankState?.market.competitorCorporateDepositRate??bankState?.market.competitorRetailCurrentAccountRate,'More sensitive to competing offers'],
      ] as const).map(([field,title,label,market,description])=><section className="decision-product-card" key={field} aria-label={title}>
        <header><h4>{title}</h4><small>{description}</small></header>
        <PercentageField field={field} label={label} hint="" state={state} update={update} disabled={disabled} error={errors?.[field]}/>
        <RateComparison offer={state[field]} market={market}/>
        {field==='termDepositRate'&&<label className="field"><strong>Term</strong><select value={state.termDepositTenorMonths} disabled={disabled} onChange={e=>update('termDepositTenorMonths',e.target.value)}><option value="12">1 year</option><option value="24">2 years</option><option value="36">3 years</option></select><small>Market comparison uses the 1-year benchmark.</small></label>}
      </section>)}
    </div>}

    {department==='Lending'&&<div className="decision-product-grid" aria-label="Lending product policies">
      {([
        ['mortgageRate','mortgageUnderwritingTightness','Mortgages',bankState?.market.competitorMortgageRate,'Low loss · long duration'],
        ['consumerLoanRate','consumerUnderwritingTightness','Personal credit',bankState?.market.competitorConsumerLoanRate,'Higher yield · higher loss'],
        ['corporateLoanRate','corporateUnderwritingTightness','SME & business',bankState?bankState.market.riskFreeLong+bankState.market.corporateLoanSpread:undefined,'Cyclical · capital intensive'],
      ] as const).map(([field,selectivity,title,market,description])=><section className="decision-product-card" key={field} aria-label={title}>
        <header><h4>{title}</h4><small>{description}</small></header>
        <PercentageField field={field} label="New rate" hint="" state={state} update={update} disabled={disabled} error={errors?.[field]}/>
        <RateComparison offer={state[field]} market={market}/>
        <RatioField field={selectivity} label="Selectivity" state={state} update={update} disabled={disabled} error={errors?.[selectivity]}/>
        {field==='mortgageRate'&&<div className="mortgage-structure-controls">
          <label className="field"><strong>Maximum LTV</strong><select value={state.mortgageMaxLtv} disabled={disabled} onChange={e=>update('mortgageMaxLtv',e.target.value)}><option value="0.60">60%</option><option value="0.75">75%</option><option value="0.85">85%</option><option value="0.90">90%</option><option value="0.95">95%</option></select></label>
          <label className="field"><strong>Initial fixed period</strong><select value={state.mortgageFixedPeriodMonths} disabled={disabled} onChange={e=>update('mortgageFixedPeriodMonths',e.target.value)}><option value="24">2 years</option><option value="36">3 years</option><option value="60">5 years</option></select></label>
        </div>}
      </section>)}
      <small className="decision-product-note">Policies affect new lending. Tighter selection reduces approvals and credit risk; higher LTV increases loss severity.</small>
    </div>}

    {department==='Capital'&&<>
      <div className="policy-fields policy-fields-primary">
        <PercentageField field="dividendPayoutRatio" label="Share of profit paid out" hint="Retained profit builds CET1. Restrictions may limit payouts." state={state} update={update} disabled={disabled} error={errors?.dividendPayoutRatio}/>
      </div>
      <p className="muted">AT1 coupons are discretionary. New issues clear at market rates.</p>
    </>}

    {department==='Capital'&&<CapitalMarketsTicket state={state} onChange={onChange} disabled={disabled} errors={errors} quote={localCapitalQueued?capitalMarketsQuote:undefined} planImpact={capitalMarketsPlanImpact} bankState={bankState} allowedInstruments={capitalInstruments} title="Raise capital" otherArea="Treasury & Funding"/>}
    {department==='Treasury'&&<CapitalMarketsTicket state={state} onChange={onChange} disabled={disabled} errors={errors} quote={localCapitalQueued?capitalMarketsQuote:undefined} planImpact={capitalMarketsPlanImpact} bankState={bankState} allowedInstruments={treasuryCapitalInstruments} title="Wholesale funding markets" otherArea="Finance & Capital"/>}

    {department==='Treasury'&&<>
      <div className="policy-fields policy-fields-primary">
        <label className="field"><strong>Gilt transaction</strong><select value={state.giltTradeDirection} disabled={disabled} onChange={e=>setGiltDirection(e.target.value as ActionFormState['giltTradeDirection'])}><option value="none">No gilt trade queued</option><option value="buy">Buy gilts</option><option value="sell">Sell gilts</option></select><small>Buying invests BoE reserves; selling returns the proceeds to reserves.</small></label>
        <MoneyField field="giltTradeAmount" label="Gilt trade amount (£)" hint="Executed once on the next monthly close." state={state} update={update} disabled={disabled||state.giltTradeDirection==='none'} error={errors?.giltTradeAmount} placeholder="e.g. 250m" maxAmount={state.giltTradeDirection==='sell'?maxGiltSaleAmount:undefined}/>
        <label className="field"><strong>Maturity</strong><select value={state.giltDurationYears} disabled={disabled||state.giltTradeDirection==='none'||state.giltTradeDirection==='sell'} onChange={e=>update('giltDurationYears',e.target.value)}><option value="2">2 years</option><option value="5">5 years</option><option value="10">10 years</option></select><small>{state.giltTradeDirection==='sell'?'Sales reduce the existing unencumbered portfolio proportionally across its maturity ladder.':giltQuotedYield!==undefined?`Current simulated gilt yield: ${formatPct(giltQuotedYield)}. Purchases lock this coupon/yield into the new vintage.`:'Select Buy gilts to choose a purchase maturity.'}</small></label>
      </div>
      {state.giltTradeDirection!=='none'&&<button className="button ghost" disabled={disabled} onClick={()=>setGiltDirection('none')}>Cancel gilt transaction</button>}
      <p className="muted">Reserves rise as deposits, repayments, interest and securities mature; lending draws them down.</p>
      <details className="department-advanced policy-disclosure"><summary>Central-bank funding</summary><p className="muted">Secured funding for routine liquidity needs.</p><div className="policy-fields"><label className="field"><strong>Bank of England facility</strong><select value={state.boeFacility} disabled={disabled} onChange={e=>setBoeFacility(e.target.value as ActionFormState['boeFacility'])}><option value="none">No drawing queued</option><option value="STR">STR · 1 week / Level A collateral</option><option value="ILTR">ILTR · 6 months</option></select><small>Secured reserves. Modelled as routine sterling liquidity management.</small></label><MoneyField field="boeFundingAmount" label="BoE drawing once (£)" hint="Limited by available eligible gilt collateral and haircut." state={state} update={update} disabled={disabled||state.boeFacility==='none'} error={errors?.boeFundingAmount} placeholder="e.g. 250m" maxAmount={state.boeFacility==='none'?undefined:maxBoeFundingAmount}/></div>{state.boeFacility!=='none'&&<button className="button ghost" disabled={disabled} onClick={()=>setBoeFacility('none')}>Cancel Bank of England drawing</button>}</details>
      <details className="department-advanced policy-disclosure"><summary>Interest-rate hedging</summary><p className="muted">Use swaps to adjust remaining interest-rate risk after changing the balance sheet.</p><label className="field"><strong>Swap direction</strong><select value={state.hedgeDirection} disabled={disabled} onChange={e=>setHedgeDirection(e.target.value as ActionFormState['hedgeDirection'])}><option value="none">No swap queued</option><option value="payFixedReceiveFloat">Pay fixed, receive floating</option><option value="receiveFixedPayFloat">Receive fixed, pay floating</option></select></label><div className="policy-fields"><MoneyField field="hedgeNotional" label="Swap notional (£)" hint="Executed once when a direction is selected." state={state} update={update} disabled={disabled||state.hedgeDirection==='none'} error={errors?.hedgeNotional}/><label className="field"><strong>Swap term</strong><select value={state.hedgeMaturityMonths} disabled={disabled||state.hedgeDirection==='none'} onChange={e=>update('hedgeMaturityMonths',e.target.value)}><option value="12">1 year</option><option value="24">2 years</option><option value="60">5 years</option></select><small>Longer swaps hedge more structural duration.</small></label></div>{state.hedgeDirection!=='none'&&<button className="button ghost" disabled={disabled} onClick={()=>setHedgeDirection('none')}>Cancel swap transaction</button>}</details>
    </>}

    <small className="policy-save-note">Changes apply at the next close. Editing pauses time.</small>
  </div>;
}
