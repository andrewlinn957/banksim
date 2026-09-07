import { useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LinearScale, PointElement, LineElement, LineController, Tooltip } from 'chart.js';
import { BankState } from '../domain/bankState';
import { formatCurrency, formatPct } from '../utils/formatters';
ChartJS.register(LineController,LinearScale,PointElement,LineElement,Tooltip);
type Choice={label:string;unit:'ratio'|'money'|'headroom';value:(s:BankState)=>number|undefined;dash?:number[]};
const choices:Choice[]=[
 {label:'CET1',unit:'ratio',value:s=>s.risk.riskMetrics.cet1Ratio},
 {label:'Tier 1',unit:'ratio',value:s=>s.risk.riskMetrics.tier1Ratio},
 {label:'Total capital',unit:'ratio',value:s=>s.risk.riskMetrics.totalCapitalRatio},
 {label:'CET1 requirement',unit:'ratio',value:s=>s.risk.riskMetrics.cet1Requirement,dash:[6,4]},
 {label:'CET1 minimum',unit:'ratio',value:s=>s.risk.riskMetrics.minimumCet1Ratio,dash:[6,4]},
 {label:'Tier 1 requirement',unit:'ratio',value:s=>s.risk.riskMetrics.tier1Requirement,dash:[6,4]},
 {label:'Total capital requirement',unit:'ratio',value:s=>s.risk.riskMetrics.totalCapitalRequirement,dash:[6,4]},
 {label:'Tier 1 minimum',unit:'ratio',value:s=>s.risk.riskMetrics.minimumTier1Ratio,dash:[6,4]},
 {label:'Total capital minimum',unit:'ratio',value:s=>s.risk.riskMetrics.minimumTotalCapitalRatio,dash:[6,4]},
 {label:'PRA CET1 target',unit:'ratio',value:s=>s.risk.riskMetrics.praBufferTarget,dash:[8,4]},
 {label:'Internal CET1 target',unit:'ratio',value:s=>s.risk.riskMetrics.internalCet1TargetRatio,dash:[2,4]},
 {label:'Leverage',unit:'ratio',value:s=>s.risk.riskMetrics.leverageRatio},
 {label:'LCR',unit:'ratio',value:s=>s.risk.riskMetrics.lcr},
 {label:'NSFR',unit:'ratio',value:s=>s.risk.riskMetrics.nsfr},
 {label:'Leverage target',unit:'ratio',value:s=>s.risk.riskMetrics.internalLeverageTargetRatio,dash:[2,4]},
 {label:'LCR target',unit:'ratio',value:s=>s.risk.riskMetrics.internalLcrTargetRatio,dash:[2,4]},
 {label:'NSFR target',unit:'ratio',value:s=>s.risk.riskMetrics.internalNsfrTargetRatio,dash:[2,4]},
 {label:'Policy payout cap',unit:'ratio',value:s=>s.risk.riskMetrics.maxPayoutRatio},
 {label:'CET1 headroom',unit:'headroom',value:s=>s.risk.riskMetrics.cet1Headroom},
 {label:'Internal CET1 headroom',unit:'headroom',value:s=>s.risk.riskMetrics.internalCet1Headroom},
 {label:'CET1 held',unit:'money',value:s=>s.risk.riskMetrics.cet1Ratio*s.risk.riskMetrics.rwa},
 {label:'AT1 held',unit:'money',value:s=>s.financial.capital.at1},
 {label:'Tier 1 held',unit:'money',value:s=>(s.risk.riskMetrics.tier1Ratio??NaN)*s.risk.riskMetrics.rwa},
 {label:'Total capital held',unit:'money',value:s=>(s.risk.riskMetrics.totalCapitalRatio??NaN)*s.risk.riskMetrics.rwa},
 {label:'RWA',unit:'money',value:s=>s.risk.riskMetrics.rwa},
 {label:'CET1 required',unit:'money',value:s=>s.risk.riskMetrics.cet1Requirement*s.risk.riskMetrics.rwa,dash:[6,4]},
 {label:'Tier 1 required',unit:'money',value:s=>(s.risk.riskMetrics.tier1Requirement??NaN)*s.risk.riskMetrics.rwa,dash:[6,4]},
 {label:'Total capital required',unit:'money',value:s=>(s.risk.riskMetrics.totalCapitalRequirement??NaN)*s.risk.riskMetrics.rwa,dash:[6,4]},
 {label:'PRA target capital',unit:'money',value:s=>(s.risk.riskMetrics.praBufferTarget??NaN)*s.risk.riskMetrics.rwa,dash:[8,4]},
 {label:'Internal target capital',unit:'money',value:s=>s.risk.riskMetrics.internalCet1TargetRatio*s.risk.riskMetrics.rwa,dash:[2,4]},
];
const colors=['#147db3','#7954b3','#198b72','#c14d35','#6b7280','#a66809','#b24b92','#415a77','#039aab','#b87925','#64732f','#8b507d','#578887','#a2515b'];
export default function CapitalHistory({history}:{history:BankState[]}) {
 const [unit,setUnit]=useState<Choice['unit']>('ratio');
 const [selected,setSelected]=useState(['CET1','CET1 requirement','Internal CET1 target']);
 const [years,setYears]=useState('all');
 const visible=choices.filter(c=>c.unit===unit);
 const end=history.at(-1)?.time.step??0;
 const points=history.filter(s=>years==='all'||s.time.step>=end-Number(years)*12);
 const fmt=(n:number)=>unit==='money'?formatCurrency(n):unit==='headroom'?`${(n*100).toFixed(2)}pp`:formatPct(n);
 return <section className="capital-card capital-history"><h3>Capital and risk history</h3><div className="metric-switch"><label>Measure <select value={unit} onChange={e=>{const u=e.target.value as Choice['unit'];setUnit(u);setSelected(u==='ratio'?['CET1','CET1 requirement','Internal CET1 target']:u==='money'?['CET1 held','CET1 required','Internal target capital']:['CET1 headroom','Internal CET1 headroom']);}}><option value="ratio">Ratios (%)</option><option value="money">Amounts (£)</option><option value="headroom">Headroom (pp)</option></select></label><label>Period <select value={years} onChange={e=>setYears(e.target.value)}><option value="all">Full history</option><option value="1">Last year</option><option value="3">Last 3 years</option><option value="5">Last 5 years</option></select></label></div>
 <div className="history-toggles" role="group" aria-label="Historical metrics">{visible.map(c=><button key={c.label} className={`button ${selected.includes(c.label)?'primary':'ghost'}`} aria-pressed={selected.includes(c.label)} onClick={()=>setSelected(s=>s.includes(c.label)?s.filter(k=>k!==c.label):[...s,c.label])}>{c.label}</button>)}</div>
 {selected.length===0?<p>Select at least one metric to draw the chart.</p>:<><div className="history-legend">{visible.filter(c=>selected.includes(c.label)).map(c=><span key={c.label}><i style={{borderColor:colors[choices.indexOf(c)%colors.length],borderTopStyle:c.dash?'dashed':'solid'}}/>{c.label}</span>)}</div><div style={{height:340}}><Line aria-label="Selected risk metrics over time" data={{datasets:visible.filter(c=>selected.includes(c.label)).map(c=>({label:c.label,data:points.map(s=>({x:s.time.step,y:Number.isFinite(c.value(s))?c.value(s)!:null})),borderColor:colors[choices.indexOf(c)%colors.length],borderDash:c.dash,borderWidth:2,pointRadius:points.length<3?4:0,pointHitRadius:10,tension:0,spanGaps:false}))}} options={{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{tooltip:{callbacks:{title:items=>{const s=points[items[0]?.dataIndex??0];return s?s.time.date.toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'}):'';},label:ctx=>`${ctx.dataset.label}: ${ctx.parsed.y===null?'Unavailable':fmt(ctx.parsed.y)}`}}},scales:{x:{type:'linear',title:{display:true,text:'Simulation year'},ticks:{stepSize:12,callback:v=>`Y${Math.floor((Number(v)-(history[0]?.time.step??0))/12)+1}`}},y:{ticks:{callback:v=>fmt(Number(v))},title:{display:true,text:unit==='money'?'£':unit==='headroom'?'Percentage points':'%'}}}}}/></div></>}
 {history.length<2&&<p className="muted">Opening position. Advance time to build a history.</p>}
 </section>;
}
