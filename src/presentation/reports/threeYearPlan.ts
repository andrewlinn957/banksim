import type { BankState } from '../../domain/bankState';
import type { ThreeYearPlanEvaluation } from '../../domain/threeYearPlan';
import { bankThreeYearPlanMetricRegistry } from '../../engine/threeYearPlanMetrics';
import { evaluateThreeYearPlan } from '../../engine/threeYearPlan';
import { formatCurrency, formatPct } from '../../utils/formatters';

const formatValue = (value: number, format: 'money' | 'moneyPerShare' | 'ratio') =>
  format === 'money' ? formatCurrency(value) : format === 'ratio' ? formatPct(value) : `${(value * 100).toFixed(1)}p`;

const formatTarget = (lower: number, upper: number | undefined, format: 'money' | 'moneyPerShare' | 'ratio') =>
  upper === undefined ? formatValue(lower, format) : `${formatValue(lower, format)}–${formatValue(upper, format)}`;

const confidenceLabel = (confidence: number) => confidence >= 80 ? 'Strong' : confidence >= 65 ? 'Stable' : confidence >= 45 ? 'Under pressure' : 'Low';

const confidenceMove = (before: number, after: number) => {
  const delta = after - before;
  return Math.abs(delta) < 0.05 ? 'unchanged' : `${delta > 0 ? 'rose' : 'fell'} ${Math.abs(delta).toFixed(1)} points`;
};

const planDrivers = (evaluation: ThreeYearPlanEvaluation) => {
  const totalWeight = evaluation.metrics.reduce((sum, metric) => sum + Math.max(0, metric.weight), 0);
  return evaluation.metrics
    .map((metric) => ({ metric, drag: totalWeight > 0 ? (100 - metric.score) * Math.max(0, metric.weight) / totalWeight : 0 }))
    .filter((item) => item.drag > 0.05)
    .sort((a, b) => b.drag - a.drag)
    .slice(0, 3);
};

/** Exact player-visible three-year mandate data shared by the Boardroom and player API. */
export const buildThreeYearPlanPresentation = (state: BankState) => {
  const plan = state.threeYearPlan;
  if (!plan?.enabled) return null;

  const month = Math.min(plan.horizonMonths, Math.max(0, state.time.step - plan.startStep));
  const evaluation = plan.completed && plan.currentEvaluation
    ? plan.currentEvaluation
    : evaluateThreeYearPlan({ state, month, targets: plan.targets, registry: bankThreeYearPlanMetricRegistry });
  const confidence = plan.boardConfidence ?? 70;
  const nextReview = plan.completed
    ? null
    : Math.min(plan.horizonMonths, Math.max(plan.reviewIntervalMonths, (Math.floor(month / plan.reviewIntervalMonths) + 1) * plan.reviewIntervalMonths));
  const latestReview = plan.reviewHistory?.[plan.reviewHistory.length - 1];
  const drivers = latestReview ? planDrivers(latestReview.evaluation) : [];
  const nextMilestone = month < 12 ? { label: 'FY1', month: 12 }
    : month < 24 ? { label: 'FY2', month: 24 }
      : month < 36 ? { label: 'FY3', month: 36 }
        : null;

  return {
    title: 'Board mandate',
    expandedByDefault: month === 0,
    boardConfidence: `${confidence.toFixed(0)}/100`,
    boardConfidenceLabel: `Board Confidence · ${confidenceLabel(confidence)}`,
    resultHeading: `${plan.completed ? 'Final plan result' : 'Live trajectory'} · ${evaluation.score.toFixed(0)}/100`,
    resultDetail: `Month ${month} of 36${plan.completed ? ' · mandate complete' : ` · indicative until formal review month ${nextReview}`}`,
    milestoneHeading: nextMilestone ? `Next annual milestone · ${nextMilestone.label}` : 'Three-year mandate complete',
    milestoneDetail: nextMilestone ? `Board target date: month ${nextMilestone.month}.` : 'Final FY3 targets have been reviewed.',
    reviewHeading: latestReview ? `Latest formal board review · month ${latestReview.month}` : 'No formal board review yet',
    reviewDetail: latestReview
      ? `Plan score ${latestReview.evaluation.score.toFixed(0)}/100. Board Confidence ${confidenceMove(latestReview.boardConfidenceBefore, latestReview.boardConfidenceAfter)} to ${latestReview.boardConfidenceAfter.toFixed(0)}/100.`
      : `Board Confidence remains at its opening level until the first quarterly review in month ${plan.reviewIntervalMonths}.`,
    reviewDrivers: latestReview
      ? drivers.length === 0
        ? 'All mandate measures met their reviewed trajectory.'
        : `Largest plan-score drag: ${drivers.map(({ metric, drag }) => `${bankThreeYearPlanMetricRegistry.get(metric.metricId).label} (${drag.toFixed(1)} pts)`).join(', ')}.`
      : null,
    progress: plan.completed ? null : {
      heading: 'Progress against mandate',
      detail: 'This updates every month. Board Confidence changes only at formal quarterly reviews.',
      targetColumn: 'Current target',
      rows: evaluation.metrics.map((metric) => {
        const definition = bankThreeYearPlanMetricRegistry.get(metric.metricId);
        return {
          id: metric.metricId,
          label: definition.label,
          actual: formatValue(metric.actual, definition.format),
          target: formatTarget(metric.targetLower, metric.targetUpper, definition.format),
          score: metric.score.toFixed(0),
          weight: `${metric.weight}%`,
        };
      }),
    },
    finalResult: plan.completed ? {
      targetColumn: 'Final target',
      rows: evaluation.metrics.map((metric) => {
        const definition = bankThreeYearPlanMetricRegistry.get(metric.metricId);
        return {
          id: metric.metricId,
          label: definition.label,
          actual: formatValue(metric.actual, definition.format),
          target: formatTarget(metric.targetLower, metric.targetUpper, definition.format),
          score: metric.score.toFixed(0),
          weight: `${metric.weight}%`,
        };
      }),
    } : null,
    targetTable: {
      summary: 'FY1 / FY2 / FY3 mandate targets',
      columns: ['FY1', 'FY2', 'FY3'],
      rows: plan.targets.map((target) => {
        const definition = bankThreeYearPlanMetricRegistry.get(target.metricId);
        return {
          id: target.metricId,
          label: definition.label,
          milestones: target.milestones.map((milestone) => formatTarget(milestone.lower, milestone.upper, definition.format)),
        };
      }),
    },
  };
};
