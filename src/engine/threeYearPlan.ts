import type { ThreeYearPlanEvaluation, ThreeYearPlanMetricResult, ThreeYearPlanTarget } from '../domain/threeYearPlan';

export interface ThreeYearPlanMetricDefinition<State> {
  id: string;
  label: string;
  read: (state: State) => number;
}

/**
 * Registry keeps plan metrics extensible: plan state stores metric IDs, while the engine owns
 * the state extractors. Adding a new plan metric does not require widening the plan domain model.
 */
export class ThreeYearPlanMetricRegistry<State> {
  private readonly definitions = new Map<string, ThreeYearPlanMetricDefinition<State>>();

  register(definition: ThreeYearPlanMetricDefinition<State>): this {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Three-year plan metric already registered: ${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
    return this;
  }

  get(id: string): ThreeYearPlanMetricDefinition<State> {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown three-year plan metric: ${id}`);
    return definition;
  }

  read(id: string, state: State): number {
    return this.get(id).read(state);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const targetAtMonth = (target: ThreeYearPlanTarget, month: number): { lower: number; upper?: number } => {
  const boundedMonth = Math.min(36, Math.max(0, month));
  const milestones = [...target.milestones].sort((a, b) => a.month - b.month);
  if (milestones.length !== 3 || milestones.map((m) => m.month).join(',') !== '12,24,36') {
    throw new Error(`Three-year plan target ${target.metricId} must define milestones at 12, 24 and 36 months`);
  }

  let fromMonth = 0;
  let fromLower = target.baseline;
  let fromUpper = target.kind === 'range' ? (target.baselineUpper ?? target.baseline) : undefined;

  for (const milestone of milestones) {
    if (boundedMonth <= milestone.month) {
      const t = (boundedMonth - fromMonth) / (milestone.month - fromMonth);
      return {
        lower: lerp(fromLower, milestone.lower, t),
        upper: target.kind === 'range'
          ? lerp(fromUpper ?? fromLower, milestone.upper ?? milestone.lower, t)
          : undefined,
      };
    }
    fromMonth = milestone.month;
    fromLower = milestone.lower;
    fromUpper = milestone.upper;
  }

  const final = milestones[milestones.length - 1];
  return { lower: final.lower, upper: target.kind === 'range' ? (final.upper ?? final.lower) : undefined };
};

const scoreMinimum = (actual: number, target: number): number => {
  if (actual >= target) return 100;
  const scale = Math.max(Math.abs(target), 1e-9);
  return 100 * clamp01(actual / scale);
};

const scoreRange = (actual: number, lower: number, upper: number): number => {
  if (actual >= lower && actual <= upper) return 100;
  if (actual < lower) {
    const scale = Math.max(Math.abs(lower), 1e-9);
    return 100 * clamp01(actual / scale);
  }
  // Mild symmetric efficiency penalty outside the upper edge. Exact shape is calibration, not doctrine.
  const width = Math.max(Math.abs(upper - lower), Math.abs(upper) * 0.1, 1e-9);
  return 100 * clamp01(1 - (actual - upper) / (4 * width));
};

export const evaluateThreeYearPlan = <State>(args: {
  state: State;
  month: number;
  targets: readonly ThreeYearPlanTarget[];
  registry: ThreeYearPlanMetricRegistry<State>;
}): ThreeYearPlanEvaluation => {
  const weightTotal = args.targets.reduce((sum, target) => sum + Math.max(0, target.weight), 0);
  if (weightTotal <= 0) throw new Error('Three-year plan must contain at least one positively weighted target');

  const metrics: ThreeYearPlanMetricResult[] = args.targets.map((target) => {
    const actual = args.registry.read(target.metricId, args.state);
    const trajectory = targetAtMonth(target, args.month);
    const score = target.kind === 'minimum'
      ? scoreMinimum(actual, trajectory.lower)
      : scoreRange(actual, trajectory.lower, trajectory.upper ?? trajectory.lower);
    return {
      metricId: target.metricId,
      actual,
      targetLower: trajectory.lower,
      targetUpper: trajectory.upper,
      score,
      weight: target.weight,
    };
  });

  const score = metrics.reduce((sum, metric) => sum + metric.score * Math.max(0, metric.weight), 0) / weightTotal;
  return { month: args.month, score, metrics };
};

/**
 * Deliberately accepts only the prior confidence and the plan score. There is no API through which
 * cash, liquidity, franchise, regulatory condition or any other state variable can directly enter
 * Board Confidence.
 */
export const updateBoardConfidenceFromPlan = (
  previousConfidence: number,
  planScore: number,
  latestScoreWeight = 0.25
): number => {
  const weight = clamp01(latestScoreWeight);
  return Math.min(100, Math.max(0, previousConfidence * (1 - weight) + planScore * weight));
};
