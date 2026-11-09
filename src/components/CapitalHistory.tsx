import { useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LinearScale, PointElement, LineElement, LineController, Tooltip } from 'chart.js';
import { BankState } from '../domain/bankState';
import { buildCapitalHistoryData, CAPITAL_HISTORY_DEFAULTS, formatCapitalHistoryValue, type CapitalHistoryUnit } from '../presentation/reports/capitalHistory';
ChartJS.register(LineController,LinearScale,PointElement,LineElement,Tooltip);
export default function CapitalHistory({history}:{history:BankState[]}) {
 const [unit,setUnit]=useState<CapitalHistoryUnit>('ratio');
 const [selected,setSelected]=useState(CAPITAL_HISTORY_DEFAULTS.ratio);
 const [years,setYears]=useState('all');
 const data=buildCapitalHistoryData(history,unit,selected,years);
 const visible=data.measures;
 const fmt=(n:number)=>formatCapitalHistoryValue(n,unit);
 return <section className="capital-card capital-history">
  <h3>Capital and risk history</h3>
  <div className="metric-switch">
   <label>Measure <select value={unit} onChange={e=>{const next=e.target.value as CapitalHistoryUnit;setUnit(next);setSelected(CAPITAL_HISTORY_DEFAULTS[next]);}}><option value="ratio">Ratios (%)</option><option value="money">Amounts (£)</option><option value="headroom">Headroom (pp)</option></select></label>
   <label>Period <select value={years} onChange={e=>setYears(e.target.value)}><option value="all">Full history</option><option value="1">Last year</option><option value="3">Last 3 years</option><option value="5">Last 5 years</option></select></label>
  </div>
  <div className="history-toggles" role="group" aria-label="Historical metrics">{visible.map(measure=><button key={measure.label} className={`button ${selected.includes(measure.label)?'primary':'ghost'}`} aria-pressed={selected.includes(measure.label)} onClick={()=>setSelected(current=>current.includes(measure.label)?current.filter(key=>key!==measure.label):[...current,measure.label])}>{measure.label}</button>)}</div>
  {selected.length===0?<p>Select at least one metric to draw the chart.</p>:<>
   <div className="history-legend">{data.datasets.map(series=><span key={series.label}><i style={{borderColor:series.color,borderTopStyle:series.dash?'dashed':'solid'}}/>{series.label}</span>)}</div>
   <div style={{height:340}}><Line aria-label="Selected risk metrics over time" data={{datasets:data.datasets.map(series=>({label:series.label,data:series.points,borderColor:series.color,borderDash:series.dash,borderWidth:2,pointRadius:data.points.length<3?4:0,pointHitRadius:10,tension:0,spanGaps:false}))}} options={{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{tooltip:{callbacks:{title:items=>{const point=data.points[items[0]?.dataIndex??0];return point?new Date(point.date).toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'}):'';},label:ctx=>`${ctx.dataset.label}: ${ctx.parsed.y===null?'Unavailable':fmt(ctx.parsed.y)}`}}},scales:{x:{type:'linear',title:{display:true,text:'Simulation year'},ticks:{stepSize:12,callback:v=>`Y${Math.floor((Number(v)-data.historyStartStep)/12)+1}`}},y:{ticks:{callback:v=>fmt(Number(v))},title:{display:true,text:data.axisTitle}}}}}/></div>
  </>}
  {history.length<2&&<p className="muted">Opening position. Advance time to build a history.</p>}
 </section>;
}
