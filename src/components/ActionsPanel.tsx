import { Department } from '../game/departments';
import type { CapitalMarketsBookbuildResult, CapitalMarketsInstrument } from '../domain/capitalMarkets';
import { CAPITAL_MARKETS_INSTRUMENT_ORDER, getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { formatCurrency, formatPct } from '../utils/formatters';
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
  type?: 'number' | 'text';
}

const Field = ({label,hint,field,state,update,disabled,error,placeholder}:FieldProps) => (
  <label className="field">
    <strong>{label}</strong>
    <input inputMode="decimal" value={state[field]} disabled={disabled} aria-invalid={!!error} onChange={e=>update(field,e.target.value)} placeholder={placeholder}/>
    <small>{hint}</small>
    {error&&<span role="alert">{error}</span>}
  </label>
);

const FIELD_LABELS: Partial<Record<keyof ActionFormState,string>> = {
  retailCurrentAccountRate:'Retail current account rate', termDepositRate:'Fixed-term savings offer', corporateDepositRate:'SME/business deposit offer',
  mortgageRate:'Mortgage new rate', consumerLoanRate:'Personal-credit new rate', corporateLoanRate:'SME/business new rate',
  mortgageUnderwritingTightness:'Mortgage selectivity', consumerUnderwritingTightness:'Personal-credit selectivity', corporateUnderwritingTightness:'SME/business selectivity',
  capitalMarketsTargetAmount:'Capital-markets target amount', capitalMarketsMaxDiscount:'Maximum equity discount', capitalMarketsMaxSpreadBps:'Maximum spread',
  boeFundingAmount:'BoE drawing amount', hedgeNotional:'Swap notional', hedgeFixedRate:'Swap fixed rate', dividendPayoutRatio:'Profit payout',
  giltTradeAmount:'Gilt trade amount',
};

const tenorLabel = (months: number): string =>
  months % 12 === 0 ? `${months / 12} years` : `${months} months`;

const CapitalMarketsTicket = ({state,update,disabled,errors,quote,planImpact,allowedInstruments,title}:{state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;errors?:Partial<Record<keyof ActionFormState,string>>;quote?:CapitalMarketsBookbuildResult;planImpact?:CapitalMarketsPlanImpact;allowedInstruments:CapitalMarketsInstrument[];title:string}) => {
  const queuedInstrument = state.capitalMarketsInstrument;
  const instrument = queuedInstrument !== 'none' && allowedInstruments.includes(queuedInstrument) ? queuedInstrument : 'none';
  const queuedElsewhere = queuedInstrument !== 'none' && instrument === 'none';
  const definition = instrument === 'none' ? undefined : getCapitalMarketsInstrument(instrument);
  const isDiscountPriced = definition?.pricingKind === 'discount';
  const tenors = definition?.permittedTenorMonths ?? [];
  const allInYield = quote?.marketReferenceRate !== undefined && quote.clearingSpreadBps !== undefined
    ? quote.marketReferenceRate + quote.clearingSpreadBps / 10000
    : undefined;
  return <section className="policy-disclosure capital-markets-ticket" aria-label="Capital markets">
    <div className="policy-section-title"><h3>{title}</h3><small>One transaction ticket. Market demand and clearing terms determine what actually settles.</small></div>
    <div className="policy-fields policy-fields-primary">
      <label className="field"><strong>Instrument</strong><select value={instrument} disabled={disabled} onChange={e=>update('capitalMarketsInstrument',e.target.value)}><option value="none">No transaction queued</option>{CAPITAL_MARKETS_INSTRUMENT_ORDER.filter(key=>allowedInstruments.includes(key)).map(key => { const item=getCapitalMarketsInstrument(key); return <option key={key} value={key}>{item.label}</option>; })}</select><small>Choose the claim you want investors to buy.</small></label>
      <Field field="capitalMarketsTargetAmount" label="Target size (£)" hint="The book can be partially filled if investor demand is smaller than your target." state={state} update={update} disabled={disabled||!definition} error={errors?.capitalMarketsTargetAmount} placeholder="e.g. 150m"/>
      {isDiscountPriced
        ? <Field field="capitalMarketsMaxDiscount" label="Maximum acceptable discount" hint="The deal fails rather than price below this limit." state={state} update={update} disabled={disabled} error={errors?.capitalMarketsMaxDiscount} placeholder="e.g. 12%"/>
        : <Field field="capitalMarketsMaxSpreadBps" label="Maximum acceptable spread (bp)" hint="The deal fails if the clearing spread is wider than this limit." state={state} update={update} disabled={disabled||!definition} error={errors?.capitalMarketsMaxSpreadBps} placeholder="e.g. 750"/>}
      {tenors.length>0&&<label className="field"><strong>Tenor</strong><select value={state.capitalMarketsTenorMonths} disabled={disabled} onChange={e=>update('capitalMarketsTenorMonths',e.target.value)}>{tenors.map(tenor=><option key={tenor} value={tenor}>{tenorLabel(tenor)}</option>)}</select><small>Longer debt locks in the clearing cost for longer.</small></label>}
    </div>
    {queuedElsewhere&&<div className="muted">A capital-markets transaction is queued in the other management area.</div>}
    {definition&&quote&&<div className={`alert ${quote.status.startsWith('failed')?'warning':'info'} capital-markets-book`}>
      <strong>Indicative book · {definition.label}</strong>
      <div className="muted">Demand {formatCurrency(quote.demandAmount)} · coverage {quote.coverageRatio.toFixed(2)}× · executable {formatCurrency(quote.executedAmount)} of {formatCurrency(quote.targetAmount)}</div>
      <div className="muted">{isDiscountPriced?`Clearing discount ${formatPct(quote.clearingDiscount??0)} · issue price £${(quote.issuePrice??0).toFixed(3)}`:`Clearing spread ${(quote.clearingSpreadBps??0).toFixed(0)}bp${allInYield!==undefined?` · all-in yield ${formatPct(allInYield)}`:''}`} · {quote.status.replace('-', ' ')}</div>
      {quote.fees>0&&<div className="muted">Fees {formatCurrency(quote.fees)} · net proceeds {formatCurrency(quote.netProceeds)}</div>}
      {quote.recentIssuanceRatio>0&&<div className="muted">Recent issuance is reducing market capacity and worsening clearing terms.</div>}
    </div>}
    {definition&&planImpact&&<div className="capital-markets-plan-impact"><strong>Three-Year Plan impact</strong><div className="muted">One-month preview: CET1 {formatPct(planImpact.cet1Before)} → {formatPct(planImpact.cet1After)} · EPS {(planImpact.epsBefore*100).toFixed(1)}p → {(planImpact.epsAfter*100).toFixed(1)}p.</div><div className="muted">There is no direct Board Confidence effect: the transaction matters only through the plan metrics it changes.</div></div>}
    <p className="muted">Bookbuild terms are indicative until the monthly close. A failed price limit records the attempt but settles no capital or funding.</p>
  </section>;
};

export default function ActionsPanel({department,state,onChange,disabled,errors,hasValidationErrors,giltQuotedYield,capitalMarketsQuote,capitalMarketsPlanImpact}:Props) {
  const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});
  const firstError = Object.entries(errors ?? {}).find(([,message]) => !!message) as [keyof ActionFormState,string] | undefined;

  return <div className="stack department-policy-panel">
    <div className="policy-section-title"><h3>{department==='Treasury'?'Treasury actions':'Standing policy'}</h3><small>{department==='Treasury'?'Uninvested cash remains in the Bank of England reserve account. Gilt purchases and sales are explicit one-off transactions.':'Standing choices persist. One-off transactions clear after execution.'}</small></div>
    {hasValidationErrors && <div role="alert" className="alert danger">Fix invalid inputs before advancing time.{firstError && <> <strong>{FIELD_LABELS[firstError[0]] ?? firstError[0]}:</strong> {firstError[1]}</>}</div>}

    {department==='Customers'&&<>
      <div className="policy-fields policy-fields-primary">
        <Field field="retailCurrentAccountRate" label="Retail current account rate" hint="Interest rate paid on retail current-account balances." state={state} update={update} disabled={disabled} error={errors?.retailCurrentAccountRate} placeholder="e.g. 3.5%"/>
        <Field field="corporateDepositRate" label="SME/business deposit offer" hint="Business balances are less stable and react faster to competing offers." state={state} update={update} disabled={disabled} error={errors?.corporateDepositRate} placeholder="e.g. 3.0%"/>
      </div>
      <details className="department-advanced policy-disclosure">
        <summary>Fixed-term savings</summary>
        <p className="muted">Use contractual retail funding when you want more stable funding at the cost of a higher fixed rate and future maturity wall.</p>
        <div className="policy-fields">
          <Field field="termDepositRate" label="Fixed-term savings offer" hint="New balances are locked to the selected term and then mature or roll off." state={state} update={update} disabled={disabled} error={errors?.termDepositRate} placeholder="e.g. 4.0%"/>
          <label className="field"><strong>Term</strong><select value={state.termDepositTenorMonths} disabled={disabled} onChange={e=>update('termDepositTenorMonths',e.target.value)}><option value="12">1 year</option><option value="24">2 years</option><option value="36">3 years</option></select><small>Longer terms improve funding stability but lock in pricing for longer.</small></label>
        </div>
      </details>
    </>}

    {department==='Lending'&&<>
      <div className="loan-policy-grid" aria-label="Lending product policies">
        <div className="loan-policy-row"><div><strong>Mortgages</strong><small>Low loss / long duration</small></div><Field field="mortgageRate" label="New rate" hint="Price versus competing mortgages." state={state} update={update} disabled={disabled} error={errors?.mortgageRate}/><Field field="mortgageUnderwritingTightness" label="Selectivity" hint="0 loose · 1 tight" state={state} update={update} disabled={disabled} error={errors?.mortgageUnderwritingTightness}/></div>
        <div className="loan-policy-row"><div><strong>Personal credit</strong><small>Higher yield / higher loss</small></div><Field field="consumerLoanRate" label="New rate" hint="Personal loans and revolving credit." state={state} update={update} disabled={disabled} error={errors?.consumerLoanRate}/><Field field="consumerUnderwritingTightness" label="Selectivity" hint="0 loose · 1 tight" state={state} update={update} disabled={disabled} error={errors?.consumerUnderwritingTightness}/></div>
        <div className="loan-policy-row"><div><strong>SME & business</strong><small>Cyclical / capital-intensive</small></div><Field field="corporateLoanRate" label="New rate" hint="Price versus business-credit market." state={state} update={update} disabled={disabled} error={errors?.corporateLoanRate}/><Field field="corporateUnderwritingTightness" label="Selectivity" hint="0 loose · 1 tight" state={state} update={update} disabled={disabled} error={errors?.corporateUnderwritingTightness}/></div>
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
        <Field field="dividendPayoutRatio" label="Share of profit paid out" hint="Retained earnings build CET1; prudential restrictions still override this policy." state={state} update={update} disabled={disabled} error={errors?.dividendPayoutRatio} placeholder="e.g. 20%"/>
      </div>
      <p className="muted">AT1 coupons remain discretionary and are subject to buffers and distribution restrictions; newly issued AT1 uses its market-clearing coupon.</p>
    </>}

    {department==='Capital'&&<CapitalMarketsTicket state={state} update={update} disabled={disabled} errors={errors} quote={capitalMarketsQuote} planImpact={capitalMarketsPlanImpact} allowedInstruments={['cet1']} title="Equity issuance"/>}
    {department==='Treasury'&&<CapitalMarketsTicket state={state} update={update} disabled={disabled} errors={errors} quote={capitalMarketsQuote} planImpact={capitalMarketsPlanImpact} allowedInstruments={['at1','tier2','senior']} title="Wholesale funding markets"/>} 

    {department==='Treasury'&&<>
      <div className="policy-fields policy-fields-primary">
        <label className="field"><strong>Gilt transaction</strong><select value={state.giltTradeDirection} disabled={disabled} onChange={e=>update('giltTradeDirection',e.target.value)}><option value="none">No gilt trade queued</option><option value="buy">Buy gilts</option><option value="sell">Sell gilts</option></select><small>Buying invests BoE reserves; selling returns the proceeds to reserves.</small></label>
        <Field field="giltTradeAmount" label="Gilt trade amount (£)" hint="Executed once on the next monthly close." state={state} update={update} disabled={disabled} error={errors?.giltTradeAmount} placeholder="e.g. 250m"/>
        <label className="field"><strong>Maturity</strong><select value={state.giltDurationYears} disabled={disabled||state.giltTradeDirection==='sell'} onChange={e=>update('giltDurationYears',e.target.value)}><option value="2">2 years</option><option value="5">5 years</option><option value="10">10 years</option></select><small>{state.giltTradeDirection==='sell'?'Sales reduce the existing portfolio proportionally across its maturity ladder.':giltQuotedYield!==undefined?`Current simulated gilt yield: ${formatPct(giltQuotedYield)}. Purchases lock this coupon/yield into the new vintage.`:'Purchase yield is taken from the corresponding point on the simulated gilt curve.'}</small></label>
      </div>
      <p className="muted">Doing nothing is a valid treasury choice: deposit inflows, loan repayments, interest receipts and maturing securities can accumulate as reserves. New lending can then draw those reserves back down.</p>
      <details className="department-advanced policy-disclosure"><summary>Central-bank funding</summary><p className="muted">Bank of England secured funding remains available for structural or contingency liquidity needs.</p><div className="policy-fields"><label className="field"><strong>Bank of England facility</strong><select value={state.boeFacility} disabled={disabled} onChange={e=>update('boeFacility',e.target.value)}><option value="none">No drawing queued</option><option value="STR">STR · 1 week / Level A collateral</option><option value="ILTR">ILTR · 6 months</option></select><small>Secured reserves. Usage is modelled as routine sterling liquidity management, not an automatic distress signal.</small></label><Field field="boeFundingAmount" label="BoE drawing once (£)" hint="Limited by available eligible gilt collateral and haircut." state={state} update={update} disabled={disabled} error={errors?.boeFundingAmount} placeholder="e.g. 250m"/></div></details>
      <details className="department-advanced policy-disclosure"><summary>Interest-rate hedging</summary><p className="muted">Use swaps after changing the structural asset/liability mix when residual IRRBB remains material.</p><div className="policy-fields"><Field field="hedgeNotional" label="Swap notional (£)" hint="Executed once when a direction is selected." state={state} update={update} disabled={disabled} error={errors?.hedgeNotional}/><label className="field"><strong>Swap term</strong><select value={state.hedgeMaturityMonths} disabled={disabled} onChange={e=>update('hedgeMaturityMonths',e.target.value)}><option value="12">1 year</option><option value="24">2 years</option><option value="60">5 years</option></select><small>Longer swaps hedge more structural duration.</small></label></div><label className="field"><strong>Swap direction</strong><select value={state.hedgeDirection} disabled={disabled} onChange={e=>update('hedgeDirection',e.target.value)}><option value="none">No swap queued</option><option value="payFixedReceiveFloat">Pay fixed, receive floating</option><option value="receiveFixedPayFloat">Receive fixed, pay floating</option></select></label></details>
    </>}

    {(department==='Treasury'||department==='Capital')&&<button className="button ghost" disabled={disabled} onClick={()=>onChange({...state,capitalMarketsInstrument:'none',capitalMarketsTargetAmount:'',giltTradeDirection:department==='Treasury'?'none':state.giltTradeDirection,giltTradeAmount:department==='Treasury'?'':state.giltTradeAmount,boeFacility:department==='Treasury'?'none':state.boeFacility,boeFundingAmount:department==='Treasury'?'':state.boeFundingAmount,hedgeDirection:department==='Treasury'?'none':state.hedgeDirection,hedgeNotional:department==='Treasury'?'':state.hedgeNotional})}>Cancel queued transactions</button>}
    <small>Rates accept % or bps; amounts accept £, m and bn. Editing pauses time.</small>
  </div>;
}
