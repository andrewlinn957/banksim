export const THREE_YEAR_PLAN_HORIZON_MONTHS = 36 as const;
export const THREE_YEAR_PLAN_REVIEW_INTERVAL_MONTHS = 3 as const;
export const THREE_YEAR_PLAN_MILESTONE_MONTHS = [12, 24, 36] as const;

export type ThreeYearPlanMilestoneMonth = typeof THREE_YEAR_PLAN_MILESTONE_MONTHS[number];
export type ThreeYearPlanMetricId = string;
export type ThreeYearPlanTargetKind = 'minimum' | 'range';

export interface ThreeYearPlanMilestone {
  month: ThreeYearPlanMilestoneMonth;
  /** Minimum target, or the lower edge of a target range. */
  lower: number;
  /** Upper edge for range targets. Omit for minimum targets. */
  upper?: number;
}

export interface ThreeYearPlanTarget {
  metricId: ThreeYearPlanMetricId;
  weight: number;
  kind: ThreeYearPlanTargetKind;
  /** Opening actual used to interpolate a coherent quarterly trajectory to FY1. */
  baseline: number;
  /** Optional opening upper edge for range metrics; defaults to baseline. */
  baselineUpper?: number;
  milestones: readonly ThreeYearPlanMilestone[];
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

/**
 * Optional management-plan state. Board confidence belongs to the plan state deliberately:
 * nothing outside plan performance is permitted to update it directly.
 */
export interface ThreeYearPlanState {
  enabled: boolean;
  startStep: number;
  horizonMonths: typeof THREE_YEAR_PLAN_HORIZON_MONTHS;
  reviewIntervalMonths: typeof THREE_YEAR_PLAN_REVIEW_INTERVAL_MONTHS;
  targets: readonly ThreeYearPlanTarget[];
  currentEvaluation?: ThreeYearPlanEvaluation;
  boardConfidence?: number;
  lastEvaluationStep?: number;
}

export interface ThreeYearPlanSettings {
  enabled: boolean;
  initialBoardConfidence: number;
  /** Weight placed on the latest plan score at each quarterly review. */
  confidenceUpdateWeight: number;
}

/** Sandbox default: the plan mechanic is inert unless explicitly enabled. */
export const DEFAULT_THREE_YEAR_PLAN_SETTINGS: ThreeYearPlanSettings = {
  enabled: false,
  initialBoardConfidence: 70,
  confidenceUpdateWeight: 0.25,
};

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
    targets: args.targets,
    boardConfidence: settings.enabled ? settings.initialBoardConfidence : undefined,
  };
};
