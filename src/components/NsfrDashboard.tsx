import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { commitmentNsfrContribution, eligibleCet1, NsfrContribution, prudentialLiquidityLines } from '../engine/prudential';
import { formatCurrency, formatPct } from '../utils/formatters';
import TimeSeriesChart from './TimeSeriesChart';

type FundingRow={label:string;amount:number;weighted:number;factor:number|null};
type Segment={label:string;value:number;color:string};
const palette=['#18528b','#4d95d6','#43ab85','#a0dbc8','#7661bd','#ada0df','#8060c5','#59418f'];

const capitalContribution=(category:'cet1Capital'|'at1Capital',corep:string,label:string,amount:number):NsfrContribution=>({
 side:'ASF',category,corep,label,group:'Eligible capital',sourceLabel:label,amount,factor:1,weighted:amount,maturityBand:'none'
});

const aggregateRows=(contributions:NsfrContribution[]):FundingRow[]=>{
 const rows=new Map<string,FundingRow>();
 contributions.forEach(c=>{
  const key=`${c.corep}|${c.label}|${c.factor}|${c.maturityBand}`;
  const suffix=c.maturityBand==='under6m'?' · <6m':c.maturityBand==='sixTo12m'?' · 6–12m':c.maturityBand==='oneYearPlus'?' · ≥1y':'';
  const existing=rows.get(key)??{label:`${c.corep} · ${c.label}${suffix}`,amount:0,weighted:0,factor:c.factor};
  existing.amount+=c.amount;existing.weighted+=c.weighted;rows.set(key,existing);
 });
 return [...rows.values()].filter(r=>r.amount!==0||r.weighted!==0);
};

const aggregateGroups=(contributions:NsfrContribution[]):Segment[]=>{
 const groups=new Map<string,number>();
 contributions.forEach(c=>groups.set(c.group,(groups.get(c.group)??0)+c.weighted));
 return [...groups.entries()].map(([label,value],i)=>({label,value,color:palette[i%palette.length]}));
};

const maturityName=(c:NsfrContribution)=>c.category==='undrawnCommitment'?'Unallocated commitments':c.maturityBand==='under6m'?'< 6 months':c.maturityBand==='sixTo12m'?'6–12 months':c.maturityBand==='oneYearPlus'?'≥ 1 year':'No contractual maturity';

export function nsfrDashboardData(state:BankState,config:SimulationConfig) {
 const lines=prudentialLiquidityLines(state,config);
 const equity=eligibleCet1(state,config),at1=state.financial.capital.at1;
 const asfContributions:NsfrContribution[]=[
  capitalContribution('cet1Capital','C81 2.1.1','CET1 including eligible OCI',equity),
  capitalContribution('at1Capital','C81 2.1.2','AT1 capital',at1),
  ...lines.flatMap(l=>l.asfContributions),
 ];
 const commitment=commitmentNsfrContribution(state);
 const rsfContributions:NsfrContribution[]=[...lines.flatMap(l=>l.rsfContributions),...(commitment.amount>0?[commitment]:[])];
 const asfRows=aggregateRows(asfContributions),rsfRows=aggregateRows(rsfContributions);
 const asf=asfContributions.reduce((s,c)=>s+c.weighted,0),rsf=rsfContributions.reduce((s,c)=>s+c.weighted,0);
 const asfParts=aggregateGroups(asfContributions),rsfParts=aggregateGroups(rsfContributions);
 const maturities:Record<string,{asf:number;rsf:number}>={'< 6 months':{asf:0,rsf:0},'6–12 months':{asf:0,rsf:0},'≥ 1 year':{asf:0,rsf:0},'No contractual maturity':{asf:0,rsf:0},'Unallocated commitments':{asf:0,rsf:0}};
 asfContributions.forEach(c=>maturities[maturityName(c)].asf+=c.weighted);
 rsfContributions.forEach(c=>maturities[maturityName(c)].rsf+=c.weighted);
 return {asfRows,rsfRows,asf,rsf,ratio:rsf>0?asf/rsf:Infinity,minimum:config.riskLimits.minNsfr,target:Math.max(config.riskLimits.minNsfr,state.behaviour.riskAppetite?.nsfr??config.riskLimits.minNsfr*1.05),asfParts,rsfParts,maturities};
}
const signed=(n:number)=>`${n<0?'−':'+'}${formatCurrency(Math.abs(n))}`;
function FundingTable({title,rows,total,kind}:{title:string;rows:FundingRow[];total:number;kind:string}) {
 return <section className="capital-card nsfr-table"><h3>{title}</h3><div className="table-scroll"><table><thead><tr><th>PRA / COREP category</th><th>Amount</th><th>Factor</th><th>{kind}</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><th scope="row">{r.label}</th><td>{formatCurrency(r.amount)}</td><td>{r.factor===null?'—':formatPct(r.factor,1)}</td><td>{formatCurrency(r.weighted)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Total {kind}</th><td>{formatCurrency(total)}</td></tr></tfoot></table></div></section>;
}
function FundingLegend({title,parts}:{title:string;parts:Segment[]}) {return <div><h4>{title}</h4><ul className="lcr-legend">{parts.map(p=><li key={p.label}><i style={{background:p.color}}/><span>{p.label}</span><strong>{formatCurrency(p.value)}</strong></li>)}</ul></div>;}
function FundingStacks({asf,rsf}:{asf:Segment[];rsf:Segment[]}) {
 const stacks=[asf,rsf];
 const floor=Math.min(0,...stacks.map(s=>s.reduce((n,p)=>n+Math.min(0,p.value),0)));
 const ceiling=Math.max(1,...stacks.map(s=>s.reduce((n,p)=>n+Math.max(0,p.value),0)))*1.2;
 const y=(n:number)=>270-(n-floor)/(ceiling-floor)*225;
 return <svg className="nsfr-stack-chart" viewBox="0 0 470 340" role="img" aria-label={`ASF ${formatCurrency(asf.reduce((n,p)=>n+p.value,0))}, RSF ${formatCurrency(rsf.reduce((n,p)=>n+p.value,0))}`}>
 <text x="18" y="25">£bn</text>{[0,1,2,3,4].map(i=>{const n=floor+(ceiling-floor)*i/4;return <g key={i}><path d={`M60 ${y(n)}H455`} stroke="var(--border)"/><text x="52" y={y(n)+5} textAnchor="end">{(n/1e9).toFixed(1)}</text></g>;})}
 {stacks.map((parts,i)=>{let positive=0,negative=0;const x=100+i*210;return <g key={i}>{parts.map(p=>{const start=p.value>=0?positive:negative;if(p.value>=0)positive+=p.value;else negative+=p.value;const end=start+p.value;const top=y(Math.max(start,end)),height=Math.abs(y(end)-y(start));return <g key={p.label}><rect x={x} y={top} width="115" height={height} fill={p.color}><title>{p.label}: {formatCurrency(p.value)}</title></rect>{height>24&&<text x={x+57.5} y={top+height/2+5} textAnchor="middle" className="nsfr-stack-value">{formatCurrency(p.value)}</text>}</g>;})}<text x={x+57.5} y={y(positive)-12} textAnchor="middle" fontWeight="700">{formatCurrency(positive+negative)}</text><text x={x+57.5} y="300" textAnchor="middle" fontWeight="700">{i===0?'Available funding':'Required funding'}<tspan x={x+57.5} dy="21">{i===0?'ASF':'RSF'}</tspan></text></g>;})}
 </svg>;
}
export default function NsfrDashboard({state,config,history}:{state:BankState;config:SimulationConfig;history:BankState[]}) {
 const d=nsfrDashboardData(state,config),required=d.rsf*d.minimum,surplus=d.asf-required;
 const max=Math.max(1.5,d.minimum*1.2,d.target*1.2,Number.isFinite(d.ratio)?d.ratio*1.1:0);
 const ratio=Number.isFinite(d.ratio)?formatPct(d.ratio):'N/A';
 const maturityMax=Math.max(1,...Object.values(d.maturities).flatMap(b=>[Math.abs(b.asf),Math.abs(b.rsf)]));
 return <div className="nsfr-dashboard">
 <div className="nsfr-top">
  <section className={`capital-card ${d.ratio<d.minimum?'shortfall':''}`}><header><h3>NSFR</h3><span className="capital-status">{d.rsf===0?'No required stable funding':d.ratio>=d.minimum?'Compliant':'Below minimum'}</span></header><div className="capital-ratios"><div><strong>{ratio}</strong><span>Actual NSFR</span></div><div><span>Regulatory minimum</span><b>{formatPct(d.minimum,0)}</b></div><div><span>Headroom</span><b className="capital-gap">{Number.isFinite(d.ratio)?`${d.ratio>=d.minimum?'+':''}${((d.ratio-d.minimum)*100).toFixed(1)}pp`:'N/A'}</b></div></div>
  <svg className="capital-bullet" viewBox="0 0 400 65" role="img" aria-label={`NSFR ${ratio}, minimum ${formatPct(d.minimum)}, internal target ${formatPct(d.target)}`}><rect x="8" y="12" width="384" height="18" rx="5" fill="var(--border)"/><rect x="8" y="12" width={d.rsf>0?Math.max(0,384*d.ratio/max):0} height="18" rx="5" fill="currentColor"/><path d={`M${8+384*d.minimum/max} 7v28`} stroke="var(--text)" strokeWidth="3"/><path d={`M${8+384*d.target/max} 7v28`} stroke="#b24b92" strokeWidth="2" strokeDasharray="2 3"/>{[0,1,2,3,4].map(i=><text key={i} x={8+i*96} y="55" textAnchor={i===0?'start':i===4?'end':'middle'}>{formatPct(max*i/4,0)}</text>)}</svg>
  <div className="capital-amounts"><div><b>{formatCurrency(d.asf)}</b><span>Available stable funding (ASF)</span></div><div><b>{formatCurrency(d.rsf)}</b><span>Required stable funding (RSF)</span></div><div><b className="capital-gap">{signed(surplus)}</b><span>Stable funding surplus</span></div></div><p className="lcr-target">Dotted marker: internal target {formatPct(d.target)} · {formatCurrency(d.target*d.rsf)} ASF. Surplus is measured against {formatCurrency(required)} ASF at the regulatory minimum.</p>
  </section>
  <section className="capital-card"><h3>ASF vs RSF</h3><div className="nsfr-comparison"><FundingStacks asf={d.asfParts} rsf={d.rsfParts}/><div><FundingLegend title="PRA ASF components" parts={d.asfParts}/><FundingLegend title="PRA RSF components" parts={d.rsfParts}/></div></div></section>
 </div>
 <div className="nsfr-bottom"><FundingTable title="Available stable funding (ASF) — C81" rows={d.asfRows} total={d.asf} kind="ASF"/><FundingTable title="Required stable funding (RSF) — C80" rows={d.rsfRows} total={d.rsf} kind="RSF"/>
 <div className="nsfr-breakdowns"><section className="capital-card"><h3>RSF by PRA category</h3><div className="nsfr-horizontal">{d.rsfParts.map(p=><div key={p.label}><span>{p.label}</span><div className="nsfr-bar-track"><i style={{width:`${Math.max(0,p.value)/Math.max(1,...d.rsfParts.map(s=>s.value))*100}%`,background:p.color}}/></div><strong>{formatCurrency(p.value)}</strong></div>)}</div></section>
 <section className="capital-card"><h3>NSFR by regulatory maturity band</h3><p className="nsfr-key"><span>● ASF</span><span>● RSF</span></p><div className="nsfr-maturity">{Object.entries(d.maturities).map(([name,b])=><div key={name}><strong>{name}</strong><div><i style={{width:`${Math.abs(b.asf)/maturityMax*100}%`,background:'#43ab85'}}/><span>ASF {formatCurrency(b.asf)}</span></div><div><i style={{width:`${Math.abs(b.rsf)/maturityMax*100}%`,background:'#8060c5'}}/><span>RSF {formatCurrency(b.rsf)}</span></div></div>)}</div><p className="muted">Weighted amounts use the PRA NSFR maturity bands. Retail deposits are split between stable and other retail categories; contractual wholesale and capital instruments use their residual maturity schedules.</p></section></div></div>
 <p className="muted nsfr-factor-note">The detailed tables are generated from the same C80/C81 contribution objects used by the regulatory NSFR calculation. Loan amortisation, non-performing exposures, encumbrance, derivatives and undrawn commitments are classified before aggregation.</p>
 <section className="capital-card"><h3>NSFR over time</h3><div style={{height:270}}><TimeSeriesChart data={history.map(s=>({step:s.time.step,value:s.risk.riskMetrics.nsfr}))} xLabel="Month" yLabel="NSFR (%)"/></div><p className="muted">Management stress estimate: {formatPct(state.risk.riskMetrics.managementNsfr??state.risk.riskMetrics.nsfr)}. This uses behavioural assumptions and is separate from the reported NSFR.</p></section>
 </div>;
}
