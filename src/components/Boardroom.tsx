import { ReactNode, useEffect, useRef } from 'react';
import { BankState } from '../domain/bankState';
import { Department, departmentSummary } from '../game/departments';
import { periodHistory } from '../game/management';
import { formatCurrency, formatPct } from '../utils/formatters';
interface Props { state: BankState; history: BankState[]; department: Department | null; hasErrors: boolean; onDepartment: (department: Department) => void; onClose: () => void; children?: ReactNode; }
const departments: Department[] = ['Customers','Lending','Capital','Treasury'];
const jobs: Record<Department,string> = {Customers:'Set deposit offers',Lending:'Price loans & set standards',Capital:'Retain profit & raise equity',Treasury:'Fund the bank & manage hedges'};
export default function Boardroom({state,history,department,hasErrors,onDepartment,onClose,children}:Props) {
 const quarter=periodHistory(history,3).at(-1);
 const panel=useRef<HTMLElement|null>(null);
 const departmentButtons=useRef<Partial<Record<Department,HTMLButtonElement>>>({});
 const priorDepartment=useRef<Department|null>(null);
 useEffect(()=>{ if(department){ panel.current?.focus({preventScroll:true}); if(window.matchMedia('(max-width:1150px)').matches) panel.current?.scrollIntoView({block:'start'}); } else if(priorDepartment.current) departmentButtons.current[priorDepartment.current]?.focus(); priorDepartment.current=department; },[department]);
 return <main className={`bank-workspace ${department?'with-department':''}`}>
  <section className="bank-map" aria-label="Bank and departments">
   <div className="bank-map-heading"><span className="scene-kicker">CITY OF LONDON · THREADNEEDLE STREET</span><h1>Your bank</h1><p>{department?`${department} is open. Change its policy or let time run to watch the results.`:'Select a department to manage it. Your standing policies keep the bank running.'}</p></div>
   <nav className="bank-departments" aria-label="Manage a department">{departments.map(d=>{const summary=departmentSummary(d,state,history);return <button ref={el=>{departmentButtons.current[d]=el;}} key={d} className={`department-building ${department===d?'selected':''}`} aria-pressed={department===d} aria-controls={department?"department-workspace":undefined} onClick={()=>onDepartment(d)}><span className="department-name">{d}<span aria-hidden="true">↗</span></span><strong>{summary.metrics[0].value}</strong><small>{summary.metrics[0].label}</small><span className="department-job">{jobs[d]}</span><span className="department-status">{summary.status}</span></button>;})}</nav>
   <div className="bank-bottom-line" aria-label="Bank position"><span>{quarter?`${quarter.label} profit (${quarter.months}/3 months)`:'Opening profit'} <strong>{formatCurrency(quarter?.profit??0)}</strong></span><span>CET1 <strong>{formatPct(state.risk.riskMetrics.cet1Ratio)}</strong></span><span>LCR <strong>{formatPct(state.risk.riskMetrics.lcr)}</strong></span></div>
  </section>
  {hasErrors&&!department&&<div className="alert danger" role="alert">A department has an invalid policy input. Open it to correct the plan before advancing time.</div>}
  {department&&<section ref={panel} tabIndex={-1} id="department-workspace" className="department-workspace" aria-label={`${department} management`}><div className="department-heading"><div><div className="eyebrow">Department</div><h2>{department}</h2></div><button className="button ghost" onClick={onClose} aria-label="Close department">✕</button></div>{children}</section>}
 </main>;
}
