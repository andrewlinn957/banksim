import type { BankState } from '../domain/bankState';
import './DecisionControls.css';
import { Department } from '../game/departments';
import type { CapitalMarketsInstrument } from '../domain/capitalMarkets';
import { buildLatestCapitalMarketsReceipt, clampPlayerMoneyDraft, formatPlayerMoneyLimit, playerMoneyLimitDescription, type PlayerCapitalMarketsQuote } from '../presentation/quotes';
import type { ActionFormState } from '../application/playerControls';
import { capitalMarketsInstrumentsForArea, cancelActionFormTransaction, choicesForFormField, controlForFormField, FORM_FIELDS_BY_DEPARTMENT, updateActionFormFields } from '../application/playerControls';
import { CAPITAL_MARKETS_INSTRUMENT_ORDER, getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { formatPct } from '../utils/formatters';
import { parseMoneyInput } from '../utils/parsers';
export type { Department } from '../game/departments';

export type { ActionFormState } from '../application/playerControls';

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
  capitalMarketsPlanImpactText?: string;
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

const PercentageField = ({label,hint,field,state,update,disabled,error,max}:{label:string;hint:string;field:keyof ActionFormState;state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;error?:string;max?:number}) => {
  const definition = controlForFormField(field);
  const limit = max ?? (definition?.maximum ?? 1) * 100;
  return <label className="field">
    <strong>{label}</strong>
    <div className="input-with-suffix"><input type="number" inputMode="decimal" step="0.01" min="0" max={limit} value={percentageDisplay(state[field])} disabled={disabled} aria-invalid={!!error} onChange={e=>{if(e.target.value!=='')update(field,`${e.target.value}%`);}}/><span aria-hidden="true">%</span></div>
    {hint&&<small>{hint}</small>}
    {error&&<span role="alert">{error}</span>}
  </label>;
};

const RatioField = ({label,field,state,update,disabled,error}:{label:string;hint?:string;field:keyof ActionFormState;state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;error?:string}) => {
  const definition = controlForFormField(field);
  const minimum = definition?.minimum ?? 0;
  const maximum = definition?.maximum ?? 1;
  const increment = definition?.increment ?? 0.05;
  return <div className="field selectivity-control">
    <strong>{label}</strong>
    <div className="selectivity-inputs"><input aria-label={`${label} slider`} type="range" min={minimum} max={maximum} step={increment} value={state[field]} disabled={disabled} onChange={e=>update(field,e.target.value)}/><input aria-label={`${label} exact value`} type="number" inputMode="decimal" step={increment} min={minimum} max={maximum} value={state[field]} disabled={disabled} aria-invalid={!!error} onChange={e=>{if(e.target.value!=='')update(field,e.target.value);}}/></div>
    <div className="selectivity-labels"><span>Loose</span><span>Balanced</span><span>Tight</span></div>
    {error&&<span role="alert">{error}</span>}
  </div>;
};

const RateComparison = ({offer,market}:{offer:string;market?:number}) => {
  if(market===undefined)return null;
  const rate=Number(percentageDisplay(offer))/100;
  const gap=Math.round((rate-market)*10000);
  return <div className="rate-comparison"><span>Market <strong>{formatPct(market)}</strong></span><strong>{Number.isFinite(gap)?gap===0?'At market':`${Math.abs(gap)}bp ${gap>0?'above':'below'} market`:'Enter a rate'}</strong></div>;
};
const MoneyField = ({label,hint,field,state,update,disabled,error,placeholder,maxAmount}:{label:string;hint:string;field:keyof ActionFormState;state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;error?:string;placeholder?:string;maxAmount?:number}) => {
  const capacityHint=maxAmount!==undefined&&Number.isFinite(maxAmount)?`${hint} ${playerMoneyLimitDescription(maxAmount)}`:hint;
  return <label className="field">
    <strong>{label}</strong>
    <div className="money-input-row"><input inputMode="decimal" value={state[field]} disabled={disabled} aria-invalid={!!error} onChange={e=>update(field,e.target.value)} onBlur={()=>{if(maxAmount!==undefined)update(field,clampPlayerMoneyDraft(state[field],Math.max(0,maxAmount)));}} placeholder={placeholder}/>{maxAmount!==undefined&&maxAmount>0&&!disabled&&<button type="button" className="button ghost" onClick={()=>update(field,formatPlayerMoneyLimit(maxAmount))}>Max</button>}</div>
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

const CapitalMarketsTicket = ({state,onChange,disabled,errors,quote,planImpactText,allowedInstruments,title,otherArea,bankState}:{bankState?:BankState;state:ActionFormState;onChange:(s:ActionFormState)=>void;disabled?:boolean;errors?:Partial<Record<keyof ActionFormState,string>>;quote?:PlayerCapitalMarketsQuote;planImpactText?:string;allowedInstruments:CapitalMarketsInstrument[];title:string;otherArea:string}) => {
  const update=(key:keyof ActionFormState,value:string)=>onChange(updateActionFormFields(state,{[key]:value}));
  const queuedInstrument = state.capitalMarketsInstrument;
  const instrument = queuedInstrument !== 'none' && allowedInstruments.includes(queuedInstrument) ? queuedInstrument : 'none';
  const queuedElsewhere = queuedInstrument !== 'none' && instrument === 'none';
  const definition = instrument === 'none' ? undefined : getCapitalMarketsInstrument(instrument);
  const isDiscountPriced = definition?.pricingKind === 'discount';
  const tenors = definition?.permittedTenorMonths ?? [];
  const selectInstrument=(value:string)=>{
    const next=value==='none'?undefined:getCapitalMarketsInstrument(value as CapitalMarketsInstrument);
    const tenor=Number(state.capitalMarketsTenorMonths);
    onChange(updateActionFormFields(state,{capitalMarketsInstrument:value as ActionFormState['capitalMarketsInstrument'],capitalMarketsTargetAmount:value==='none'?'':state.capitalMarketsTargetAmount,capitalMarketsTenorMonths:next?.permittedTenorMonths&&!next.permittedTenorMonths.includes(tenor)?String(next.defaultTenorMonths??next.permittedTenorMonths[0]):state.capitalMarketsTenorMonths}));
  };
  const validOrder=definition&&((parseMoneyInput(state.capitalMarketsTargetAmount).value??0)>0)&&!Object.entries(errors??{}).some(([key,value])=>key.startsWith('capitalMarkets')&&value);
  const latestTransaction=buildLatestCapitalMarketsReceipt(bankState,allowedInstruments);
  return <section className="policy-disclosure capital-markets-ticket" aria-label="Capital markets">
    <div className="policy-section-title"><h3>{title}</h3><span className="order-status">{definition?(validOrder?'Queued for next close':'Draft · enter valid terms'):'No transaction queued'}</span></div>
    {queuedElsewhere&&<div className="alert info"><strong>{getCapitalMarketsInstrument(queuedInstrument as CapitalMarketsInstrument).label} is already queued in {otherArea}.</strong><div className="muted">Complete or cancel it there first.</div></div>}
    <div className="policy-fields policy-fields-primary">
      <label className="field"><strong>Instrument</strong><select value={instrument} disabled={disabled||queuedElsewhere} onChange={e=>selectInstrument(e.target.value)}><option value="none">No transaction queued</option>{CAPITAL_MARKETS_INSTRUMENT_ORDER.filter(key=>allowedInstruments.includes(key)).map(key => { const item=getCapitalMarketsInstrument(key); return <option key={key} value={key}>{item.label}</option>; })}</select></label>
      <MoneyField field="capitalMarketsTargetAmount" label="Target size (£)" hint="" state={state} update={update} disabled={disabled||queuedElsewhere||!definition} error={errors?.capitalMarketsTargetAmount} placeholder="e.g. 150m"/>
      {isDiscountPriced
        ? <PercentageField field="capitalMarketsMaxDiscount" label="Maximum acceptable discount" hint="" state={state} update={update} disabled={disabled||queuedElsewhere||!definition} error={errors?.capitalMarketsMaxDiscount}/>
        : <Field field="capitalMarketsMaxSpreadBps" label="Maximum acceptable spread (bp)" hint="" state={state} update={update} disabled={disabled||queuedElsewhere||!definition} error={errors?.capitalMarketsMaxSpreadBps} placeholder="e.g. 750"/>}
      {tenors.length>0&&<label className="field"><strong>Tenor</strong><select value={state.capitalMarketsTenorMonths} disabled={disabled||queuedElsewhere||!definition} onChange={e=>update('capitalMarketsTenorMonths',e.target.value)}>{tenors.map(tenor=><option key={tenor} value={tenor}>{tenorLabel(tenor)}</option>)}</select></label>}
    </div>
    {definition&&quote&&<div className={`capital-markets-book ${quote.status.startsWith('failed')?'warning':'info'}`}>
      <div className="forecast-heading"><strong>Indicative book · {definition.label}</strong><span>{quote.statusLabel}</span></div>
      <dl className="deal-flow"><div><dt>Requested</dt><dd>{quote.targetAmount}</dd></div><div><dt>Expected fill</dt><dd>{quote.executedAmount}</dd></div><div><dt>Net proceeds</dt><dd>{quote.netProceeds}</dd></div></dl>
      <div className="book-coverage"><span>Investor demand {quote.demandAmount}</span><strong>{quote.coverageRatio}× coverage</strong><progress aria-label="Investor demand coverage" max="2" value={Math.min(2,Number(quote.coverageRatio))}/></div>
      <dl className="deal-details">
        {isDiscountPriced?<><div><dt>Clearing discount</dt><dd>{quote.clearingDiscount}</dd></div><div><dt>Expected issue price</dt><dd>{quote.issuePrice}</dd></div>{bankState&&<div><dt>Ownership dilution</dt><dd>{quote.ownershipDilution}</dd></div>}</>:<><div><dt>Clearing spread</dt><dd>{quote.clearingSpreadBps}</dd></div>{quote.allInYield!==undefined&&<><div><dt>Expected all-in yield</dt><dd>{quote.allInYield}</dd></div><div><dt>Annual coupon cost</dt><dd>{quote.annualCouponCost}</dd></div></>}</>}
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
    {latestTransaction&&<details className="transaction-receipt"><summary>Last execution · {latestTransaction.label} · {latestTransaction.statusLabel}</summary><dl className="deal-details"><div><dt>Date</dt><dd>{latestTransaction.date}</dd></div><div><dt>Executed</dt><dd>{latestTransaction.executedAmount}</dd></div><div><dt>Net proceeds</dt><dd>{latestTransaction.netProceeds}</dd></div><div><dt>Fees</dt><dd>{latestTransaction.fees}</dd></div></dl></details>}
    {definition&&planImpactText&&<div className="capital-markets-plan-impact"><strong>Three-Year Plan impact</strong><div className="muted">{planImpactText}</div></div>}
    {definition&&<button className="button ghost" disabled={disabled} onClick={()=>onChange(cancelActionFormTransaction(state,'capitalMarkets'))}>Cancel {definition.label} transaction</button>}

  </section>;
};

export default function ActionsPanel({department,bankState,state,onChange,disabled,errors,hasValidationErrors,giltQuotedYield,capitalMarketsQuote,capitalMarketsPlanImpactText,maxGiltSaleAmount,maxBoeFundingAmount}:Props) {
  const update=(key:keyof ActionFormState,value:string)=>onChange(updateActionFormFields(state,{[key]:value}));
  const localFields=FORM_FIELDS_BY_DEPARTMENT[department];
  const firstError = Object.entries(errors ?? {}).find(([field,message]) => !!message&&localFields.includes(field as keyof ActionFormState)) as [keyof ActionFormState,string] | undefined;
  const hasLocalValidationErrors=Boolean(firstError);
  const localInstruments=department==='Capital'||department==='Treasury'?capitalMarketsInstrumentsForArea(department):[];
  const localCapitalQueued=localInstruments.includes(state.capitalMarketsInstrument as CapitalMarketsInstrument);
  const setGiltDirection=(value:ActionFormState['giltTradeDirection'])=>onChange(value==='none'?cancelActionFormTransaction(state,'gilt'):updateActionFormFields(state,{giltTradeDirection:value}));
  const setBoeFacility=(value:ActionFormState['boeFacility'])=>onChange(value==='none'?cancelActionFormTransaction(state,'boeFunding'):updateActionFormFields(state,{boeFacility:value}));
  const setHedgeDirection=(value:ActionFormState['hedgeDirection'])=>onChange(value==='none'?cancelActionFormTransaction(state,'hedge'):updateActionFormFields(state,{hedgeDirection:value}));

  return <div className="stack department-policy-panel">
    <div className="policy-section-title"><h3>{department==='Treasury'?'Treasury actions':'Standing policy'}</h3></div>
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
        {field==='termDepositRate'&&<label className="field"><strong>Term</strong><select value={state.termDepositTenorMonths} disabled={disabled} onChange={e=>update('termDepositTenorMonths',e.target.value)}>{choicesForFormField('termDepositTenorMonths').map(months=><option key={months} value={months}>{Number(months)/12} year{Number(months)===12?'':'s'}</option>)}</select><small>Market comparison uses the 1-year benchmark.</small></label>}
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
          <label className="field"><strong>Maximum LTV</strong><select value={state.mortgageMaxLtv} disabled={disabled} onChange={e=>update('mortgageMaxLtv',e.target.value)}>{choicesForFormField('mortgageMaxLtv').map(ratio=><option key={ratio} value={Number(ratio).toFixed(2)}>{Math.round(Number(ratio)*100)}%</option>)}</select></label>
          <label className="field"><strong>Initial fixed period</strong><select value={state.mortgageFixedPeriodMonths} disabled={disabled} onChange={e=>update('mortgageFixedPeriodMonths',e.target.value)}>{choicesForFormField('mortgageFixedPeriodMonths').map(months=><option key={months} value={months}>{Number(months)/12} years</option>)}</select></label>
        </div>}
      </section>)}

    </div>}

    {department==='Capital'&&<>
      <div className="policy-fields policy-fields-primary">
        <PercentageField field="dividendPayoutRatio" label="Share of profit paid out" hint="" state={state} update={update} disabled={disabled} error={errors?.dividendPayoutRatio}/>
      </div>

    </>}

    {department==='Capital'&&<CapitalMarketsTicket state={state} onChange={onChange} disabled={disabled} errors={errors} quote={localCapitalQueued?capitalMarketsQuote:undefined} planImpactText={capitalMarketsPlanImpactText} bankState={bankState} allowedInstruments={localInstruments} title="Raise capital" otherArea="Treasury & Funding"/>}
    {department==='Treasury'&&<CapitalMarketsTicket state={state} onChange={onChange} disabled={disabled} errors={errors} quote={localCapitalQueued?capitalMarketsQuote:undefined} planImpactText={capitalMarketsPlanImpactText} bankState={bankState} allowedInstruments={localInstruments} title="Wholesale funding markets" otherArea="Finance & Capital"/>}

    {department==='Treasury'&&<>
      <div className="policy-fields policy-fields-primary">
        <label className="field"><strong>Gilt transaction</strong><select value={state.giltTradeDirection} disabled={disabled} onChange={e=>setGiltDirection(e.target.value as ActionFormState['giltTradeDirection'])}><option value="none">No gilt trade queued</option>{choicesForFormField('giltTradeDirection').map(direction=><option key={direction} value={direction}>{direction==='buy'?'Buy gilts':'Sell gilts'}</option>)}</select></label>
        <MoneyField field="giltTradeAmount" label="Gilt trade amount (£)" hint="" state={state} update={update} disabled={disabled||state.giltTradeDirection==='none'} error={errors?.giltTradeAmount} placeholder="e.g. 250m" maxAmount={state.giltTradeDirection==='sell'?maxGiltSaleAmount:undefined}/>
        <label className="field"><strong>Maturity</strong><select value={state.giltDurationYears} disabled={disabled||state.giltTradeDirection==='none'||state.giltTradeDirection==='sell'} onChange={e=>update('giltDurationYears',e.target.value)}>{choicesForFormField('giltDurationYears').map(years=><option key={years} value={years}>{years} years</option>)}</select><small>{state.giltTradeDirection==='sell'?'Proportional sale across maturities.':giltQuotedYield!==undefined?`Yield: ${formatPct(giltQuotedYield)}`:''}</small></label>
      </div>
      {state.giltTradeDirection!=='none'&&<button className="button ghost" disabled={disabled} onClick={()=>setGiltDirection('none')}>Cancel gilt transaction</button>}

      <details className="department-advanced policy-disclosure"><summary>Central-bank funding</summary><div className="policy-fields"><label className="field"><strong>Bank of England facility</strong><select value={state.boeFacility} disabled={disabled} onChange={e=>setBoeFacility(e.target.value as ActionFormState['boeFacility'])}><option value="none">No drawing queued</option>{choicesForFormField('boeFacility').map(facility=><option key={facility} value={facility}>{facility==='STR'?'STR · 1 week / Level A collateral':'ILTR · 6 months'}</option>)}</select></label><MoneyField field="boeFundingAmount" label="BoE drawing (£)" hint="" state={state} update={update} disabled={disabled||state.boeFacility==='none'} error={errors?.boeFundingAmount} placeholder="e.g. 250m" maxAmount={state.boeFacility==='none'?undefined:maxBoeFundingAmount}/></div>{state.boeFacility!=='none'&&<button className="button ghost" disabled={disabled} onClick={()=>setBoeFacility('none')}>Cancel Bank of England drawing</button>}</details>
      <details className="department-advanced policy-disclosure"><summary>Interest-rate hedging</summary><label className="field"><strong>Swap direction</strong><select value={state.hedgeDirection} disabled={disabled} onChange={e=>setHedgeDirection(e.target.value as ActionFormState['hedgeDirection'])}><option value="none">No swap queued</option>{choicesForFormField('hedgeDirection').map(direction=><option key={direction} value={direction}>{direction==='payFixedReceiveFloat'?'Pay fixed, receive floating':'Receive fixed, pay floating'}</option>)}</select></label><div className="policy-fields"><MoneyField field="hedgeNotional" label="Swap notional (£)" hint="" state={state} update={update} disabled={disabled||state.hedgeDirection==='none'} error={errors?.hedgeNotional}/><label className="field"><strong>Swap term</strong><select value={state.hedgeMaturityMonths} disabled={disabled||state.hedgeDirection==='none'} onChange={e=>update('hedgeMaturityMonths',e.target.value)}>{choicesForFormField('hedgeMaturityMonths').map(months=><option key={months} value={months}>{Number(months)/12} years</option>)}</select></label></div>{state.hedgeDirection!=='none'&&<button className="button ghost" disabled={disabled} onClick={()=>setHedgeDirection('none')}>Cancel swap transaction</button>}</details>
    </>}


  </div>;
}
