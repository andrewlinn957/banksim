import { ReactNode, useEffect, useRef } from 'react';
import { BankState } from '../domain/bankState';
import { Department } from '../game/departments';
import { baseConfig } from '../config/baseConfig';
import type { StepAttribution } from '../domain/attribution';
import { buildBoardroomOverviewData } from '../presentation/reports/overview';
import './BoardroomDashboard.css';
import ThreeYearPlanPanel from './ThreeYearPlanPanel';
import depositsArt from '../assets/department-deposits-engraving.webp';
import lendingArt from '../assets/scenario-corporate-credit-boom.webp';
import treasuryArt from '../assets/scenario-wholesale-funding.webp';
import capitalArt from '../assets/department-capital-engraving.webp';

interface Props {
 state: BankState;
 history: BankState[];
 department: Department | null;
 hasErrors: boolean;
 onDepartment: (department: Department) => void;
 onRisk: () => void;
 onClose: () => void;
 children?: ReactNode;
 pendingActions?: string[];
 attribution?: StepAttribution | null;
}

const areas: Array<{department:Department;label:string;artwork:string}> = [
 {department:'Customers',label:'Deposits',artwork:depositsArt},
 {department:'Lending',label:'Lending',artwork:lendingArt},
 {department:'Treasury',label:'Treasury & Funding',artwork:treasuryArt},
 {department:'Capital',label:'Finance & Capital',artwork:capitalArt},
];

export default function Boardroom({state,history,department,hasErrors,onDepartment,onRisk,onClose,children,pendingActions=[],attribution=null}:Props) {
 const report=buildBoardroomOverviewData(state,history,pendingActions,attribution,baseConfig);
 const panel=useRef<HTMLElement|null>(null);
 const departmentButtons=useRef<Partial<Record<Department,HTMLButtonElement>>>({});
 const priorDepartment=useRef<Department|null>(null);
 useEffect(()=>{ if(department){ panel.current?.focus({preventScroll:true}); if(window.matchMedia('(max-width:1150px)').matches) panel.current?.scrollIntoView({block:'start'}); } else if(priorDepartment.current) departmentButtons.current[priorDepartment.current]?.focus(); priorDepartment.current=department; },[department]);
 return <main className={`bank-workspace ${department?'with-department':''}`}>
  {department ? <header className="department-return-bar">
   <button className="button ghost" onClick={onClose}>← Bank overview</button>
   <span>Management area <strong>{areas.find(a=>a.department===department)?.label??department}</strong></span>
  </header> : <section className="home-dashboard" aria-label="Bank overview dashboard">
   <header className="home-heading"><div><span className="scene-kicker">BANK SIMULATOR</span><h1>Bank overview</h1><p>{report.quarter?.periodLabel??'Opening position'}</p></div><span className={`home-status ${report.attention.riskNeedsAttention?'needs-attention':''}`}>{report.riskStatus}</span></header>
   <section className="home-performance" aria-label="Financial performance">
    {report.financialPerformance.map((metric)=> <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>)}
   </section>
   <nav className="home-departments" aria-label="Bank functional areas">
    {report.departments.map(({department:d,label,primary,primaryLabel,detail})=>{const artwork=areas.find((area)=>area.department===d)!.artwork;return <button ref={el=>{departmentButtons.current[d]=el;}} key={d} className="home-department" onClick={()=>onDepartment(d)}><img src={artwork} alt=""/><span className="home-department-copy"><span>{label} ↗</span><strong>{primary}</strong><small>{primaryLabel}</small><span className="home-department-detail">{detail}</span></span></button>;})}
   </nav>
   <section className="home-resilience" aria-label="Capital and liquidity headroom"><div className="home-section-heading"><h2>Capital & liquidity</h2><button className="button ghost" onClick={onRisk}>Risk & regulatory →</button></div><p className="home-helper home-ratio-key"><span><i aria-hidden="true"/>Current</span><span><b aria-hidden="true"/>Target</span></p><div className="home-ratio-grid">
    {report.ratios.map(({label,current,targetDisplay,currentWidth,targetLeft,needsAttention,headroom,ariaLabel})=><button className={`home-ratio ${needsAttention?'needs-attention':''}`} onClick={onRisk} key={label}><span>{label}</span><strong>{current}</strong><span className="home-ratio-track" role="img" aria-label={ariaLabel}><i style={{width:`${currentWidth}%`}}/><b style={{left:`${targetLeft}%`}}/></span><small>Target {targetDisplay} · {headroom}</small></button>)}
   </div></section>
   <div className="home-detail-grid">
    <section className="home-attention" aria-label="Developments needing attention"><h2>On your desk</h2>
     {report.attention.riskNeedsAttention&&<button onClick={onRisk} className="home-attention-item needs-attention"><strong>Regulatory limit breached</strong><span>Review capital and liquidity before advancing.</span><b>Review →</b></button>}
     <button onClick={()=>onDepartment('Customers')} className="home-attention-item"><strong>{report.attention.depositsHeadline}</strong><span>{report.attention.depositsDetail}</span><b>Review deposits →</b></button>
     <button onClick={()=>onDepartment('Treasury')} className="home-attention-item"><strong>{report.attention.fundingHeadline}</strong><span>{report.attention.fundingDetail}</span><b>Review funding →</b></button>
     <button onClick={()=>onDepartment('Lending')} className="home-attention-item"><strong>{report.attention.lendingHeadline}</strong><span>{report.attention.lendingDetail}</span><b>Review lending →</b></button>
    </section>
    <section className="home-trends" aria-label="Recent monthly trends"><h2>Recent months</h2><p className="home-helper">Monthly trends · independent scales</p>
     {report.trends.map((trend)=> <Trend key={trend.label} trend={trend}/>)}
    </section>
   </div>
   <div className="home-detail-grid">
    <section className="home-close" aria-label="Latest monthly result"><h2>Latest monthly close</h2>{report.latest?<><p className="home-helper">{report.latest.date} · realised results</p><dl className="home-result-grid">{report.latest.metrics.map((metric)=><div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>{report.latest.drivers.length>0&&<div className="home-drivers"><strong>What moved the bank</strong>{report.latest.drivers.map((driver)=><div key={driver.label}><span>{driver.label}</span><b>{driver.driver}</b><small>{driver.effect}</small></div>)}</div>}<button className="button ghost" onClick={()=>onDepartment('Capital')}>Review performance & accounts →</button></>:<p className="home-helper">No monthly results yet.</p>}</section>
    <section className="home-transactions" aria-label="Transactions"><h2>Transactions</h2><h3>Next monthly close</h3>{report.pendingActions.length?<ul>{report.pendingActions.map((action,i)=><li key={i}>{action}</li>)}</ul>:<p className="home-helper">No transactions queued.</p>}{report.transaction&&<><h3>Latest capital-market result</h3><p><strong>{report.transaction.instrument}</strong> · {report.transaction.status} · {report.transaction.date}</p><dl className="home-result-grid"><div><dt>Requested</dt><dd>{report.transaction.requested}</dd></div><div><dt>Executed</dt><dd>{report.transaction.executed}</dd></div><div><dt>Fees</dt><dd>{report.transaction.fees}</dd></div><div><dt>Net proceeds</dt><dd>{report.transaction.netProceeds}</dd></div></dl></>}</section>
   </div>
  </section>}

  <ThreeYearPlanPanel state={state}/>
  {hasErrors&&<div className="alert danger" role="alert"><strong>Run is blocked by an invalid management input.</strong><div className="muted">Open the area containing the unfinished input; the field error is shown at the top of that management panel.</div><div className="metric-switch">{areas.map(area=><button key={area.department} className="button ghost" onClick={()=>onDepartment(area.department)}>{area.label}</button>)}</div></div>}
  {department&&<section ref={panel} tabIndex={-1} id="department-workspace" className="department-workspace" aria-label={`${areas.find(a=>a.department===department)?.label??department} management`}><div className="department-heading"><div><div className="eyebrow">Management area</div><h2>{areas.find(a=>a.department===department)?.label??department}</h2></div><button className="button ghost" onClick={onClose} aria-label="Close management area">✕</button></div>{children}</section>}
 </main>;
}

function Trend({trend}:{trend:ReturnType<typeof buildBoardroomOverviewData>['trends'][number]}) {
 if(trend.waiting)return <div className="home-trend"><span>{trend.label}</span><small>{trend.message}</small></div>;
 return <div className="home-trend"><span>{trend.label}<small>{trend.first} → {trend.last}</small></span><svg viewBox="0 0 180 44" role="img" aria-label={trend.ariaLabel}><path d="M4 40H176" stroke="currentColor" opacity=".15"/><polyline points={trend.points.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg></div>;
}
