import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType as A, LiabilityProductType as L } from '../domain/enums';
import { computeHqlaComposition } from '../engine/metrics';
import { prudentialLiquidityLines, commitmentLiquidity } from '../engine/prudential';
import { formatCurrency, formatPct } from '../utils/formatters';
import TimeSeriesChart from './TimeSeriesChart';

const colors=['#15578d','#149ed5','#7753be','#b398e3','#208674','#67c3a2'];
type Part={label:string;value:number;color:string};
export function lcrDashboardData(state:BankState,config:SimulationConfig) {
 const lines=prudentialLiquidityLines(state,config);
 const hqla=computeHqlaComposition(state.financial.balanceSheet.items);
 const commitments=commitmentLiquidity(state).outflow;
 const outGroups:Record<string,number>={'Retail deposits':0,'Business deposits':0,'Wholesale funding':0,'Secured funding':0,'Committed facilities':commitments,'Derivatives & other':0};
 const inGroups:Record<string,number>={'Loan repayments':0,'Secured lending':0,'Derivatives & other':0};
 for(const l of lines){
  const p=l.productType;
  const outKey=([L.RetailDeposits,L.RetailCurrentAccounts] as string[]).includes(p)?'Retail deposits':([L.CorporateDeposits,L.CorporateOperatingDeposits,L.CorporateNonOperatingDeposits] as string[]).includes(p)?'Business deposits':([L.WholesaleFundingST,L.WholesaleFundingLT] as string[]).includes(p)?'Wholesale funding':p===L.RepurchaseAgreements?'Secured funding':'Derivatives & other';
  outGroups[outKey]+=l.outflow;
  inGroups[p===A.Mortgages||p===A.CorporateLoans?'Loan repayments':p===A.ReverseRepo?'Secured lending':'Derivatives & other']+=l.inflow;
 }
 const outgoing=Object.values(outGroups).reduce((a,b)=>a+b,0),incoming=Object.values(inGroups).reduce((a,b)=>a+b,0);
 const cap=outgoing*.75,recognised=Math.min(incoming,cap),net=outgoing-recognised;
 const requirement=config.riskLimits.minLcr;
 const target=Math.max(requirement,state.behaviour.riskAppetite?.lcr??requirement*1.1);
 return {lines,hqla,commitments,outgoing,incoming,cap,recognised,net,requirement,target,ratio:net>0?hqla.total/net:Infinity,required:net*requirement,surplus:hqla.total-net*requirement,
  outParts:Object.entries(outGroups).map(([label,value],i)=>({label,value,color:colors[i]})),
  inParts:Object.entries(inGroups).map(([label,value],i)=>({label,value,color:['#159765','#68c49a','#b1e8d0'][i]})),
  hqlaParts:[{label:'Level 1',value:hqla.level1,color:colors[0]},{label:'Level 2A',value:hqla.eligibleLevel2a,color:colors[1]},{label:'Level 2B',value:hqla.eligibleLevel2b,color:colors[2]}],
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
function DetailTable({title,rows}:{title:string;rows:[string,string][]}) {return <section className="lcr-detail-group"><h4>{title}</h4><table><tbody>{rows.map(([label,value])=><tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table></section>;}
export default function LcrDashboard({state,config,history}:{state:BankState;config:SimulationConfig;history:BankState[]}) {
 const d=lcrDashboardData(state,config);
 const maxRatio=Math.max(2,d.requirement*1.2,d.target*1.2,Number.isFinite(d.ratio)?d.ratio*1.1:0);
 const pp=Number.isFinite(d.ratio)?`${d.ratio>=d.requirement?'+':''}${((d.ratio-d.requirement)*100).toFixed(1)}pp`:'N/A';
 const summary=[{label:'Outflows',value:d.outgoing,color:colors[0]},{label:'Inflows',value:d.incoming,color:colors[1]},{label:'Recognised|inflows',value:d.recognised,color:'#57bce4'},{label:'Net cash|outflows',value:d.net,color:'#30ba80'}];
 return <div className="lcr-dashboard">
 <div className="lcr-working-grid">
  <section className={`capital-card lcr-headline ${d.ratio<d.requirement?'shortfall':''}`}><header><h3>LCR</h3><span className="capital-status">{d.net===0?'No net outflows':d.ratio>=d.requirement?'Compliant':'Below minimum'}</span></header>
   <div className="capital-ratios"><div><strong>{ratioText(d.ratio)}</strong><span>Actual LCR</span></div><div><span>Requirement</span><b>{formatPct(d.requirement,0)}</b></div><div><span>Headroom</span><b className="capital-gap">{pp}</b></div></div>
   <svg className="capital-bullet" viewBox="0 0 400 65" role="img" aria-label={`LCR ${ratioText(d.ratio)}, minimum ${formatPct(d.requirement)}, internal target ${formatPct(d.target)}`}><rect x="8" y="12" width="384" height="18" rx="5" fill="var(--border)"/><rect x="8" y="12" width={d.net>0?384*d.ratio/maxRatio:0} height="18" rx="5" fill="currentColor"/><path d={`M${8+384*d.requirement/maxRatio} 7v28`} stroke="var(--text)" strokeWidth="3"/><path d={`M${8+384*d.target/maxRatio} 7v28`} stroke="#b24b92" strokeWidth="2" strokeDasharray="2 3"/>{[0,1,2,3,4].map(i=><text key={i} x={8+i*96} y="55" textAnchor={i===0?'start':i===4?'end':'middle'}>{formatPct(maxRatio*i/4,0)}</text>)}</svg>
   <p className="lcr-target">Dotted marker: internal target {formatPct(d.target)} · {formatCurrency(d.target*d.net)}</p>
   <div className="capital-amounts"><div><b>{formatCurrency(d.hqla.total)}</b><span>HQLA actual</span></div><div><b>{formatCurrency(d.required)}</b><span>HQLA required</span></div><div><b className="capital-gap">{signed(d.surplus)}</b><span>Liquidity surplus</span></div></div><p className="muted">HQLA required = 30-day net cash outflows × LCR requirement.</p>
  </section>
  <section className="capital-card"><h3>Cash outflows summary</h3><div className="lcr-summary-numbers">{summary.map(s=><div key={s.label}><strong>{formatCurrency(s.value)}</strong><span>{s.label.replace('|',' ')}</span></div>)}</div><Bars bars={summary.map(s=>({label:s.label,parts:[s]}))}/></section>
  <section className="capital-card"><h3>HQLA composition</h3><p className="capital-total">Total eligible HQLA <strong>{formatCurrency(d.hqla.total)}</strong></p><Bars bars={[{label:'High quality liquid assets',parts:d.hqlaParts}]} reference={{value:d.required,label:'HQLA required'}}/><p className="lcr-reference">Dashed line: HQLA required {formatCurrency(d.required)} ({formatPct(d.requirement,0)} of net outflows)</p><Legend parts={d.hqlaParts}/><p className="muted">After encumbrance, haircuts and composition caps. Cap deduction: {formatCurrency(d.hqla.capDeduction)}.</p></section>
  <section className="capital-card"><h3>30-day cash flows</h3><Bars bars={[{label:'Outflows',parts:d.outParts},{label:'Inflows',parts:d.inParts}]}/><p className="lcr-net">Net cash outflows <strong>{formatCurrency(d.net)}</strong></p><h4>Outflow drivers</h4><Legend parts={d.outParts}/><h4>Inflow drivers</h4><Legend parts={d.inParts}/></section>
 </div>
 <aside className="capital-card lcr-detail"><h3>LCR detail</h3>
  <DetailTable title="Summary" rows={[
   ['Total eligible HQLA',formatCurrency(d.hqla.total)],['Total expected outflows',formatCurrency(d.outgoing)],['Total expected inflows',formatCurrency(d.incoming)],['Inflows recognised after cap',formatCurrency(d.recognised)],['30-day net cash outflows',formatCurrency(d.net)],['LCR actual',ratioText(d.ratio)],['LCR minimum',formatPct(d.requirement)],['HQLA required',formatCurrency(d.required)],['Liquidity surplus',signed(d.surplus)],
  ]}/>
  <DetailTable title="HQLA composition" rows={[...d.hqlaParts.map(p=>[p.label+' eligible',formatCurrency(p.value)] as [string,string]),['Level 2A before cap',formatCurrency(d.hqla.level2a)],['Level 2B before cap',formatCurrency(d.hqla.level2b)],['Composition cap deduction',formatCurrency(d.hqla.capDeduction)]]}/>
  <DetailTable title="Outflow drivers" rows={[...d.lines.filter(l=>l.outflow>0).map(l=>[l.label,formatCurrency(l.outflow)] as [string,string]),['Committed facilities',formatCurrency(d.commitments)],['Total outflows',formatCurrency(d.outgoing)]]}/>
  <DetailTable title="Inflow drivers" rows={[...d.lines.filter(l=>l.inflow>0).map(l=>[l.label,formatCurrency(l.inflow)] as [string,string]),['Total inflows',formatCurrency(d.incoming)]]}/>
  <DetailTable title="Inflow cap treatment" rows={[
   ['Inflows before cap',formatCurrency(d.incoming)],['Cap: 75% of outflows',formatCurrency(d.cap)],['Recognised after cap',formatCurrency(d.recognised)],['Excluded inflows',formatCurrency(d.incoming-d.recognised)],['Cap binding?',d.incoming>d.cap?'Yes':'No'],
  ]}/>
 </aside>
 <section className="capital-card lcr-history"><h3>LCR over time</h3><div style={{height:270}}><TimeSeriesChart data={history.map(s=>({step:s.time.step,value:s.risk.riskMetrics.lcr}))} xLabel="Month" yLabel="LCR (%)"/></div><p className="muted">Management stress estimate: {ratioText(state.risk.riskMetrics.managementLcr??state.risk.riskMetrics.lcr)}. This uses behavioural stress assumptions and is separate from the reported LCR.</p></section>
 </div>;
}
