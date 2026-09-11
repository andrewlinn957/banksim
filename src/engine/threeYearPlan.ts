import type { ThreeYearPlanEvaluation, ThreeYearPlanMetricResult, ThreeYearPlanReviewRecord, ThreeYearPlanState, ThreeYearPlanTarget } from '../domain/threeYearPlan';

export type ThreeYearPlanMetricFormat = 'money' | 'moneyPerShare' | 'ratio';
export interface ThreeYearPlanMetricDefinition<State> {
  id: string;
  label: string;
  format: ThreeYearPlanMetricFormat;
  read: (state: State) => number;
}

export class ThreeYearPlanMetricRegistry<State> {
  private readonly definitions = new Map<string, ThreeYearPlanMetricDefinition<State>>();
  register(definition: ThreeYearPlanMetricDefinition<State>): this {
    if (this.definitions.has(definition.id)) throw new Error(`Three-year plan metric already registered: ${definition.id}`);
    this.definitions.set(definition.id, definition); return this;
  }
  get(id: string): ThreeYearPlanMetricDefinition<State> {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown three-year plan metric: ${id}`);
    return definition;
  }
  read(id: string, state: State): number { return this.get(id).read(state); }
  has(id: string): boolean { return this.definitions.has(id); }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const targetAtMonth = (target: ThreeYearPlanTarget, month: number): { lower: number; upper?: number } => {
  const boundedMonth = Math.min(36, Math.max(0, month));
  const milestones = [...target.milestones].sort((a, b) => a.month - b.month);
  if (milestones.length !== 3 || milestones.map((m) => m.month).join(',') !== '12,24,36') throw new Error(`Three-year plan target ${target.metricId} must define milestones at 12, 24 and 36 months`);
  let fromMonth = 0, fromLower = target.baseline;
  let fromUpper = target.kind === 'range' ? (target.baselineUpper ?? target.baseline) : undefined;
  for (const milestone of milestones) {
    if (boundedMonth <= milestone.month) {
      const t = (boundedMonth - fromMonth) / (milestone.month - fromMonth);
      return { lower: lerp(fromLower, milestone.lower, t), upper: target.kind === 'range' ? lerp(fromUpper ?? fromLower, milestone.upper ?? milestone.lower, t) : undefined };
    }
    fromMonth = milestone.month; fromLower = milestone.lower; fromUpper = milestone.upper;
  }
  const final = milestones[milestones.length - 1];
  return { lower: final.lower, upper: target.kind === 'range' ? (final.upper ?? final.lower) : undefined };
};

const missScore = (gap: number, tolerance: number) => 100 * clamp01(1 - Math.max(0, gap) / Math.max(1e-9, tolerance));
const scoreMinimum = (actual: number, target: number, tolerance?: number): number => actual >= target ? 100 : missScore(target - actual, tolerance ?? Math.max(Math.abs(target) * 0.25, 1e-9));
const scoreRange = (actual: number, lower: number, upper: number, tolerance?: number): number => {
  if (actual >= lower && actual <= upper) return 100;
  const fallback = Math.max(Math.abs(upper - lower), Math.abs(upper) * 0.1, 1e-9);
  return missScore(actual < lower ? lower - actual : actual - upper, tolerance ?? fallback);
};

export const evaluateThreeYearPlan = <State>(args: { state: State; month: number; targets: readonly ThreeYearPlanTarget[]; registry: ThreeYearPlanMetricRegistry<State>; }): ThreeYearPlanEvaluation => {
  const weightTotal = args.targets.reduce((sum, target) => sum + Math.max(0, target.weight), 0);
  if (weightTotal <= 0) throw new Error('Three-year plan must contain at least one positively weighted target');
  const metrics: ThreeYearPlanMetricResult[] = args.targets.map((target) => {
    const actual = args.registry.read(target.metricId, args.state);
    const trajectory = targetAtMonth(target, args.month);
    const score = target.kind === 'minimum' ? scoreMinimum(actual, trajectory.lower, target.missTolerance) : scoreRange(actual, trajectory.lower, trajectory.upper ?? trajectory.lower, target.missTolerance);
    return { metricId: target.metricId, actual, targetLower: trajectory.lower, targetUpper: trajectory.upper, score, weight: target.weight };
  });
  return { month: args.month, score: metrics.reduce((sum, metric) => sum + metric.score * Math.max(0, metric.weight), 0) / weightTotal, metrics };
};

/** Deliberately has no BankState input: confidence can only see prior confidence and plan score. */
export const updateBoardConfidenceFromPlan = (previousConfidence: number, planScore: number, latestScoreWeight = 0.25): number => {
  const weight = clamp01(latestScoreWeight);
  return Math.min(100, Math.max(0, previousConfidence * (1 - weight) + planScore * weight));
};

export interface ThreeYearPlanReviewResult { reviewed: boolean; evaluation?: ThreeYearPlanEvaluation; boardConfidence?: number; completed?: boolean; record?: ThreeYearPlanReviewRecord; }
export const reviewThreeYearPlan = <State extends { time: { step: number }; threeYearPlan?: ThreeYearPlanState }>(state: State, registry: ThreeYearPlanMetricRegistry<State>): ThreeYearPlanReviewResult => {
  const plan = state.threeYearPlan;
  if (!plan?.enabled || plan.completed) return { reviewed: false };
  const month = state.time.step - plan.startStep;
  if (month <= 0 || month > plan.horizonMonths || month % plan.reviewIntervalMonths !== 0 || plan.lastEvaluationStep === state.time.step) return { reviewed: false };
  const evaluation = evaluateThreeYearPlan({ state, month, targets: plan.targets, registry });
  const previous = plan.boardConfidence ?? 70;
  const boardConfidence = updateBoardConfidenceFromPlan(previous, evaluation.score, plan.confidenceUpdateWeight);
  const record: ThreeYearPlanReviewRecord = {
    month,
    evaluation,
    boardConfidenceBefore: previous,
    boardConfidenceAfter: boardConfidence,
  };
  plan.currentEvaluation = evaluation;
  plan.boardConfidence = boardConfidence;
  plan.lastEvaluationStep = state.time.step;
  plan.reviewHistory = [...(plan.reviewHistory ?? []), record];
  plan.completed = month >= plan.horizonMonths;
  return { reviewed: true, evaluation, boardConfidence, completed: plan.completed, record };
};