import { BankState } from '../domain/bankState';
import { Department, departmentSummary } from '../game/departments';
import { BoardDecision, boardDecisions } from '../game/boardroom';
import ActionsPanel, { ActionFormState } from './ActionsPanel';
import { periodHistory } from '../game/management';
import { formatCurrency, formatSignedPct } from '../utils/formatters';
interface Props {
 department:Department; state:BankState; history:BankState[]; form:ActionFormState;
 errors:Partial<Record<keyof ActionFormState,string>>; hasErrors:boolean; selected:string[];
 onChange:(form:ActionFormState)=>void; onDecision:(decision:BoardDecision)=>void;
 onReport:(tab:string)=>void; onHelp:(id:string)=>void; estimate:BankState|null;
}
const proposalDepartment:Record<string,Department>={savers:'Customers',growth:'Lending',quality:'Lending',capital:'Capital',funding:'Treasury',hedge:'Treasury'};
export default function DepartmentOffice({department,state,history,form,errors,hasErrors,selected,onChange,onDecision,onReport,onHelp,estimate}:Props) {
 const summary=departmentSummary(department,state,history);
 const period=periodHistory(history,3).at(-1);
 const proposals=boardDecisions(state).filter(d=>proposalDepartment[d.id]===department);
 return <div className="department-office">
  <p className="office-status">{summary.status}<small>{period?`${period.label} · ${period.months}/3 months closed`:'Opening position · no months closed'}</small></p>
  <dl className="department-metrics">{summary.metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
  <p className="department-consequence">{summary.explanation}</p>
  {proposals.length>0&&<details className="department-advanced"><summary>Advice from your department head</summary>{proposals.map(d=><article className="office-advice" key={d.id}><h3>{d.title}</h3><p>{d.benefit}. {d.tradeoff}.</p><button className="button" disabled={state.status.hasFailed} onClick={()=>onDecision(d)}>{selected.includes(d.id)?'In your policy ✓':'Use these terms'}</button></article>)}</details>}
  <ActionsPanel department={department} state={form} onChange={onChange} disabled={state.status.hasFailed} errors={errors} hasValidationErrors={hasErrors} onNavigateHelp={onHelp}/>
  <details className="department-advanced"><summary>Estimate the next close</summary>{estimate?<><p className="muted">Whole-bank estimate with all queued policies and orders. This is not the isolated impact of this department.</p><dl className="department-metrics"><div><dt>Estimated monthly profit</dt><dd>{formatCurrency(estimate.financial.incomeStatement.netIncome)}</dd></div><div><dt>Estimated CET1 ratio movement</dt><dd>{formatSignedPct(estimate.risk.riskMetrics.cet1Ratio-state.risk.riskMetrics.cet1Ratio)}</dd></div></dl></>:<p>Pause time and correct any invalid inputs to calculate an estimate.</p>}</details>
  <button className="button report-link" onClick={()=>onReport(summary.reportTab)}>{summary.reportLabel} →</button>
 </div>;
}
