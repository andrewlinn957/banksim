import { ReactNode, useEffect, useRef } from 'react';
import { BankState } from '../domain/bankState';
import { Department, departmentSummary } from '../game/departments';
import { periodHistory } from '../game/management';
import { formatCurrency, formatPct } from '../utils/formatters';
import ThreeYearPlanPanel from './ThreeYearPlanPanel';
import depositsArt from '../assets/department-deposits-engraving.webp';
import lendingArt from '../assets/scenario-corporate-credit-boom.webp';
import treasuryArt from '../assets/scenario-wholesale-funding.webp';
import capitalArt from '../assets/department-capital-engraving.webp';
import regulatoryArt from '../assets/scenario-supervisory-review.webp';

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

const areas: Array<{department:Department;label:string;artwork:string}> = [
 {department:'Customers',label:'Deposits',artwork:depositsArt},
 {department:'Lending',label:'Lending',artwork:lendingArt},
 {department:'Treasury',label:'Treasury & Funding',artwork:treasuryArt},
 {department:'Capital',label:'Finance & Capital',artwork:capitalArt},
];

export default function Boardroom({state,history,department,hasErrors,onDepartment,onRisk,onClose,children}:Props) {
 const quarter=periodHistory(history,3).at(-1);
 const panel=useRef<HTMLElement|null>(null);
 const departmentButtons=useRef<Partial<Record<Department,HTMLButtonElement>>>({});
 const priorDepartment=useRef<Department|null>(null);
 const risk=state.risk.riskMetrics;
 const compliance=state.risk.compliance;
 const riskNeedsAttention=compliance.cet1Breached||compliance.ownFundsBreached||compliance.leverageBreached||compliance.lcrBreached||compliance.nsfrBreached;
 const riskStatus=riskNeedsAttention?'Breach needs attention':'Buffers within limits';
 useEffect(()=>{ if(department){ panel.current?.focus({preventScroll:true}); if(window.matchMedia('(max-width:1150px)').matches) panel.current?.scrollIntoView({block:'start'}); } else if(priorDepartment.current) departmentButtons.current[priorDepartment.current]?.focus(); priorDepartment.current=department; },[department]);
 return <main className={`bank-workspace ${department?'with-department':''}`}>
  {department ? <header className="department-return-bar">
   <button className="button ghost" onClick={onClose}>← Bank overview</button>
   <span>Management area <strong>{areas.find(a=>a.department===department)?.label??department}</strong></span>
  </header> : <section className="bank-map" aria-label="Bank and functional areas">
   <div className="bank-map-heading"><span className="scene-kicker">BANK SIMULATOR</span><h1>Bank overview</h1><p>Choose an area to manage. Policies remain active as time advances.</p></div>
   <nav className="bank-departments" aria-label="Bank functional areas">
    {areas.map(({department:d,label,artwork})=>{const summary=departmentSummary(d,state,history);return <button ref={el=>{departmentButtons.current[d]=el;}} key={d} className="department-building" onClick={()=>onDepartment(d)}><span className="department-art" aria-hidden="true"><img src={artwork} alt="" decoding="async"/></span><span className="department-copy"><span className="department-name">{label}<span aria-hidden="true">↗</span></span><strong>{summary.metrics[0].value}</strong><small>{summary.metrics[0].label}</small><span className="department-status">{summary.status}</span></span></button>;})}
    <button className="department-building risk-area-building" onClick={onRisk}><span className="department-art" aria-hidden="true"><img src={regulatoryArt} alt="" decoding="async"/></span><span className="department-copy"><span className="department-name">Risk & Regulatory<span aria-hidden="true">↗</span></span><strong>{formatPct(risk.cet1Ratio)}</strong><small>CET1 ratio</small><span className="department-status">{riskStatus}</span></span></button>
   </nav>
   <div className="bank-bottom-line" aria-label="Bank position"><span>{quarter?`${quarter.label} profit (${quarter.months}/3 months)`:'Opening profit'} <strong>{formatCurrency(quarter?.profit??0)}</strong></span><span>CET1 <strong>{formatPct(risk.cet1Ratio)}</strong></span><span>LCR <strong>{formatPct(risk.lcr)}</strong></span></div>
  </section>}

  <ThreeYearPlanPanel state={state}/>
  {hasErrors&&<div className="alert danger" role="alert"><strong>Run is blocked by an invalid management input.</strong><div className="muted">Open the area containing the unfinished input; the field error is shown at the top of that management panel.</div><div className="metric-switch">{areas.map(area=><button key={area.department} className="button ghost" onClick={()=>onDepartment(area.department)}>{area.label}</button>)}</div></div>}
  {department&&<section ref={panel} tabIndex={-1} id="department-workspace" className="department-workspace" aria-label={`${areas.find(a=>a.department===department)?.label??department} management`}><div className="department-heading"><div><div className="eyebrow">Management area</div><h2>{areas.find(a=>a.department===department)?.label??department}</h2></div><button className="button ghost" onClick={onClose} aria-label="Close management area">✕</button></div>{children}</section>}
 </main>;
}
