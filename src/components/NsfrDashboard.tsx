import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType as A, LiabilityProductType as L, MaturityBucket } from '../domain/enums';
import { eligibleCet1, prudentialLiquidityLines, committedExposure, commitmentLiquidity } from '../engine/prudential';
import { formatCurrency, formatPct } from '../utils/formatters';
import TimeSeriesChart from './TimeSeriesChart';

type FundingRow={label:string;amount:number;weighted:number;factor:number|null};
type Segment={label:string;value:number;color:string};
const palette=['#18528b','#4d95d6','#43ab85','#a0dbc8','#7661bd','#ada0df'];
export function nsfrDashboardData(state:BankState,config:SimulationConfig) {
 const lines=prudentialLiquidityLines(state,config);
 const equity=eligibleCet1(state,config),at1=state.financial.capital.at1;
 const row=(label:string,amount:number,weighted:number):FundingRow=>({label,amount,weighted,factor:amount!==0?weighted/amount:null});
 const asfRows=[row('CET1 including eligible OCI',equity,equity),row('AT1 capital',at1,at1),...lines.filter(l=>!l.asset).map(l=>row(l.label,l.balance,l.asf))];
 const rsfRows=[...lines.filter(l=>l.asset||l.rsf!==0).map(l=>row(l.label,l.balance,l.rsf)),row('Undrawn commitments',committedExposure(state),commitmentLiquidity(state).rsf)];
 const asf=asfRows.reduce((s,r)=>s+r.weighted,0),rsf=rsfRows.reduce((s,r)=>s+r.weighted,0);
 const ag:Record<string,number>={'Customer deposits':0,'Short-term wholesale':0,'Term wholesale':0,'Eligible capital':equity+at1,'Other funding':0};
 const rg:Record<string,number>={'Customer loans':0,'Securities':0,'Cash & central bank':0,'Other assets & derivatives':0,'Undrawn commitments':commitmentLiquidity(state).rsf};
 const maturities:Record<string,{asf:number;rsf:number}>={Overnight:{asf:0,rsf:0},'< 1 year':{asf:0,rsf:0},'1–3 years':{asf:0,rsf:0},'3–5 years':{asf:0,rsf:0},'> 5 years':{asf:0,rsf:0},'Perpetual / no fixed term':{asf:equity+at1,rsf:0},'Unallocated commitments':{asf:0,rsf:commitmentLiquidity(state).rsf}};
 const bucketNames:Record<MaturityBucket,string>={[MaturityBucket.Overnight]:'Overnight',[MaturityBucket.LessThan1Y]:'< 1 year',[MaturityBucket.OneToThreeY]:'1–3 years',[MaturityBucket.ThreeToFiveY]:'3–5 years',[MaturityBucket.GreaterThan5Y]:'> 5 years',[MaturityBucket.Perpetual]:'Perpetual / no fixed term'};
 lines.forEach((l,i)=>{
  const p=l.productType;
  if(!l.asset) ag[p===L.WholesaleFundingST?'Short-term wholesale':p===L.WholesaleFundingLT?'Term wholesale':String(p).includes('Deposits')?'Customer deposits':'Other funding']+=l.asf;
  rg[p===A.Mortgages||p===A.CorporateLoans?'Customer loans':p===A.Gilts?'Securities':p===A.CashReserves?'Cash & central bank':'Other assets & derivatives']+=l.rsf;
  const bucket=bucketNames[state.financial.balanceSheet.items[i].maturityBucket]??'Perpetual / no fixed term';
  const ladder=state.fundingLadders[p];
  if((p===L.WholesaleFundingST||p===L.WholesaleFundingLT)&&ladder?.length) {
   ladder.forEach(f=>{const key=f.monthsToMaturity<12?'< 1 year':f.monthsToMaturity<=36?'1–3 years':f.monthsToMaturity<=60?'3–5 years':'> 5 years';maturities[key].asf+=f.notional*(f.monthsToMaturity>=12?1:f.monthsToMaturity>=6?.5:0);});
  } else maturities[bucket].asf+=l.asf;
  maturities[bucket].rsf+=l.rsf;
 });
 return {asfRows,rsfRows,asf,rsf,ratio:rsf>0?asf/rsf:Infinity,minimum:config.riskLimits.minNsfr,target:Math.max(config.riskLimits.minNsfr,state.behaviour.riskAppetite?.nsfr??config.riskLimits.minNsfr*1.05),
  asfParts:Object.entries(ag).map(([label,value],i)=>({label,value,color:palette[i]})),rsfParts:Object.entries(rg).map(([label,value],i)=>({label,value,color:['#283f88','#7562be','#a897df','#a3b2d1','#59418f'][i]})),maturities};
}
const signed=(n:number)=>`${n<0?'−':'+'}${formatCurrency(Math.abs(n))}`;
function FundingTable({title,rows,total,kind}:{title:string;rows:FundingRow[];total:number;kind:string}) {
 return <section className="capital-card nsfr-table"><h3>{title}</h3><div className="table-scroll"><table><thead><tr><th>Category</th><th>Amount</th><th>Effective factor</th><th>{kind}</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><th scope="row">{r.label}</th><td>{formatCurrency(r.amount)}</td><td>{r.factor===null?'—':formatPct(r.factor,1)}</td><td>{formatCurrency(r.weighted)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Total {kind}</th><td>{formatCurrency(total)}</td></tr></tfoot></table></div></section>;
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
  <section className="capital-card"><h3>ASF vs RSF</h3><div className="nsfr-comparison"><FundingStacks asf={d.asfParts} rsf={d.rsfParts}/><div><FundingLegend title="ASF components" parts={d.asfParts}/><FundingLegend title="RSF components" parts={d.rsfParts}/></div></div></section>
 </div>
 <div className="nsfr-bottom"><FundingTable title="Available stable funding (ASF)" rows={d.asfRows} total={d.asf} kind="ASF"/><FundingTable title="Required stable funding (RSF)" rows={d.rsfRows} total={d.rsf} kind="RSF"/>
 <div className="nsfr-breakdowns"><section className="capital-card"><h3>RSF by asset class</h3><div className="nsfr-horizontal">{d.rsfParts.map(p=><div key={p.label}><span>{p.label}</span><div className="nsfr-bar-track"><i style={{width:`${Math.max(0,p.value)/Math.max(1,...d.rsfParts.map(s=>s.value))*100}%`,background:p.color}}/></div><strong>{formatCurrency(p.value)}</strong></div>)}</div></section>
 <section className="capital-card"><h3>Funding by maturity bucket</h3><p className="nsfr-key"><span>● ASF</span><span>● RSF</span></p><div className="nsfr-maturity">{Object.entries(d.maturities).map(([name,b])=><div key={name}><strong>{name}</strong><div><i style={{width:`${Math.abs(b.asf)/maturityMax*100}%`,background:'#43ab85'}}/><span>ASF {formatCurrency(b.asf)}</span></div><div><i style={{width:`${Math.abs(b.rsf)/maturityMax*100}%`,background:'#8060c5'}}/><span>RSF {formatCurrency(b.rsf)}</span></div></div>)}</div><p className="muted">Weighted ASF and RSF allocated to recorded balance-sheet maturity buckets; wholesale ASF uses the funding ladder. Deposit stability factors still apply to overnight balances. Undrawn commitments are shown separately because no maturity is recorded.</p></section></div></div>
 <p className="muted nsfr-factor-note">Tables show net carrying amounts and effective weighted factors. Loan amortisation, asset encumbrance and funding maturities can produce blended factors. Eligible CET1 includes the model’s OCI treatment; no Tier 2 is issued.</p>
 <section className="capital-card"><h3>NSFR over time</h3><div style={{height:270}}><TimeSeriesChart data={history.map(s=>({step:s.time.step,value:s.risk.riskMetrics.nsfr}))} xLabel="Month" yLabel="NSFR (%)"/></div><p className="muted">Management stress estimate: {formatPct(state.risk.riskMetrics.managementNsfr??state.risk.riskMetrics.nsfr)}. This uses behavioural assumptions and is separate from the reported NSFR.</p></section>
 </div>;
}
