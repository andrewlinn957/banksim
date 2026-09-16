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
    <small>{hint}</small>
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
    <small>{hint}</small>
    {error&&<span role="alert">{error}</span>}
  </label>
);

const RatioField = ({label,hint,field,state,update,disabled,error}:{label:string;hint:string;field:keyof ActionFormState;state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;error?:string}) => (
  <label className="field">
    <strong>{label}</strong>
    <input type="number" inputMode="decimal" step="0.05" min="0" max="1" value={state[field]} disabled={disabled} aria-invalid={!!error} onChange={e=>{if(e.target.value!=='')update(field,e.target.value);}}/>
    <small>{hint}</small>
    {error&&<span role="alert">{error}</span>}
  </label>
);

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

const CapitalMarketsTicket = ({state,onChange,disabled,errors,quote,planImpact,allowedInstruments,title,otherArea}:{state:ActionFormState;onChange:(s:ActionFormState)=>void;disabled?:boolean;errors?:Partial<Record<keyof ActionFormState,string>>;quote?:CapitalMarketsBookbuildResult;planImpact?:CapitalMarketsPlanImpact;allowedInstruments:CapitalMarketsInstrument[];title:string;otherArea:string}) => {
  const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});
  const queuedInstrument = state.capitalMarketsInstrument;
  const instrument = queuedInstrument !== 'none' && allowedInstruments.includes(queuedInstrument) ? queuedInstrument : 'none';
  const queuedElsewhere = queuedInstrument !== 'none' && instrument === 'none';
  const definition = instrument === 'none' ? undefined : getCapitalMarketsInstrument(instrument);
  const isDiscountPriced = definition?.pricingKind === 'discount';
  const tenors = definition?.permittedTenorMonths ?? [];
  const allInYield = quote?.marketReferenceRate !== undefined && quote.clearingSpreadBps !== undefined ? quote.marketReferenceRate + quote.clearingSpreadBps / 10000 : undefined;
  const selectInstrument=(value:string)=>onChange({...state,capitalMarketsInstrument:value as ActionFormState['capitalMarketsInstrument'],capitalMarketsTargetAmount:value==='none'?'':state.capitalMarketsTargetAmount});
  return <section className="policy-disclosure capital-markets-ticket" aria-label="Capital markets">
    <div className="policy-section-title"><h3>{title}</h3><small>One transaction ticket. Market demand and clearing terms determine what actually settles.</small></div>
    {queuedElsewhere&&<div className="alert info"><strong>{getCapitalMarketsInstrument(queuedInstrument as CapitalMarketsInstrument).label} is already queued in {otherArea}.</strong><div className="muted">Finish or cancel that transaction in its owning management area before replacing it here.</div></div>}
    <div className="policy-fields policy-fields-primary">
      <label className="field"><strong>Instrument</strong><select value={instrument} disabled={disabled||queuedElsewhere} onChange={e=>selectInstrument(e.target.value)}><option value="none">No transaction queued</option>{CAPITAL_MARKETS_INSTRUMENT_ORDER.filter(key=>allowedInstruments.includes(key)).map(key => { const item=getCapitalMarketsInstrument(key); return <option key={key} value={key}>{item.label}</option>; })}</select><small>Choose the claim you want investors to buy.</small></label>
      <MoneyField field="capitalMarketsTargetAmount" label="Target size (£)" hint="The book can be partially filled if investor demand is smaller than your target." state={state} update={update} disabled={disabled||queuedElsewhere||!definition} error={errors?.capitalMarketsTargetAmount} placeholder="e.g. 150m"/>
      {isDiscountPriced
        ? <PercentageField field="capitalMarketsMaxDiscount" label="Maximum acceptable discount" hint="The deal fails rather than price below this limit." state={state} update={update} disabled={disabled||queuedElsewhere||!definition} error={errors?.capitalMarketsMaxDiscount}/>
        : <Field field="capitalMarketsMaxSpreadBps" label="Maximum acceptable spread (bp)" hint="The deal fails if the clearing spread is wider than this limit." state={state} update={update} disabled={disabled||queuedElsewhere||!definition} error={errors?.capitalMarketsMaxSpreadBps} placeholder="e.g. 750"/>}
      {tenors.length>0&&<label className="field"><strong>Tenor</strong><select value={state.capitalMarketsTenorMonths} disabled={disabled||queuedElsewhere||!definition} onChange={e=>update('capitalMarketsTenorMonths',e.target.value)}>{tenors.map(tenor=><option key={tenor} value={tenor}>{tenorLabel(tenor)}</option>)}</select><small>Longer debt locks in the clearing cost for longer.</small></label>}
    </div>
    {definition&&quote&&<div className={`alert ${quote.status.startsWith('failed')?'warning':'info'} capital-markets-book`}>
      <strong>Indicative book · {definition.label}</strong>
      <div className="muted">Demand {formatCurrency(quote.demandAmount)} · coverage {quote.coverageRatio.toFixed(2)}× · executable {formatCurrency(quote.executedAmount)} of {formatCurrency(quote.targetAmount)}</div>
      <div className="muted">{isDiscountPriced?`Clearing discount ${formatPct(quote.clearingDiscount??0)} · issue price £${(quote.issuePrice??0).toFixed(3)}`:`Clearing spread ${(quote.clearingSpreadBps??0).toFixed(0)}bp${allInYield!==undefined?` · all-in yield ${formatPct(allInYield)}`:''}`} · {quote.status.replace('-', ' ')}</div>
      {quote.fees>0&&<div className="muted">Fees {formatCurrency(quote.fees)} · net proceeds {formatCurrency(quote.netProceeds)}</div>}
      {quote.recentIssuanceRatio>0&&<div className="muted">Recent issuance is reducing market capacity and worsening clearing terms.</div>}
    </div>}
    {definition&&planImpact&&<div className="capital-markets-plan-impact"><strong>Three-Year Plan impact</strong><div className="muted">One-month preview: CET1 {formatPct(planImpact.cet1Before)} → {formatPct(planImpact.cet1After)} · EPS {(planImpact.epsBefore*100).toFixed(1)}p → {(planImpact.epsAfter*100).toFixed(1)}p.</div><div className="muted">There is no direct Board Confidence effect: the transaction matters only through the plan metrics it changes.</div></div>}
    {definition&&<button className="button ghost" disabled={disabled} onClick={()=>onChange({...state,capitalMarketsInstrument:'none',capitalMarketsTargetAmount:''})}>Cancel {definition.label} transaction</button>}
    <p className="muted">Bookbuild terms are indicative until the monthly close. A failed price limit records the attempt but settles no capital or funding.</p>
  </section>;
};

export default function ActionsPanel({department,state,onChange,disabled,errors,hasValidationErrors,giltQuotedYield,capitalMarketsQuote,capitalMarketsPlanImpact,maxGiltSaleAmount,maxBoeFundingAmount}:Props) {
  const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});
  const localFields=DEPARTMENT_FIELDS[department];
  const firstError = Object.entries(errors ?? {}).find(([field,message]) => !!message&&localFields.includes(field as keyof ActionFormState)) as [keyof ActionFormState,string] | undefined;
  const hasLocalValidationErrors=Boolean(firstError);
  const treasuryCapitalInstruments:CapitalMarketsInstrument[]=['at1','tier2','senior'];
  const localCapitalQueued=department==='Capital'?state.capitalMarketsInstrument==='cet1':treasuryCapitalInstruments.includes(state.capitalMarketsInstrument as CapitalMarketsInstrument);
  const setGiltDirection=(value:ActionFormState['giltTradeDirection'])=>onChange({...state,giltTradeDirection:value,giltTradeAmount:value==='none'?'':state.giltTradeAmount});
  const setBoeFacility=(value:ActionFormState['boeFacility'])=>onChange({...state,boeFacility:value,boeFundingAmount:value==='none'?'':state.boeFundingAmount});
  const setHedgeDirection=(value:ActionFormState['hedgeDirection'])=>onChange({...state,hedgeDirection:value,hedgeNotional:value==='none'?'':state.hedgeNotional,hedgeFixedRate:value==='none'?'':state.hedgeFixedRate});

  return <div className="stack department-policy-panel">
    <div className="policy-section-title"><h3>{department==='Treasury'?'Treasury actions':'Standing policy'}</h3><small>{department==='Treasury'?'Uninvested cash remains in the Bank of England reserve account. Gilt purchases and sales are explicit one-off transactions.':'Standing choices persist. One-off transactions clear after execution.'}</small></div>
    {hasLocalValidationErrors && <div role="alert" className="alert danger">Fix this management area's invalid input before advancing time.{firstError && <> <strong>{FIELD_LABELS[firstError[0]] ?? firstError[0]}:</strong> {firstError[1]}</>}</div>}

    {department==='Customers'&&<>
      <div className="policy-fields policy-fields-primary">
        <PercentageField field="retailCurrentAccountRate" label="Retail current account rate" hint="Interest rate paid on retail current-account balances. Enter percentage points: 3.5 means 3.5%." state={state} update={update} disabled={disabled} error={errors?.retailCurrentAccountRate}/>
        <PercentageField field="corporateDepositRate" label="SME/business deposit offer" hint="Business balances are less stable and react faster to competing offers. Enter percentage points." state={state} update={update} disabled={disabled} error={errors?.corporateDepositRate}/>
      </div>
      <details className="department-advanced policy-disclosure">
        <summary>Fixed-term savings</summary>
        <p className="muted">Use contractual retail funding when you want more stable funding at the cost of a higher fixed rate and future maturity wall.</p>
        <div className="policy-fields">
          <PercentageField field="termDepositRate" label="Fixed-term savings offer" hint="New balances are locked to the selected term and then mature or roll off. Enter percentage points." state={state} update={update} disabled={disabled} error={errors?.termDepositRate}/>
          <label className="field"><strong>Term</strong><select value={state.termDepositTenorMonths} disabled={disabled} onChange={e=>update('termDepositTenorMonths',e.target.value)}><option value="12">1 year</option><option value="24">2 years</option><option value="36">3 years</option></select><small>Longer terms improve funding stability but lock in pricing for longer.</small></label>
        </div>
      </details>
    </>}

    {department==='Lending'&&<>
      <div className="loan-policy-grid" aria-label="Lending product policies">
        <div className="loan-policy-row"><div><strong>Mortgages</strong><small>Low loss / long duration</small></div><PercentageField field="mortgageRate" label="New rate" hint="Price versus competing mortgages. Enter percentage points." state={state} update={update} disabled={disabled} error={errors?.mortgageRate}/><RatioField field="mortgageUnderwritingTightness" label="Selectivity" hint="0 loose · 1 tight" state={state} update={update} disabled={disabled} error={errors?.mortgageUnderwritingTightness}/></div>
        <div className="loan-policy-row"><div><strong>Personal credit</strong><small>Higher yield / higher loss</small></div><PercentageField field="consumerLoanRate" label="New rate" hint="Personal loans and revolving credit. Enter percentage points." state={state} update={update} disabled={disabled} error={errors?.consumerLoanRate}/><RatioField field="consumerUnderwritingTightness" label="Selectivity" hint="0 loose · 1 tight" state={state} update={update} disabled={disabled} error={errors?.consumerUnderwritingTightness}/></div>
        <div className="loan-policy-row"><div><strong>SME & business</strong><small>Cyclical / capital-intensive</small></div><PercentageField field="corporateLoanRate" label="New rate" hint="Price versus business-credit market. Enter percentage points." state={state} update={update} disabled={disabled} error={errors?.corporateLoanRate}/><RatioField field="corporateUnderwritingTightness" label="Selectivity" hint="0 loose · 1 tight" state={state} update={update} disabled={disabled} error={errors?.corporateUnderwritingTightness}/></div>
      </div>
      <details className="department-advanced policy-disclosure">
        <summary>Mortgage structure</summary>
        <p className="muted">Shape credit risk and IRRBB without adding another product card.</p>
        <div className="policy-fields">
          <label className="field"><strong>Maximum LTV</strong><select value={state.mortgageMaxLtv} disabled={disabled} onChange={e=>update('mortgageMaxLtv',e.target.value)}><option value="0.60">60%</option><option value="0.75">75%</option><option value="0.85">85%</option><option value="0.90">90%</option><option value="0.95">95%</option></select><small>Higher LTV expands addressable demand but worsens loss severity and stress risk.</small></label>
          <label className="field"><strong>Initial fixed period</strong><select value={state.mortgageFixedPeriodMonths} disabled={disabled} onChange={e=>update('mortgageFixedPeriodMonths',e.target.value)}><option value="24">2 years</option><option value="36">3 years</option><option value="60">5 years</option></select><small>Longer fixes reduce near-term repricing but increase duration/EVE exposure.</small></label>
        </div>
      </details>
    </>}

    {department==='Capital'&&<>
      <div className="policy-fields policy-fields-primary">
        <PercentageField field="dividendPayoutRatio" label="Share of profit paid out" hint="Retained earnings build CET1; prudential restrictions still override this policy. Enter percentage points." state={state} update={update} disabled={disabled} error={errors?.dividendPayoutRatio}/>
      </div>
      <p className="muted">AT1 coupons remain discretionary and are subject to buffers and distribution restrictions; newly issued AT1 uses its market-clearing coupon.</p>
    </>}

    {department==='Capital'&&<CapitalMarketsTicket state={state} onChange={onChange} disabled={disabled} errors={errors} quote={localCapitalQueued?capitalMarketsQuote:undefined} planImpact={capitalMarketsPlanImpact} allowedInstruments={['cet1']} title="Equity issuance" otherArea="Treasury & Funding"/>}
    {department==='Treasury'&&<CapitalMarketsTicket state={state} onChange={onChange} disabled={disabled} errors={errors} quote={localCapitalQueued?capitalMarketsQuote:undefined} planImpact={capitalMarketsPlanImpact} allowedInstruments={treasuryCapitalInstruments} title="Wholesale funding markets" otherArea="Finance & Capital"/>}

    {department==='Treasury'&&<>
      <div className="policy-fields policy-fields-primary">
        <label className="field"><strong>Gilt transaction</strong><select value={state.giltTradeDirection} disabled={disabled} onChange={e=>setGiltDirection(e.target.value as ActionFormState['giltTradeDirection'])}><option value="none">No gilt trade queued</option><option value="buy">Buy gilts</option><option value="sell">Sell gilts</option></select><small>Buying invests BoE reserves; selling returns the proceeds to reserves.</small></label>
        <MoneyField field="giltTradeAmount" label="Gilt trade amount (£)" hint="Executed once on the next monthly close." state={state} update={update} disabled={disabled||state.giltTradeDirection==='none'} error={errors?.giltTradeAmount} placeholder="e.g. 250m" maxAmount={state.giltTradeDirection==='sell'?maxGiltSaleAmount:undefined}/>
        <label className="field"><strong>Maturity</strong><select value={state.giltDurationYears} disabled={disabled||state.giltTradeDirection==='none'||state.giltTradeDirection==='sell'} onChange={e=>update('giltDurationYears',e.target.value)}><option value="2">2 years</option><option value="5">5 years</option><option value="10">10 years</option></select><small>{state.giltTradeDirection==='sell'?'Sales reduce the existing unencumbered portfolio proportionally across its maturity ladder.':giltQuotedYield!==undefined?`Current simulated gilt yield: ${formatPct(giltQuotedYield)}. Purchases lock this coupon/yield into the new vintage.`:'Select Buy gilts to choose a purchase maturity.'}</small></label>
      </div>
      {state.giltTradeDirection!=='none'&&<button className="button ghost" disabled={disabled} onClick={()=>setGiltDirection('none')}>Cancel gilt transaction</button>}
      <p className="muted">Doing nothing is a valid treasury choice: deposit inflows, loan repayments, interest receipts and maturing securities can accumulate as reserves. New lending can then draw those reserves back down.</p>
      <details className="department-advanced policy-disclosure"><summary>Central-bank funding</summary><p className="muted">Bank of England secured funding remains available for structural or contingency liquidity needs.</p><div className="policy-fields"><label className="field"><strong>Bank of England facility</strong><select value={state.boeFacility} disabled={disabled} onChange={e=>setBoeFacility(e.target.value as ActionFormState['boeFacility'])}><option value="none">No drawing queued</option><option value="STR">STR · 1 week / Level A collateral</option><option value="ILTR">ILTR · 6 months</option></select><small>Secured reserves. Usage is modelled as routine sterling liquidity management, not an automatic distress signal.</small></label><MoneyField field="boeFundingAmount" label="BoE drawing once (£)" hint="Limited by available eligible gilt collateral and haircut." state={state} update={update} disabled={disabled||state.boeFacility==='none'} error={errors?.boeFundingAmount} placeholder="e.g. 250m" maxAmount={state.boeFacility==='none'?undefined:maxBoeFundingAmount}/></div>{state.boeFacility!=='none'&&<button className="button ghost" disabled={disabled} onClick={()=>setBoeFacility('none')}>Cancel Bank of England drawing</button>}</details>
      <details className="department-advanced policy-disclosure"><summary>Interest-rate hedging</summary><p className="muted">Use swaps after changing the structural asset/liability mix when residual IRRBB remains material.</p><label className="field"><strong>Swap direction</strong><select value={state.hedgeDirection} disabled={disabled} onChange={e=>setHedgeDirection(e.target.value as ActionFormState['hedgeDirection'])}><option value="none">No swap queued</option><option value="payFixedReceiveFloat">Pay fixed, receive floating</option><option value="receiveFixedPayFloat">Receive fixed, pay floating</option></select></label><div className="policy-fields"><MoneyField field="hedgeNotional" label="Swap notional (£)" hint="Executed once when a direction is selected." state={state} update={update} disabled={disabled||state.hedgeDirection==='none'} error={errors?.hedgeNotional}/><label className="field"><strong>Swap term</strong><select value={state.hedgeMaturityMonths} disabled={disabled||state.hedgeDirection==='none'} onChange={e=>update('hedgeMaturityMonths',e.target.value)}><option value="12">1 year</option><option value="24">2 years</option><option value="60">5 years</option></select><small>Longer swaps hedge more structural duration.</small></label></div>{state.hedgeDirection!=='none'&&<button className="button ghost" disabled={disabled} onClick={()=>setHedgeDirection('none')}>Cancel swap transaction</button>}</details>
    </>}

    <small>Rate and payout fields use percentage points: entering 3.5 means 3.5%. Amounts accept £, k, m and bn. Editing pauses time.</small>
  </div>;
}
