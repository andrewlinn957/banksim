import type { BankState } from '../domain/bankState';
import type { ThreeYearPlanEvaluation } from '../domain/threeYearPlan';
import { bankThreeYearPlanMetricRegistry } from '../engine/threeYearPlanMetrics';
import { evaluateThreeYearPlan } from '../engine/threeYearPlan';
import { formatCurrency, formatPct } from '../utils/formatters';

const formatValue = (value:number, format:'money'|'moneyPerShare'|'ratio') => format==='money'?formatCurrency(value):format==='ratio'?formatPct(value):`${(value*100).toFixed(1)}p`;
const formatTarget=(lower:number,upper:number|undefined,format:'money'|'moneyPerShare'|'ratio')=>upper===undefined?formatValue(lower,format):`${formatValue(lower,format)}–${formatValue(upper,format)}`;
const confidenceLabel=(n:number)=>n>=80?'Strong':n>=65?'Stable':n>=45?'Under pressure':'Low';
const confidenceMove=(before:number,after:number)=>{const delta=after-before;return Math.abs(delta)<.05?'unchanged':`${delta>0?'rose':'fell'} ${Math.abs(delta).toFixed(1)} points`;};
const planDrivers=(evaluation:ThreeYearPlanEvaluation)=>{
  const totalWeight=evaluation.metrics.reduce((sum,metric)=>sum+Math.max(0,metric.weight),0);
  return evaluation.metrics
    .map(metric=>({metric,drag:totalWeight>0?(100-metric.score)*Math.max(0,metric.weight)/totalWeight:0}))
    .filter(item=>item.drag>.05)
    .sort((a,b)=>b.drag-a.drag)
    .slice(0,3);
};

export default function ThreeYearPlanPanel({state}:{state:BankState}) {
  const plan=state.threeYearPlan; if(!plan?.enabled) return null;
  const month=Math.min(plan.horizonMonths,Math.max(0,state.time.step-plan.startStep));
  const live=plan.completed&&plan.currentEvaluation?plan.currentEvaluation:evaluateThreeYearPlan({state,month,targets:plan.targets,registry:bankThreeYearPlanMetricRegistry});
  const confidence=plan.boardConfidence??70;
  const nextReview=plan.completed?null:Math.min(plan.horizonMonths,Math.max(plan.reviewIntervalMonths,(Math.floor(month/plan.reviewIntervalMonths)+1)*plan.reviewIntervalMonths));
  const latestReview=plan.reviewHistory?.[plan.reviewHistory.length-1];
  const drivers=latestReview?planDrivers(latestReview.evaluation):[];
  const nextMilestone=month<12?{label:'FY1',month:12}:month<24?{label:'FY2',month:24}:month<36?{label:'FY3',month:36}:null;

  return <section className="card stack three-year-plan" aria-label="Three-Year Plan">
    <div className="section-heading"><div><div className="eyebrow">Three-Year Plan</div><h2>Board mandate</h2></div><div><strong>{confidence.toFixed(0)}/100</strong><div className="muted">Board Confidence · {confidenceLabel(confidence)}</div></div></div>

    <div className="grid-two">
      <div><strong>{plan.completed?'Final plan result':'Live trajectory'} · {live.score.toFixed(0)}/100</strong><div className="muted">Month {month} of 36{plan.completed?' · plan complete':` · indicative until formal review month ${nextReview}`}</div></div>
      <div><strong>{nextMilestone?`Next annual milestone · ${nextMilestone.label}`:'Three-year milestone complete'}</strong><div className="muted">{nextMilestone?`Board plan year-end at month ${nextMilestone.month}.`:'Final FY3 targets have been reviewed.'}</div></div>
    </div>

    <div>
      <strong>{latestReview?`Latest formal board review · month ${latestReview.month}`:'No formal board review yet'}</strong>
      <div className="muted">{latestReview?`Plan score ${latestReview.evaluation.score.toFixed(0)}/100. Board Confidence ${confidenceMove(latestReview.boardConfidenceBefore,latestReview.boardConfidenceAfter)} to ${latestReview.boardConfidenceAfter.toFixed(0)}/100.`:`Board Confidence remains at its opening level until the first quarterly review in month ${plan.reviewIntervalMonths}.`}</div>
      {latestReview&&<div className="muted" style={{marginTop:6}}>{drivers.length===0?'All plan measures met their reviewed trajectory.':<>Largest plan-score drag: {drivers.map((item,index)=>{const def=bankThreeYearPlanMetricRegistry.get(item.metric.metricId);return <span key={item.metric.metricId}>{index?', ':''}{def.label} ({item.drag.toFixed(1)} pts)</span>;})}.</>}</div>}
    </div>

    <div><strong>Live trajectory</strong><div className="muted">This updates every month. It affects Board Confidence only when the next formal quarterly review occurs.</div></div>
    <table className="data-table"><thead><tr><th>Measure</th><th className="numeric">Actual</th><th className="numeric">Current plan</th><th className="numeric">Score</th><th className="numeric">Weight</th></tr></thead><tbody>{live.metrics.map(metric=>{const def=bankThreeYearPlanMetricRegistry.get(metric.metricId);return <tr key={metric.metricId}><td>{def.label}</td><td className="numeric">{formatValue(metric.actual,def.format)}</td><td className="numeric">{formatTarget(metric.targetLower,metric.targetUpper,def.format)}</td><td className="numeric">{metric.score.toFixed(0)}</td><td className="numeric">{metric.weight}%</td></tr>;})}</tbody></table>

    <details><summary>Annual plan milestones</summary><table className="data-table"><thead><tr><th>Measure</th><th className="numeric">FY1</th><th className="numeric">FY2</th><th className="numeric">FY3</th></tr></thead><tbody>{plan.targets.map(target=>{const def=bankThreeYearPlanMetricRegistry.get(target.metricId);return <tr key={target.metricId}><td>{def.label}</td>{target.milestones.map(milestone=><td className="numeric" key={milestone.month}>{formatTarget(milestone.lower,milestone.upper,def.format)}</td>)}</tr>;})}</tbody></table></details>
  </section>;
}