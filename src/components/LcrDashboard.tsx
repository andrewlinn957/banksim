import { useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { calculateCor011, LcrContribution } from '../engine/cor011';
import { prudentialLiquidityLines } from '../engine/prudential';
import { formatCurrency, formatPct } from '../utils/formatters';
import TimeSeriesChart from './TimeSeriesChart';

const colors=['#15578d','#149ed5','#7753be','#b398e3','#208674','#67c3a2','#8560b9','#57bce4'];
type Part={label:string;value:number;color:string};

const aggregateParts=(contributions:LcrContribution[]):Part[]=>{
 const grouped=new Map<string,number>();
 contributions.forEach(c=>{
  const label=`${c.corep} · ${c.label}`;
  grouped.set(label,(grouped.get(label)??0)+c.weighted);
 });
 return [...grouped.entries()].map(([label,value],i)=>({label,value,color:colors[i%colors.length]}));
};

type ContributionAggregate={label:string;amount:number;factor:number;weighted:number;count:number};
const detailCurrency=(value:number):string=>{
 const abs=Math.abs(value);
 if(abs>=1e9)return `£${(value/1e9).toFixed(2)}bn`;
 if(abs>=1e6)return `£${(value/1e6).toFixed(abs>=1e8?0:1)}m`;
 if(abs>=1e3)return `£${(value/1e3).toFixed(abs>=1e5?0:1)}k`;
 return `£${value.toFixed(0)}`;
};
export const aggregateContributions=(contributions:LcrContribution[]):ContributionAggregate[]=>{
 const grouped=new Map<string,ContributionAggregate>();
 contributions.forEach(c=>{
  const label=`${c.corep} · ${c.label}${c.capClass?` · ${c.capClass}% cap`:''}`;
  const key=`${label}|${c.factor}`;
  const row=grouped.get(key);
  if(row){row.amount+=c.amount;row.weighted+=c.weighted;row.count+=1;}
  else grouped.set(key,{label,amount:c.amount,factor:c.factor,weighted:c.weighted,count:1});
 });
 return [...grouped.values()];
};
const contributionRows=(contributions:LcrContribution[]):[string,string][]=>aggregateContributions(contributions).map(c=>[
 `${c.label}${c.count>1?` · ${c.count} contributions`:''}`,
 `${detailCurrency(c.amount)} × ${formatPct(c.factor,0)} = ${detailCurrency(c.weighted)}`,
]);
const underlyingContributionRows=(contributions:LcrContribution[]):[string,string][]=>contributions.map(c=>[
 `${c.corep} · ${c.label} · ${c.sourceLabel}${c.capClass?` · ${c.capClass}% cap`:''}`,
 `${detailCurrency(c.amount)} × ${formatPct(c.factor,0)} = ${detailCurrency(c.weighted)}`,
]);

export function lcrDashboardData(state:BankState,config:SimulationConfig) {
 const report=calculateCor011(state,config);
 const c76=report.c76;
 const lines=prudentialLiquidityLines(state,config);
 const outgoing=c76.totalOutflows;
 const incoming=report.inflows.reduce((sum,c)=>sum+c.weighted,0);
 const recognised=c76.reductionFullyExempt+c76.reduction90+c76.reduction75;
 const net=c76.netLiquidityOutflow;
 const requirement=config.riskLimits.minLcr;
 const target=Math.max(requirement,state.behaviour.riskAppetite?.lcr??requirement*1.1);
 const hqla={
  level1:c76.unadjustedLevel1,
  level2a:c76.unadjustedLevel2A,
  level2b:c76.unadjustedLevel2B,
  eligibleLevel2a:c76.unadjustedLevel2A,
  eligibleLevel2b:Math.max(0,c76.liquidityBuffer-c76.unadjustedLevel1-c76.unadjustedLevel2A),
  capDeduction:Math.max(0,c76.unadjustedLevel1+c76.unadjustedLevel2A+c76.unadjustedLevel2B-c76.liquidityBuffer),
  total:c76.liquidityBuffer,
 };
 return {
  report,c76,lines,hqla,
  commitments:report.outflows.filter(c=>c.corep.startsWith('C73 1.1.6')).reduce((sum,c)=>sum+c.weighted,0),
  outgoing,incoming,cap:outgoing*.75,recognised,net,requirement,target,ratio:c76.lcr,
  required:net*requirement,surplus:hqla.total-net*requirement,
  outParts:aggregateParts(report.outflows),
  inParts:aggregateParts(report.inflows),
  hqlaParts:aggregateParts(report.liquidAssets),
 };
}
const ratioText=(r:number)=>r===Infinity?'No net outflows':formatPct(r);
const signed=(n:number)=>`${n<0?'−':'+'}${formatCurrency(Math.abs(n))}`;
function Legend({parts}:{parts:Part[]}) {return <ul className="lcr-legend">{parts.map(p=><li key={p.label}><i style={{background:p.color}}/><span>{p.label}</span><strong>{formatCurrency(p.value)}</strong></li>)}</ul>;}
function Bars({bars,reference}:{bars:{label:string;parts:Part[]}[];reference?:{value:number;label:string}}) {
 const totals=bars.map(b=>b.parts.reduce((s,p)=>s+p.value,0));
 const max=Math.max(1,...totals,reference?.value??0)*1.2;
 const y=(n:number)=>255-n/max*205;
 const width=bars.length===1?126:Math.min(95,300/bars.length);
 return <svg className="lcr-chart" viewBox="0 0 440 315" role="img" aria-label={bars.map((b,i)=>`${b.label}: ${formatCurrency(totals[i])}`).join('; ')+(reference?`; ${reference.label}: ${formatCurrency(reference.value)}`:'')}>
  {[0,1,2,3,4].map(i=><g key={i}><path d={`M55 ${y(max*i/4)}H425`} stroke="var(--border)"/><text x="47" y={y(max*i/4)+5} textAnchor="end">{(max*i/4/1e9).toFixed(1)}</text></g>)}<text x="20" y="25">£bn</text>
  {bars.map((b,i)=>{let total=0;const x=65+i*350/bars.length+(350/bars.length-width)/2;return <g key={b.label}>{b.parts.map(p=>{const bottom=total;total+=p.value;return <rect key={p.label} x={x} y={y(total)} width={width} height={p.value/max*205} fill={p.color}><title>{p.label}: {formatCurrency(p.value)}</title></rect>;})}<text x={x+width/2} y={y(total)-10} textAnchor="middle" fontWeight="700">{formatCurrency(total)}</text><text x={x+width/2} y="280" textAnchor="middle">{b.label.split('|').map((t,j)=><tspan key={j} x={x+width/2} dy={j?18:0}>{t}</tspan>)}</text></g>;})}
  {reference&&<path d={`M55 ${y(reference.value)}H425`} stroke="#8560b9" strokeWidth="2" strokeDasharray="6 4"/>}
 </svg>;
}
function DetailTable({title,rows}:{title:string;rows:[string,string][]}) {return <section className="lcr-detail-group"><h4>{title}</h4><table><tbody>{rows.map(([label,value],i)=><tr key={`${label}-${i}`}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table></section>;}
function ContributionDetailTable({title,contributions,totalLabel,totalValue}:{title:string;contributions:LcrContribution[];totalLabel?:string;totalValue?:number}) {
 const [expanded,setExpanded]=useState(false);
 const rows=contributionRows(contributions);
 if(totalLabel&&totalValue!==undefined)rows.push([totalLabel,detailCurrency(totalValue)]);
 return <section className="lcr-contribution-detail"><DetailTable title={title} rows={rows}/><details onToggle={event=>setExpanded(event.currentTarget.open)}><summary>Show {contributions.length} underlying contributions</summary>{expanded&&<DetailTable title={`${title} — underlying contributions`} rows={underlyingContributionRows(contributions)}/>}</details></section>;
}
export default function LcrDashboard({state,config,history}:{state:BankState;config:SimulationConfig;history:BankState[]}) {
 const d=lcrDashboardData(state,config);
 const maxRatio=Math.max(2,d.requirement*1.2,d.target*1.2,Number.isFinite(d.ratio)?d.ratio*1.1:0);
 const pp=Number.isFinite(d.ratio)?`${d.ratio>=d.requirement?'+':''}${((d.ratio-d.requirement)*100).toFixed(1)}pp`:'N/A';
 const summary=[{label:'C73 outflows',value:d.outgoing,color:colors[0]},{label:'C74 inflows',value:d.incoming,color:colors[1]},{label:'Recognised|inflows',value:d.recognised,color:'#57bce4'},{label:'C76 net|outflows',value:d.net,color:'#30ba80'}];
 return <div className="lcr-dashboard">
 <div className="lcr-working-grid">
  <section className={`capital-card lcr-headline ${d.ratio<d.requirement?'shortfall':''}`}><header><h3>LCR</h3><span className="capital-status">{d.net===0?'No net outflows':d.ratio>=d.requirement?'Compliant':'Below minimum'}</span></header>
   <div className="capital-ratios"><div><strong>{ratioText(d.ratio)}</strong><span>Actual LCR</span></div><div><span>Requirement</span><b>{formatPct(d.requirement,0)}</b></div><div><span>Headroom</span><b className="capital-gap">{pp}</b></div></div>
   <svg className="capital-bullet" viewBox="0 0 400 65" role="img" aria-label={`LCR ${ratioText(d.ratio)}, minimum ${formatPct(d.requirement)}, internal target ${formatPct(d.target)}`}><rect x="8" y="12" width="384" height="18" rx="5" fill="var(--border)"/><rect x="8" y="12" width={d.net>0?384*d.ratio/maxRatio:0} height="18" rx="5" fill="currentColor"/><path d={`M${8+384*d.requirement/maxRatio} 7v28`} stroke="var(--text)" strokeWidth="3"/><path d={`M${8+384*d.target/maxRatio} 7v28`} stroke="#b24b92" strokeWidth="2" strokeDasharray="2 3"/>{[0,1,2,3,4].map(i=><text key={i} x={8+i*96} y="55" textAnchor={i===0?'start':i===4?'end':'middle'}>{formatPct(maxRatio*i/4,0)}</text>)}</svg>
   <p className="lcr-target">Dotted marker: internal target {formatPct(d.target)} · {formatCurrency(d.target*d.net)}</p>
   <div className="capital-amounts"><div><b>{formatCurrency(d.hqla.total)}</b><span>C76 liquidity buffer</span></div><div><b>{formatCurrency(d.required)}</b><span>HQLA required</span></div><div><b className="capital-gap">{signed(d.surplus)}</b><span>Liquidity surplus</span></div></div><div className="lcr-headline-history"><h4>LCR over time</h4><div style={{height:180}}><TimeSeriesChart data={history.map(s=>({step:s.time.step,value:s.risk.riskMetrics.lcr}))} xLabel="Month" yLabel="LCR (%)"/></div></div><p className="muted">Liquidity buffer ÷ C76 30-day net liquidity outflow.</p>
  </section>
  <section className="capital-card"><h3>COR011 cash-flow summary</h3><div className="lcr-summary-numbers">{summary.map(s=><div key={s.label}><strong>{formatCurrency(s.value)}</strong><span>{s.label.replace('|',' ')}</span></div>)}</div><Bars bars={summary.map(s=>({label:s.label,parts:[s]}))}/></section>
  <section className="capital-card"><h3>C72 liquid assets</h3><p className="capital-total">C76 liquidity buffer <strong>{formatCurrency(d.hqla.total)}</strong></p><Bars bars={[{label:'Liquid assets',parts:d.hqlaParts}]} reference={{value:d.required,label:'HQLA required'}}/><p className="lcr-reference">Dashed line: HQLA required {formatCurrency(d.required)} ({formatPct(d.requirement,0)} of net outflows)</p><Legend parts={d.hqlaParts}/><p className="muted">C72 amounts are after eligibility, encumbrance and haircut treatment. C76 then applies composition-cap calculations using adjusted amounts.</p></section>
  <section className="capital-card"><h3>C73 outflows vs C74 inflows</h3><Bars bars={[{label:'C73 outflows',parts:d.outParts},{label:'C74 inflows',parts:d.inParts}]}/><p className="lcr-net">C76 net liquidity outflow <strong>{formatCurrency(d.net)}</strong></p><h4>C73 outflow rows</h4><Legend parts={d.outParts}/><h4>C74 inflow rows</h4><Legend parts={d.inParts}/></section>
 </div>
 <aside className="capital-card lcr-detail"><h3>COR011 detail</h3>
  <DetailTable title="C76 — Calculations" rows={[
   ['Liquidity buffer',formatCurrency(d.c76.liquidityBuffer)],['Total C73 outflows',formatCurrency(d.c76.totalOutflows)],['Fully exempt inflows',formatCurrency(d.c76.fullyExemptInflows)],['90% cap inflows',formatCurrency(d.c76.inflows90)],['75% cap inflows',formatCurrency(d.c76.inflows75)],['Reduction: fully exempt',formatCurrency(d.c76.reductionFullyExempt)],['Reduction: 90% cap',formatCurrency(d.c76.reduction90)],['Reduction: 75% cap',formatCurrency(d.c76.reduction75)],['Net liquidity outflow',formatCurrency(d.c76.netLiquidityOutflow)],['LCR actual',ratioText(d.ratio)],
  ]}/>
  <ContributionDetailTable title="C72 — Liquid assets" contributions={d.report.liquidAssets}/>
  <ContributionDetailTable title="C73 — Outflows" contributions={d.report.outflows} totalLabel="Total weighted outflows" totalValue={d.outgoing}/>
  <ContributionDetailTable title="C74 — Inflows" contributions={d.report.inflows} totalLabel="Total weighted inflows" totalValue={d.incoming}/>
  <DetailTable title="C76 — Adjusted Level 1 / composition cap" rows={[
   ['L1 unadjusted',formatCurrency(d.c76.unadjustedLevel1)],['L1 collateral 30-day outflows',formatCurrency(d.c76.level1Collateral30dOutflows)],['L1 collateral 30-day inflows',formatCurrency(d.c76.level1Collateral30dInflows)],['Secured cash 30-day outflows',formatCurrency(d.c76.securedCash30dOutflows)],['Secured cash 30-day inflows',formatCurrency(d.c76.securedCash30dInflows)],['L1 adjusted',formatCurrency(d.c76.adjustedLevel1)],['Excess liquid assets',formatCurrency(d.c76.excessLiquidAssets)],['Liquidity buffer',formatCurrency(d.c76.liquidityBuffer)],
  ]}/>
 </aside>
 <section className="capital-card lcr-history-note"><h3>Management stress view</h3><p className="muted">Management stress estimate: {ratioText(state.risk.riskMetrics.managementLcr??state.risk.riskMetrics.lcr)}. This uses behavioural stress assumptions and is separate from the reported COR011 LCR.</p></section>
 </div>;
}
