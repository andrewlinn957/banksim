import { useState } from 'react';
import { Recommendation } from '../engine/recommendations';
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


export type Department = 'Customers' | 'Lending' | 'Capital' | 'Treasury';
interface Props { state: ActionFormState; onChange: (s: ActionFormState) => void; onSubmit: () => void; disabled?: boolean; errors?: Partial<Record<keyof ActionFormState,string>>; hasValidationErrors?: boolean; recommendations?: Recommendation[]; onNavigateHelp?: (id:string)=>void; }
const fields: Record<Department, [keyof ActionFormState,string,string][]> = {
  Customers: [['retailDepositRate','Retail savings offer','A higher offer retains savers, but costs interest on existing deposits too.'],['corporateDepositRate','Business deposit offer','Business balances react faster to competing offers.']],
  Lending: [['mortgageRate','New mortgage rate','Lower prices attract applications. Existing fixed-rate loans keep their coupons.'],['corporateLoanRate','New business loan rate','Better margins can reduce demand and attract riskier borrowers.'],['mortgageUnderwritingTightness','Mortgage selectivity (0–1)','0 accepts more applicants; 1 is most selective.'],['corporateUnderwritingTightness','Business selectivity (0–1)','Standards affect new vintages, not the loans already on your books.']],
  Capital: [['dividendPayoutRatio','Share of profit paid out (0–1)','Retained earnings build capital. Prudential restrictions still apply.'],['issueEquityAmount','Raise equity once (£)','Executed next month, then cleared. New shares dilute existing owners.']],
  Treasury: [['issueLTDebtAmount','Raise term debt once (£)','Executed next month, then cleared. Provides cash and stable funding, with future interest costs.'],['hedgeNotional','Swap notional (£)','Executed once when a direction is selected.'],['hedgeFixedRate','Fixed swap rate','Off-market terms require an upfront payment.'],['hedgeMaturityMonths','Swap term (months)','The swap remains on the books until maturity.']],
};
const explanation: Record<Department,string> = {
 Customers: 'Offer → customer retention → funding cost → earnings. Give a pricing policy several quarters to show its effect.',
 Lending: 'Applications → approvals → drawdowns → interest → credit losses. Building a loan book takes years.',
 Capital: 'Profit → retained earnings → capital headroom → room to lend. Equity issuance is an exceptional transaction.',
 Treasury: 'Funding → cash buffer → resilience. Debt is funding, not loss-absorbing equity. Swaps exchange interest-rate exposure.',
};
export default function ActionsPanel({state,onChange,onSubmit,disabled,errors,hasValidationErrors,onNavigateHelp}:Props) {
 const [department,setDepartment]=useState<Department>('Customers');
 const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});
 return <div className="stack">
  <nav className="department-tabs" aria-label="Policy departments">{(Object.keys(fields) as Department[]).map(d=><button key={d} className={`button ${d===department?'primary':''}`} aria-pressed={d===department} onClick={()=>setDepartment(d)}>{d}{fields[d].some(([k])=>errors?.[k])?' !':''}</button>)}</nav>
  <p className="causal-strip">{explanation[department]}</p>
  <div className="policy-persistence"><strong>Standing instructions</strong><span>Pricing, underwriting and payout settings persist until you change them. Funding and swap transactions execute once.</span></div>
  {hasValidationErrors && <div role="alert" className="alert danger">Fix these inputs before advancing time: {Object.entries(errors??{}).map(([k,v])=><div key={k}>{k}: {v}</div>)}</div>}
  <div className="policy-fields">{fields[department].map(([key,label,hint])=><label className="field" key={key}><strong>{label}</strong><input inputMode="decimal" value={state[key]} disabled={disabled} aria-invalid={!!errors?.[key]} onChange={e=>update(key,e.target.value)} placeholder={key.includes('Amount')?'e.g. 100m':'e.g. 3.5%'}/><small>{hint}</small>{errors?.[key]&&<span role="alert">{errors[key]}</span>}</label>)}</div>
  {department==='Capital'&&<label className="field">AT1 coupons<select value={state.at1CouponMode} disabled={disabled} onChange={e=>update('at1CouponMode',e.target.value)}><option value="auto">Automatic, subject to buffers</option><option value="pay">Request payment</option><option value="skip">Skip payment</option></select></label>}
  {department==='Treasury'&&<label className="field">Swap direction<select value={state.hedgeDirection} disabled={disabled} onChange={e=>update('hedgeDirection',e.target.value)}><option value="none">No swap queued</option><option value="payFixedReceiveFloat">Pay fixed, receive floating</option><option value="receiveFixedPayFloat">Receive fixed, pay floating</option></select><button className="button ghost" disabled={disabled} onClick={()=>onChange({...state,issueLTDebtAmount:'',issueEquityAmount:'',hedgeDirection:'none',hedgeNotional:''})}>Clear queued transactions</button></label>}
  <small>Rates accept % or bps. Amounts accept £, m and bn. Edits update your plan immediately; time stays paused.</small>
  <button className="button primary" onClick={onSubmit} disabled={Boolean(hasValidationErrors)}>Done · return to bank</button>
  <button className="button ghost" onClick={()=>onNavigateHelp?.(department==='Customers'?'deposit-behaviour':department==='Lending'?'loan-pipeline':department==='Capital'?'capital-policy-and-distributions':'funding-ladder-and-rollover')}>Explain this department</button>
 </div>;
}
