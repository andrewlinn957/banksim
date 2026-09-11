export const THREE_YEAR_PLAN_HORIZON_MONTHS = 36 as const;
export const THREE_YEAR_PLAN_REVIEW_INTERVAL_MONTHS = 3 as const;
export const THREE_YEAR_PLAN_MILESTONE_MONTHS = [12, 24, 36] as const;

export type ThreeYearPlanMilestoneMonth = typeof THREE_YEAR_PLAN_MILESTONE_MONTHS[number];
export type ThreeYearPlanMetricId = string;
export type ThreeYearPlanTargetKind = 'minimum' | 'range';

export interface ThreeYearPlanMilestone {
  month: ThreeYearPlanMilestoneMonth;
  lower: number;
  upper?: number;
}

export interface ThreeYearPlanTarget {
  metricId: ThreeYearPlanMetricId;
  weight: number;
  kind: ThreeYearPlanTargetKind;
  baseline: number;
  baselineUpper?: number;
  milestones: readonly ThreeYearPlanMilestone[];
  /** Absolute miss from the target that maps to a zero metric score. */
  missTolerance?: number;
}

export interface ThreeYearPlanMetricResult {
  metricId: ThreeYearPlanMetricId;
  actual: number;
  targetLower: number;
  targetUpper?: number;
  score: number;
  weight: number;
}

export interface ThreeYearPlanEvaluation {
  month: number;
  score: number;
  metrics: readonly ThreeYearPlanMetricResult[];
}

/** Immutable record of a formal quarterly board review. */
export interface ThreeYearPlanReviewRecord {
  month: number;
  evaluation: ThreeYearPlanEvaluation;
  boardConfidenceBefore: number;
  boardConfidenceAfter: number;
}

/** Board Confidence is deliberately owned by, and updated only through, the plan state. */
export interface ThreeYearPlanState {
  enabled: boolean;
  startStep: number;
  horizonMonths: typeof THREE_YEAR_PLAN_HORIZON_MONTHS;
  reviewIntervalMonths: typeof THREE_YEAR_PLAN_REVIEW_INTERVAL_MONTHS;
  confidenceUpdateWeight: number;
  targets: readonly ThreeYearPlanTarget[];
  currentEvaluation?: ThreeYearPlanEvaluation;
  reviewHistory?: readonly ThreeYearPlanReviewRecord[];
  boardConfidence?: number;
  lastEvaluationStep?: number;
  completed?: boolean;
}

export interface ThreeYearPlanSettings {
  enabled: boolean;
  initialBoardConfidence: number;
  confidenceUpdateWeight: number;
}

export const DEFAULT_THREE_YEAR_PLAN_SETTINGS: ThreeYearPlanSettings = {
  enabled: false,
  initialBoardConfidence: 70,
  confidenceUpdateWeight: 0.25,
};

const cloneTargets = (targets: readonly ThreeYearPlanTarget[]): ThreeYearPlanTarget[] =>
  targets.map(target => ({
    ...target,
    milestones: target.milestones.map(milestone => ({ ...milestone })),
  }));

export const createThreeYearPlanState = (args: {
  startStep: number;
  targets: readonly ThreeYearPlanTarget[];
  settings?: ThreeYearPlanSettings;
}): ThreeYearPlanState => {
  const settings = args.settings ?? DEFAULT_THREE_YEAR_PLAN_SETTINGS;
  return {
    enabled: settings.enabled,
    startStep: args.startStep,
    horizonMonths: THREE_YEAR_PLAN_HORIZON_MONTHS,
    reviewIntervalMonths: THREE_YEAR_PLAN_REVIEW_INTERVAL_MONTHS,
    confidenceUpdateWeight: settings.confidenceUpdateWeight,
    targets: cloneTargets(args.targets),
    reviewHistory: [],
    boardConfidence: settings.enabled ? settings.initialBoardConfidence : undefined,
    completed: false,
  };
};
