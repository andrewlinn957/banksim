import { Department } from '../game/departments';
export type { Department } from '../game/departments';
export interface ActionFormState {
  retailDepositRate: string;
  corporateDepositRate: string;
  mortgageRate: string;
  corporateLoanRate: string;
  mortgageUnderwritingTightness: string;
  corporateUnderwritingTightness: string;
  issueLTDebtAmount: string;
  issueEquityAmount: string;
  dividendPayoutRatio: string;
  at1CouponMode: 'auto' | 'pay' | 'skip';
  hedgeDirection: 'none' | 'payFixedReceiveFloat' | 'receiveFixedPayFloat';
  hedgeNotional: string;
  hedgeFixedRate: string;
  hedgeMaturityMonths: string;
}


interface Props { department: Department; state: ActionFormState; onChange: (s: ActionFormState) => void; disabled?: boolean; errors?: Partial<Record<keyof ActionFormState,string>>; hasValidationErrors?: boolean; onNavigateHelp?: (id:string)=>void; }
const fields: Record<Department, [keyof ActionFormState,string,string][]> = {
  Customers: [['retailDepositRate','Retail savings offer','A higher offer retains savers, but costs interest on existing deposits too.'],['corporateDepositRate','Business deposit offer','Business balances react faster to competing offers.']],
  Lending: [['mortgageRate','New mortgage rate','Lower prices attract applications. Existing fixed-rate loans keep their coupons.'],['corporateLoanRate','New business loan rate','Better margins can reduce demand and attract riskier borrowers.'],['mortgageUnderwritingTightness','Mortgage selectivity (0–1)','0 accepts more applicants; 1 is most selective.'],['corporateUnderwritingTightness','Business selectivity (0–1)','Standards affect new vintages, not the loans already on your books.']],
  Capital: [['dividendPayoutRatio','Share of profit paid out (0–1)','Retained earnings build capital. Prudential restrictions still apply.'],['issueEquityAmount','Raise equity once (£)','Executed next month, then cleared. New shares dilute existing owners.']],
  Treasury: [['issueLTDebtAmount','Raise term debt once (£)','Executed next month, then cleared. Provides cash and stable funding, with future interest costs.'],['hedgeNotional','Swap notional (£)','Executed once when a direction is selected.'],['hedgeFixedRate','Fixed swap rate','Off-market terms require an upfront payment.'],['hedgeMaturityMonths','Swap term (months)','The swap remains on the books until maturity.']],
};
const inputLabels=Object.fromEntries(Object.entries(fields).flatMap(([department,items])=>items.map(([key,label])=>[key,`${department} · ${label}`])));
export default function ActionsPanel({department,state,onChange,disabled,errors,hasValidationErrors,onNavigateHelp}:Props) {
 const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});
 return <div className="stack">
  <div className="policy-section-title"><h3>{department==='Treasury'?'Funding orders':'Standing policy'}</h3><small>Changes apply at the next monthly close.</small></div>
  {hasValidationErrors && <div role="alert" className="alert danger">Fix these inputs before advancing time: {Object.entries(errors??{}).map(([k,v])=><div key={k}>{inputLabels[k]??'Policy input'}: {v}</div>)}</div>}
  <div className="policy-fields">{fields[department].filter(([key]) => !key.startsWith('hedge')).map(([key,label,hint])=><label className="field" key={key}><strong>{label}</strong><input inputMode="decimal" value={state[key]} disabled={disabled} aria-invalid={!!errors?.[key]} onChange={e=>update(key,e.target.value)} placeholder={key.includes('Amount')?'e.g. 100m':'e.g. 3.5%'}/><small>{hint}</small>{errors?.[key]&&<span role="alert">{errors[key]}</span>}</label>)}</div>
  {department==='Capital'&&<label className="field">AT1 coupons<select value={state.at1CouponMode} disabled={disabled} onChange={e=>update('at1CouponMode',e.target.value)}><option value="auto">Automatic, subject to buffers</option><option value="pay">Request payment</option><option value="skip">Skip payment</option></select></label>}
  {department==='Treasury'&&<details className="department-advanced"><summary>Interest-rate hedging</summary><p className="muted">A swap changes rate exposure and creates future payments. Review the notional, rate and term before queuing it.</p><div className="policy-fields">{fields.Treasury.filter(([key])=>key.startsWith('hedge')).map(([key,label,hint])=><label className="field" key={key}><strong>{label}</strong><input inputMode="decimal" value={state[key]} disabled={disabled} aria-invalid={!!errors?.[key]} onChange={e=>update(key,e.target.value)}/><small>{hint}</small>{errors?.[key]&&<span role="alert">{errors[key]}</span>}</label>)}</div><label className="field">Swap direction<select value={state.hedgeDirection} disabled={disabled} onChange={e=>update('hedgeDirection',e.target.value)}><option value="none">No swap queued</option><option value="payFixedReceiveFloat">Pay fixed, receive floating</option><option value="receiveFixedPayFloat">Receive fixed, pay floating</option></select></label></details>}
  {(department==='Treasury'||department==='Capital')&&<button className="button ghost" disabled={disabled} onClick={()=>onChange(department==='Capital'?{...state,issueEquityAmount:''}:{...state,issueLTDebtAmount:'',hedgeDirection:'none',hedgeNotional:''})}>Cancel this department’s queued transactions</button>}
  <small>Rates accept % or bps; amounts accept £, m and bn. Editing pauses time. Pricing and payout policies persist; transactions execute once.</small>
  <button className="button ghost" onClick={()=>onNavigateHelp?.(department==='Customers'?'deposit-behaviour':department==='Lending'?'loan-pipeline':department==='Capital'?'capital-policy-and-distributions':'funding-ladder-and-rollover')}>Explain this department</button>
 </div>;
}
