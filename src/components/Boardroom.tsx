import { ReactNode, useEffect, useRef } from 'react';
import { BankState } from '../domain/bankState';
import { Department, departmentSummary } from '../game/departments';
import { customerDeposits, periodHistory } from '../game/management';
import { AssetProductType, BalanceSheetSide } from '../domain/enums';
import { baseConfig } from '../config/baseConfig';
import type { StepAttribution } from '../domain/attribution';
import './BoardroomDashboard.css';
import { formatCurrency, formatPct } from '../utils/formatters';
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
 draftTransactions?: string[];
 attribution?: StepAttribution | null;
}

const areas: Array<{department:Department;label:string;artwork:string}> = [
 {department:'Customers',label:'Deposits',artwork:depositsArt},
 {department:'Lending',label:'Lending',artwork:lendingArt},
 {department:'Treasury',label:'Treasury & Funding',artwork:treasuryArt},
 {department:'Capital',label:'Finance & Capital',artwork:capitalArt},
];

export default function Boardroom({state,history,department,hasErrors,onDepartment,onRisk,onClose,children,pendingActions=[],draftTransactions=[],attribution=null}:Props) {
 const recordedHistory=history.length?history:[state];
 const quarter=periodHistory(recordedHistory,3).at(-1);
 const previous=recordedHistory.filter(s=>s.time.step<state.time.step).at(-1);
 const opening=recordedHistory[0];
 const hasClosed=state.time.step>opening.time.step;
 const summary=Object.fromEntries(areas.map(a=>[a.department,departmentSummary(a.department,state,recordedHistory)])) as Record<Department,ReturnType<typeof departmentSummary>>;
 const pnl=state.financial.incomeStatement;
 const assets=state.financial.balanceSheet.items.filter(i=>i.side===BalanceSheetSide.Asset).reduce((sum,i)=>sum+i.balance,0);
 const equity=state.financial.capital.cet1+state.financial.capital.at1+state.financial.capital.accumulatedOCI;
 const shareReturn=opening.equityMarket.sharePrice>0?state.equityMarket.sharePrice/opening.equityMarket.sharePrice-1:0;
 const grossLoans=(s:BankState)=>departmentSummary('Lending',s,[s]).metrics[0].rawValue;
 const loanChange=previous?grossLoans(state)-grossLoans(previous):0;
 const depositChange=previous?customerDeposits(state)-customerDeposits(previous):0;
 const lastTransaction=state.capitalMarkets?.transactions.at(-1);
 const recent=recordedHistory.slice(-12);
 const moneyMillions=(value:number)=>Number.isFinite(value)?`${value<0?'−':''}£${(Math.abs(value)/1e6).toFixed(2)}m`:'Unavailable';
 const signedMoney=(value:number)=>`${value>0?'+':''}${moneyMillions(value)}`;
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
  </header> : <section className="home-dashboard" aria-label="Bank overview dashboard">
   <header className="home-heading"><div><span className="scene-kicker">BANK SIMULATOR</span><h1>Bank overview</h1><p>{quarter?`${quarter.label} · ${quarter.months}/3 months closed`:'Opening position'}</p></div><span className={`home-status ${riskNeedsAttention?'needs-attention':''}`}>{riskStatus}</span></header>
   <section className="home-performance" aria-label="Financial performance">
    <div><span>Quarter profit</span><strong>{moneyMillions(quarter?.profit??0)}</strong><small>{quarter?`${quarter.label}${quarter.months<3?' to date':''}`:'No months closed'}</small></div>
    <div><span>Net interest margin</span><strong>{hasClosed&&assets>0?formatPct(pnl.netInterestIncome*12/assets):'—'}</strong><small>Latest month, annualised / total assets</small></div>
    <div><span>Return on equity</span><strong>{hasClosed&&equity>0?formatPct(pnl.netIncome*12/equity):'—'}</strong><small>Latest month, annualised</small></div>
    <div><span>Share price</span><strong>£{state.equityMarket.sharePrice.toFixed(3)}</strong><small>{shareReturn>=0?'+':''}{formatPct(shareReturn)} since opening · excludes dividends</small></div>
   </section>
   <nav className="home-departments" aria-label="Bank functional areas">
    {areas.map(({department:d,label,artwork})=>{const metrics=summary[d].metrics;const primary=d==='Capital'?metrics[2]:metrics[0];const detail=d==='Customers'?`${signedMoney(depositChange)} last month`:d==='Lending'?`${signedMoney(loanChange)} last month`:d==='Treasury'?`${moneyMillions(metrics[2].rawValue)} due within 3 months`:`${metrics[1].value} CET1 target headroom`;return <button ref={el=>{departmentButtons.current[d]=el;}} key={d} className="home-department" onClick={()=>onDepartment(d)}><img src={artwork} alt=""/><span className="home-department-copy"><span>{label} ↗</span><strong>{d==='Capital'?moneyMillions(primary.rawValue):primary.value}</strong><small>{primary.label}</small><span className="home-department-detail">{detail}</span></span></button>;})}
   </nav>
   <section className="home-resilience" aria-label="Capital and liquidity headroom"><div className="home-section-heading"><h2>Capital & liquidity</h2><button className="button ghost" onClick={onRisk}>Risk & regulatory →</button></div><p className="home-helper home-ratio-key"><span><i aria-hidden="true"/>Current</span><span><b aria-hidden="true"/>Target</span></p><div className="home-ratio-grid">
    {([
     ['CET1',risk.cet1Ratio,risk.internalCet1TargetRatio],
     ['Leverage',risk.leverageRatio,risk.internalLeverageTargetRatio??state.behaviour.riskAppetite?.leverage??baseConfig.riskLimits.minLeverageRatio*1.05],
     ['LCR',risk.lcr,risk.internalLcrTargetRatio??state.behaviour.riskAppetite?.lcr??baseConfig.riskLimits.minLcr*1.1],
     ['NSFR',risk.nsfr,risk.internalNsfrTargetRatio??state.behaviour.riskAppetite?.nsfr??baseConfig.riskLimits.minNsfr*1.05],
    ] as const).map(([label,value,target])=>{const max=({CET1:.3,Leverage:.15,LCR:3,NSFR:2.5} as const)[label];return <button className={`home-ratio ${value<target?'needs-attention':''}`} onClick={onRisk} key={label}><span>{label}</span><strong>{formatPct(value)}</strong><span className="home-ratio-track" role="img" aria-label={`${label}: current ${formatPct(value)}, target ${formatPct(target)}`}><i style={{width:`${Math.min(100,value/max*100)}%`}}/><b style={{left:`${Math.min(100,target/max*100)}%`}}/></span><small>Target {formatPct(target)} · {value>=target?'+':''}{((value-target)*100).toFixed(2)} pp headroom</small></button>;})}
   </div></section>
   <div className="home-detail-grid">
    <section className="home-attention" aria-label="Developments needing attention"><h2>On your desk</h2>
     {riskNeedsAttention&&<button onClick={onRisk} className="home-attention-item needs-attention"><strong>Regulatory limit breached</strong><span>Review capital and liquidity before advancing.</span><b>Review →</b></button>}
     <button onClick={()=>onDepartment('Customers')} className="home-attention-item"><strong>{hasClosed?`Deposits ${depositChange<0?'fell':'changed'} ${moneyMillions(Math.abs(depositChange))} last month`:'Compare your deposit offers with the market'}</strong><span>{summary.Customers.metrics[2].value} fixed-term savings · {summary.Customers.metrics[3].value} largest depositor/group</span><b>Review deposits →</b></button>
     <button onClick={()=>onDepartment('Treasury')} className="home-attention-item"><strong>{moneyMillions(summary.Treasury.metrics[2].rawValue)} funding matures within 3 months</strong><span>{summary.Treasury.metrics[0].value} cash reserves available</span><b>Review funding →</b></button>
     <button onClick={()=>onDepartment('Lending')} className="home-attention-item"><strong>{summary.Lending.metrics[3].value} of loans in Stage 2 or 3</strong><span>{moneyMillions(summary.Lending.metrics[2].rawValue)} undrawn commitments</span><b>Review lending →</b></button>
    </section>
    <section className="home-trends" aria-label="Recent monthly trends"><h2>Recent months</h2><p className="home-helper">Monthly trends · independent scales</p>
     <Trend label="Monthly profit" points={recent.slice(1).map(s=>({date:s.time.date,value:s.financial.incomeStatement.netIncome}))} format={moneyMillions}/>
     <Trend label="Customer deposits" points={recent.map(s=>({date:s.time.date,value:customerDeposits(s)}))} format={formatCurrency}/>
     <Trend label="Gross loans" points={recent.map(s=>({date:s.time.date,value:grossLoans(s)}))} format={formatCurrency}/>
     <Trend label="CET1" points={recent.map(s=>({date:s.time.date,value:s.risk.riskMetrics.cet1Ratio}))} format={formatPct}/>
     <Trend label="LCR" points={recent.map(s=>({date:s.time.date,value:s.risk.riskMetrics.lcr}))} format={formatPct}/>
    </section>
   </div>
   <div className="home-detail-grid">
    <section className="home-close" aria-label="Latest monthly result"><h2>Latest monthly close</h2>{hasClosed?<><p className="home-helper">{new Date(state.time.date).toLocaleDateString('en-GB',{month:'long',year:'numeric'})} · realised results</p><dl className="home-result-grid"><div><dt>Net interest income</dt><dd>{moneyMillions(pnl.netInterestIncome)}</dd></div><div><dt>Operating expenses</dt><dd>{moneyMillions(pnl.operatingExpenses)}</dd></div><div><dt>Provision charge</dt><dd>{moneyMillions(pnl.provisionCharge)}</dd></div><div><dt>Net profit</dt><dd>{moneyMillions(pnl.netIncome)}</dd></div></dl>{attribution&&<div className="home-drivers"><strong>What moved the bank</strong>{(['nim','cet1Ratio','lcr','nsfr'] as const).map(key=>{const metric=attribution.metrics[key];const driver=metric.lines.slice().sort((a,b)=>Math.abs(b.effect)-Math.abs(a.effect))[0];return driver?<div key={key}><span>{metric.label}</span><b>{driver.label}</b><small>{driver.effect>=0?'+':''}{(driver.effect*100).toFixed(2)} pp</small></div>:null;})}</div>}<button className="button ghost" onClick={()=>onDepartment('Capital')}>Review performance & accounts →</button></>:<p className="home-helper">No monthly results yet.</p>}</section>
    <section className="home-transactions" aria-label="Transactions"><h2>Transactions</h2><h3>Next monthly close</h3>{pendingActions.length?<ul>{pendingActions.map((action,i)=><li key={i}>{action}</li>)}</ul>:<p className="home-helper">No transactions queued.</p>}{draftTransactions.length>0&&<div className="alert warning" role="status"><strong>Drafts are not queued</strong><ul>{draftTransactions.map((draft,i)=><li key={i}>{draft}</li>)}</ul><p>They will not run at the next close and will clear when you advance.</p></div>}{lastTransaction&&<><h3>Latest capital-market result</h3><p><strong>{({cet1:'CET1 equity',at1:'AT1',tier2:'Tier 2',senior:'Senior debt'} as const)[lastTransaction.instrument]}</strong> · {lastTransaction.status.replaceAll('-',' ')} · {new Date(lastTransaction.date).toLocaleDateString('en-GB',{month:'short',year:'numeric'})}</p><dl className="home-result-grid"><div><dt>Requested</dt><dd>{moneyMillions(lastTransaction.targetAmount)}</dd></div><div><dt>Executed</dt><dd>{moneyMillions(lastTransaction.executedAmount)}</dd></div><div><dt>Fees</dt><dd>{moneyMillions(lastTransaction.fees)}</dd></div><div><dt>Net proceeds</dt><dd>{moneyMillions(lastTransaction.netProceeds)}</dd></div></dl></>}</section>
   </div>
  </section>}

  <ThreeYearPlanPanel state={state}/>
  {hasErrors&&<div className="alert danger" role="alert"><strong>Run is blocked by an invalid management input.</strong><div className="muted">Open the area containing the unfinished input; the field error is shown at the top of that management panel.</div><div className="metric-switch">{areas.map(area=><button key={area.department} className="button ghost" onClick={()=>onDepartment(area.department)}>{area.label}</button>)}</div></div>}
  {department&&<section ref={panel} tabIndex={-1} id="department-workspace" className="department-workspace" aria-label={`${areas.find(a=>a.department===department)?.label??department} management`}><div className="department-heading"><div><div className="eyebrow">Management area</div><h2>{areas.find(a=>a.department===department)?.label??department}</h2></div><button className="button ghost" onClick={onClose} aria-label="Close management area">✕</button></div>{children}</section>}
 </main>;
}

function Trend({label,points,format}:{label:string;points:Array<{date:Date;value:number}>;format:(value:number)=>string}) {
 const finite=points.filter(point=>Number.isFinite(point.value));
 if(finite.length<2)return <div className="home-trend"><span>{label}</span><small>Awaiting two months</small></div>;
 const min=Math.min(...finite.map(point=>point.value)),max=Math.max(...finite.map(point=>point.value)),range=max-min;
 const coords=finite.map(({value},i)=>`${4+i/(finite.length-1)*172},${range?38-(value-min)/range*32:22}`).join(' ');
 const month=(date:Date)=>new Date(date).toLocaleDateString('en-GB',{month:'short',year:'2-digit'});
 const first=finite[0],last=finite.at(-1)!;
 return <div className="home-trend"><span>{label}<small>{format(first.value)} ({month(first.date)}) → {format(last.value)} ({month(last.date)})</small></span><svg viewBox="0 0 180 44" role="img" aria-label={`${label}, ${month(first.date)} to ${month(last.date)}: ${finite.map(point=>format(point.value)).join(', ')}`}><path d="M4 40H176" stroke="currentColor" opacity=".15"/><polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg></div>;
}
