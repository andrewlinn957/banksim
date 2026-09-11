import { ReactNode, useEffect, useRef } from 'react';
import { BankState } from '../domain/bankState';
import { Department, departmentSummary } from '../game/departments';
import { periodHistory } from '../game/management';
import { formatCurrency, formatPct } from '../utils/formatters';
import ThreeYearPlanPanel from './ThreeYearPlanPanel';

interface Props {
 state: BankState;
 history: BankState[];
 department: Department | null;
 hasErrors: boolean;
 onDepartment: (department: Department) => void;
 onRisk: () => void;
 onClose: () => void;
 children?: ReactNode;
}

const areas: Array<{department:Department;label:string;job:string}> = [
 {department:'Customers',label:'Deposits',job:'Price deposits & protect the franchise'},
 {department:'Lending',label:'Lending',job:'Price loans & set underwriting standards'},
 {department:'Treasury',label:'Treasury & Funding',job:'Fund the bank, manage liquidity & hedge'},
 {department:'Capital',label:'Finance & Capital',job:'Manage profit, distributions & capital'},
];

export default function Boardroom({state,history,department,hasErrors,onDepartment,onRisk,onClose,children}:Props) {
 const quarter=periodHistory(history,3).at(-1);
 const panel=useRef<HTMLElement|null>(null);
 const departmentButtons=useRef<Partial<Record<Department,HTMLButtonElement>>>({});
 const priorDepartment=useRef<Department|null>(null);
 const risk=state.risk.riskMetrics;
 const compliance=state.risk.compliance;
 const riskNeedsAttention=compliance.cet1Breached||compliance.ownFundsBreached||compliance.leverageBreached||compliance.lcrBreached||compliance.nsfrBreached;
 const riskStatus=riskNeedsAttention?'Regulatory breach needs attention':'Within regulatory requirements';
 useEffect(()=>{ if(department){ panel.current?.focus({preventScroll:true}); if(window.matchMedia('(max-width:1150px)').matches) panel.current?.scrollIntoView({block:'start'}); } else if(priorDepartment.current) departmentButtons.current[priorDepartment.current]?.focus(); priorDepartment.current=department; },[department]);
 return <main className={`bank-workspace ${department?'with-department':''}`}>
  <section className="bank-map" aria-label="Bank and functional areas">
   <div className="bank-map-heading"><span className="scene-kicker">CITY OF LONDON · THREADNEEDLE STREET</span><h1>Your bank</h1><p>{department?`${areas.find(a=>a.department===department)?.label??department} is open. Change its policy or let time run to watch the results.`:'Choose an area to run or control the bank. Standing policies keep operating until you change them.'}</p></div>
   <nav className="bank-departments" aria-label="Bank functional areas">
    {areas.map(({department:d,label,job})=>{const summary=departmentSummary(d,state,history);return <button ref={el=>{departmentButtons.current[d]=el;}} key={d} className={`department-building ${department===d?'selected':''}`} aria-pressed={department===d} aria-controls={department?"department-workspace":undefined} onClick={()=>onDepartment(d)}><span className="department-name">{label}<span aria-hidden="true">↗</span></span><strong>{summary.metrics[0].value}</strong><small>{summary.metrics[0].label}</small><span className="department-job">{job}</span><span className="department-status">{summary.status}</span></button>;})}
    <button className="department-building risk-area-building" onClick={onRisk}><span className="department-name">Risk & Regulatory<span aria-hidden="true">↗</span></span><strong>{formatPct(risk.cet1Ratio)}</strong><small>CET1 ratio</small><span className="department-job">Monitor prudential position & requirements</span><span className="department-status">{riskStatus}</span></button>
   </nav>
   <div className="bank-bottom-line" aria-label="Bank position"><span>{quarter?`${quarter.label} profit (${quarter.months}/3 months)`:'Opening profit'} <strong>{formatCurrency(quarter?.profit??0)}</strong></span><span>CET1 <strong>{formatPct(risk.cet1Ratio)}</strong></span><span>LCR <strong>{formatPct(risk.lcr)}</strong></span></div>
  </section>

  <ThreeYearPlanPanel state={state}/>
  {hasErrors&&!department&&<div className="alert danger" role="alert">A management area has an invalid policy input. Open it to correct the plan before advancing time.</div>}
  {department&&<section ref={panel} tabIndex={-1} id="department-workspace" className="department-workspace" aria-label={`${areas.find(a=>a.department===department)?.label??department} management`}><div className="department-heading"><div><div className="eyebrow">Management area</div><h2>{areas.find(a=>a.department===department)?.label??department}</h2></div><button className="button ghost" onClick={onClose} aria-label="Close management area">✕</button></div>{children}</section>}
 </main>;
}
