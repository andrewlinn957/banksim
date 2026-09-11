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

/** Immutable summary retained when a completed plan is replaced by its successor. */
export interface ThreeYearPlanCycleRecord {
  cycleNumber: number;
  startStep: number;
  endStep: number;
  targets: readonly ThreeYearPlanTarget[];
  finalEvaluation: ThreeYearPlanEvaluation;
  reviewHistory: readonly ThreeYearPlanReviewRecord[];
  finalBoardConfidence: number;
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
  /** Formal quarterly reviews. Optional for backwards-compatible saved states. */
  reviewHistory?: readonly ThreeYearPlanReviewRecord[];
  boardConfidence?: number;
  lastEvaluationStep?: number;
  completed?: boolean;
  /** Defaults to 1 for saves created before renewable plans existed. */
  cycleNumber?: number;
  /** Completed predecessor plans, oldest first. */
  priorCycles?: readonly ThreeYearPlanCycleRecord[];
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

const cloneEvaluation = (evaluation: ThreeYearPlanEvaluation): ThreeYearPlanEvaluation => ({
  ...evaluation,
  metrics: evaluation.metrics.map(metric => ({ ...metric })),
});

const cloneTargets = (targets: readonly ThreeYearPlanTarget[]): ThreeYearPlanTarget[] =>
  targets.map(target => ({
    ...target,
    milestones: target.milestones.map(milestone => ({ ...milestone })),
  }));

const cloneReviews = (reviews: readonly ThreeYearPlanReviewRecord[] | undefined): ThreeYearPlanReviewRecord[] =>
  (reviews ?? []).map(review => ({
    ...review,
    evaluation: cloneEvaluation(review.evaluation),
  }));

export const createThreeYearPlanState = (args: {
  startStep: number;
  targets: readonly ThreeYearPlanTarget[];
  settings?: ThreeYearPlanSettings;
  cycleNumber?: number;
  priorCycles?: readonly ThreeYearPlanCycleRecord[];
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
    cycleNumber: args.cycleNumber ?? 1,
    priorCycles: [...(args.priorCycles ?? [])],
  };
};

export const archiveCompletedThreeYearPlan = (
  plan: ThreeYearPlanState,
  endStep: number
): ThreeYearPlanCycleRecord => {
  if (!plan.enabled || !plan.completed || !plan.currentEvaluation) {
    throw new Error('Only a completed Three-Year Plan can be archived');
  }
  return {
    cycleNumber: plan.cycleNumber ?? 1,
    startStep: plan.startStep,
    endStep,
    targets: cloneTargets(plan.targets),
    finalEvaluation: cloneEvaluation(plan.currentEvaluation),
    reviewHistory: cloneReviews(plan.reviewHistory),
    finalBoardConfidence: plan.boardConfidence ?? DEFAULT_THREE_YEAR_PLAN_SETTINGS.initialBoardConfidence,
  };
};

/**
 * Starts the next 36-month cycle. The opening confidence is inherited solely from the
 * completed predecessor plan, so renewal does not introduce any non-plan confidence input.
 */
export const renewThreeYearPlanState = (args: {
  completedPlan: ThreeYearPlanState;
  startStep: number;
  targets: readonly ThreeYearPlanTarget[];
}): ThreeYearPlanState => {
  const archive = archiveCompletedThreeYearPlan(args.completedPlan, args.startStep);
  const priorCycles = [...(args.completedPlan.priorCycles ?? []), archive];
  return createThreeYearPlanState({
    startStep: args.startStep,
    targets: args.targets,
    settings: {
      enabled: true,
      initialBoardConfidence: archive.finalBoardConfidence,
      confidenceUpdateWeight: args.completedPlan.confidenceUpdateWeight,
    },
    cycleNumber: (args.completedPlan.cycleNumber ?? 1) + 1,
    priorCycles,
  });
};
