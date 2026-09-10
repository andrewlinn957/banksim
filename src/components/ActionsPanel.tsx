import { Department } from '../game/departments';
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
  issueLTDebtAmount: string;
  issueEquityAmount: string;
  issueTier2Amount: string;
  dividendPayoutRatio: string;
  at1CouponMode: 'auto' | 'pay' | 'skip';
  giltShareOfHqla: string;
  giltDurationYears: string;
  boeFacility: 'none' | 'STR' | 'ILTR';
  boeFundingAmount: string;
  hedgeDirection: 'none' | 'payFixedReceiveFloat' | 'receiveFixedPayFloat';
  hedgeNotional: string;
  hedgeFixedRate: string;
  hedgeMaturityMonths: string;
}

interface Props {
  department: Department;
  state: ActionFormState;
  onChange: (s: ActionFormState) => void;
  disabled?: boolean;
  errors?: Partial<Record<keyof ActionFormState,string>>;
  hasValidationErrors?: boolean;
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
  issueLTDebtAmount:'Long-term debt amount', issueEquityAmount:'CET1 equity amount', issueTier2Amount:'Tier 2 amount',
  boeFundingAmount:'BoE drawing amount', hedgeNotional:'Swap notional', hedgeFixedRate:'Swap fixed rate', dividendPayoutRatio:'Profit payout',
  giltShareOfHqla:'Gilt share after rebalance',
};

export default function ActionsPanel({department,state,onChange,disabled,errors,hasValidationErrors}:Props) {
  const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});
  const firstError = Object.entries(errors ?? {}).find(([,message]) => !!message) as [keyof ActionFormState,string] | undefined;

  return <div className="stack department-policy-panel">
    <div className="policy-section-title"><h3>{department==='Treasury'?'Treasury actions':'Standing policy'}</h3><small>{department==='Treasury'?'Uninvested cash remains in the Bank of England reserve account. Treasury trades occur only when you change an instruction.':'Standing choices persist. One-off transactions clear after execution.'}</small></div>
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
      <details className="department-advanced policy-disclosure"><summary>Capital issuance</summary><p className="muted">Use only when organic capital generation is not enough. Tier 2 supports total capital, but not CET1 or leverage.</p><div className="policy-fields"><Field field="issueEquityAmount" label="Raise CET1 equity once (£)" hint="Strongest capital, but dilutes existing owners." state={state} update={update} disabled={disabled} error={errors?.issueEquityAmount} placeholder="e.g. 100m"/><Field field="issueTier2Amount" label="Raise Tier 2 once (£)" hint="Cheaper subordinated capital; counts only toward total capital." state={state} update={update} disabled={disabled} error={errors?.issueTier2Amount} placeholder="e.g. 100m"/></div></details>
      <p className="muted">AT1 coupons are handled automatically according to buffers and distribution restrictions.</p>
    </>}

    {department==='Treasury'&&<>
      <div className="policy-fields policy-fields-primary">
        <label className="field"><strong>Rebalance gilt share now</strong><input inputMode="decimal" value={state.giltShareOfHqla} disabled={disabled} aria-invalid={!!errors?.giltShareOfHqla} onChange={e=>update('giltShareOfHqla',e.target.value)}/><small>One-off rebalance between BoE reserves and gilts. If you leave this unchanged, cash is not automatically invested as the balance sheet evolves.</small>{errors?.giltShareOfHqla&&<span role="alert">{errors.giltShareOfHqla}</span>}</label>
        <label className="field"><strong>Gilt maturity for this rebalance</strong><select value={state.giltDurationYears} disabled={disabled} onChange={e=>update('giltDurationYears',e.target.value)}><option value="2">2 years</option><option value="5">5 years</option><option value="10">10 years</option></select><small>New gilt purchases are intended to use the corresponding point on the simulated gilt curve. Longer maturities add more market-value and EVE sensitivity.</small></label>
      </div>
      <p className="muted">Doing nothing is a valid treasury choice: deposit inflows, loan repayments, interest receipts and maturing securities can accumulate as reserves. New lending can then draw those reserves back down.</p>
      <details className="department-advanced policy-disclosure"><summary>Funding actions</summary><p className="muted">Term retail savings should normally do more of the funding work. Wholesale debt and central-bank secured funding remain available for structural or contingency needs.</p><div className="policy-fields"><Field field="issueLTDebtAmount" label="Raise long-term debt once (£)" hint="Stable wholesale funding with future interest and maturity costs." state={state} update={update} disabled={disabled} error={errors?.issueLTDebtAmount} placeholder="e.g. 250m"/><label className="field"><strong>Bank of England facility</strong><select value={state.boeFacility} disabled={disabled} onChange={e=>update('boeFacility',e.target.value)}><option value="none">No drawing queued</option><option value="STR">STR · 1 week / Level A collateral</option><option value="ILTR">ILTR · 6 months</option></select><small>Secured reserves. Usage is modelled as routine sterling liquidity management, not an automatic distress signal.</small></label><Field field="boeFundingAmount" label="BoE drawing once (£)" hint="Limited by available eligible gilt collateral and haircut." state={state} update={update} disabled={disabled} error={errors?.boeFundingAmount} placeholder="e.g. 250m"/></div></details>
      <details className="department-advanced policy-disclosure"><summary>Interest-rate hedging</summary><p className="muted">Use swaps after changing the structural asset/liability mix when residual IRRBB remains material.</p><div className="policy-fields"><Field field="hedgeNotional" label="Swap notional (£)" hint="Executed once when a direction is selected." state={state} update={update} disabled={disabled} error={errors?.hedgeNotional}/><label className="field"><strong>Swap term</strong><select value={state.hedgeMaturityMonths} disabled={disabled} onChange={e=>update('hedgeMaturityMonths',e.target.value)}><option value="12">1 year</option><option value="24">2 years</option><option value="60">5 years</option></select><small>Longer swaps hedge more structural duration.</small></label></div><label className="field"><strong>Swap direction</strong><select value={state.hedgeDirection} disabled={disabled} onChange={e=>update('hedgeDirection',e.target.value)}><option value="none">No swap queued</option><option value="payFixedReceiveFloat">Pay fixed, receive floating</option><option value="receiveFixedPayFloat">Receive fixed, pay floating</option></select></label></details>
    </>}

    {(department==='Treasury'||department==='Capital')&&<button className="button ghost" disabled={disabled} onClick={()=>onChange(department==='Capital'?{...state,issueEquityAmount:'',issueTier2Amount:''}:{...state,issueLTDebtAmount:'',boeFacility:'none',boeFundingAmount:'',hedgeDirection:'none',hedgeNotional:''})}>Cancel queued transactions</button>}
    <small>Rates accept % or bps; amounts accept £, m and bn. Editing pauses time.</small>
  </div>;
}