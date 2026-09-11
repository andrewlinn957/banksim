import {
  AssetMaturityLadderMap,
  BankState,
  BehaviouralState,
  EquityMarketState,
  FundingLadderMap,
  LoanCohortsMap,
  LoanPipelineMap,
  LoanWorkoutPipelineMap,
} from '../domain/bankState';
import { BalanceSheet } from '../domain/balanceSheet';
import { CashFlowStatement } from '../domain/cashflow';
import { MarketState } from '../domain/market';
import { IncomeStatement } from '../domain/pnl';
import { ComplianceStatus, LeverageFrameworkAssessmentState, OsiiAssessmentState, Pillar2AAssessmentState, RiskMetrics } from '../domain/risks';
import { LoanCohort, LoanWorkoutBucket } from '../domain/loanCohorts';
import { ProductType } from '../domain/enums';
import type { ThreeYearPlanEvaluation, ThreeYearPlanReviewRecord, ThreeYearPlanState, ThreeYearPlanTarget } from '../domain/threeYearPlan';

const cloneBalanceSheet = (bs: BalanceSheet): BalanceSheet => ({
  items: bs.items.map((item) => ({
    ...item,
    liquidityTag: { ...item.liquidityTag },
    encumbrance: item.encumbrance ? { ...item.encumbrance } : { encumberedAmount: 0 },
    security: item.security ? { ...item.security } : undefined,
  })),
});

const cloneIncomeStatement = (p: IncomeStatement): IncomeStatement => ({ ...p });
const cloneCashFlowStatement = (c: CashFlowStatement): CashFlowStatement => ({ ...c });
const cloneRiskMetrics = (r: RiskMetrics): RiskMetrics => ({ ...r });
const cloneCompliance = (c: ComplianceStatus): ComplianceStatus => ({ ...c });
const clonePillar2A = (p: Pillar2AAssessmentState | undefined): Pillar2AAssessmentState | undefined =>
  p ? {
    ...p,
    components: { ...p.components },
    creditRisk: { ...p.creditRisk },
    concentration: { ...p.concentration },
    irrbb: { ...p.irrbb },
    ps1520: { ...p.ps1520 },
  } : undefined;

const cloneOsii = (o: OsiiAssessmentState | undefined): OsiiAssessmentState | undefined =>
  o ? { ...o, quarterEndObservations: o.quarterEndObservations.map((x) => ({ ...x })) } : undefined;

const cloneLeverageFramework = (
  l: LeverageFrameworkAssessmentState | undefined
): LeverageFrameworkAssessmentState | undefined =>
  l ? {
    ...l,
    accountingReferenceObservations: l.accountingReferenceObservations.map((x) => ({ ...x })),
  } : undefined;

const cloneBehaviour = (b: BehaviouralState): BehaviouralState => ({
  ...b,
  riskAppetite: b.riskAppetite ? { ...b.riskAppetite } : undefined,
  depositRateLagMemory: { ...(b.depositRateLagMemory ?? {}) },
  depositUnderpricingMonths: { ...(b.depositUnderpricingMonths ?? {}) },
  depositStabilityIndex: { ...(b.depositStabilityIndex ?? {}) },
  underwritingTightness: { ...(b.underwritingTightness ?? {}) },
  capitalPolicy: b.capitalPolicy ? { ...b.capitalPolicy } : undefined,
  mortgagePolicy: b.mortgagePolicy ? { ...b.mortgagePolicy } : undefined,
  treasuryPolicy: b.treasuryPolicy ? { ...b.treasuryPolicy } : undefined,
});

const clonePlanTarget = (target: ThreeYearPlanTarget): ThreeYearPlanTarget => ({
  ...target,
  milestones: target.milestones.map(milestone => ({ ...milestone })),
});
const clonePlanEvaluation = (evaluation: ThreeYearPlanEvaluation): ThreeYearPlanEvaluation => ({
  ...evaluation,
  metrics: evaluation.metrics.map(metric => ({ ...metric })),
});
const clonePlanReview = (review: ThreeYearPlanReviewRecord): ThreeYearPlanReviewRecord => ({
  ...review,
  evaluation: clonePlanEvaluation(review.evaluation),
});
const cloneThreeYearPlan = (plan: ThreeYearPlanState | undefined): ThreeYearPlanState | undefined => plan ? ({
  ...plan,
  targets: plan.targets.map(clonePlanTarget),
  currentEvaluation: plan.currentEvaluation ? clonePlanEvaluation(plan.currentEvaluation) : undefined,
  reviewHistory: plan.reviewHistory?.map(clonePlanReview),
  priorCycles: plan.priorCycles?.map(cycle => ({
    ...cycle,
    targets: cycle.targets.map(clonePlanTarget),
    finalEvaluation: clonePlanEvaluation(cycle.finalEvaluation),
    reviewHistory: cycle.reviewHistory.map(clonePlanReview),
  })),
}) : undefined;

const cloneEquityMarket = (m: EquityMarketState): EquityMarketState => ({ ...m });

const cloneMarket = (m: MarketState): MarketState => ({
  ...m,
  giltCurve: {
    ...m.giltCurve,
    nelsonSiegel: { ...m.giltCurve.nelsonSiegel },
    yields: { ...m.giltCurve.yields },
  },
  macroModel: {
    ...m.macroModel,
    factors: { ...m.macroModel.factors },
  },
});

const cloneLoanCohorts = (raw: LoanCohortsMap): LoanCohortsMap => {
  const out: Partial<Record<ProductType, LoanCohort[]>> = {};
  const entries = Object.entries(raw ?? {}) as Array<[ProductType, LoanCohort[]]>;
  entries.forEach(([productType, cohorts]) => {
    out[productType] = (cohorts ?? []).map((c) => ({ ...c }));
  });
  return out;
};

const cloneLoanPipelines = (raw: LoanPipelineMap): LoanPipelineMap => {
  const out: LoanPipelineMap = {};
  const entries = Object.entries(raw ?? {}) as Array<[ProductType, { demandNotional: number; approvedNotional: number; committedNotional: number }]>;
  entries.forEach(([productType, pipeline]) => {
    out[productType] = { ...pipeline };
  });
  return out;
};

const cloneWorkoutPipelines = (raw: LoanWorkoutPipelineMap): LoanWorkoutPipelineMap => {
  const out: LoanWorkoutPipelineMap = {};
  const entries = Object.entries(raw ?? {}) as Array<[ProductType, LoanWorkoutBucket[]]>;
  entries.forEach(([productType, buckets]) => {
    out[productType] = (buckets ?? []).map((bucket) => ({ ...bucket }));
  });
  return out;
};

const cloneFundingLadders = (raw: FundingLadderMap): FundingLadderMap => {
  const out: FundingLadderMap = {};
  const entries = Object.entries(raw ?? {}) as Array<[ProductType, Array<{ tenorMonths: number; monthsToMaturity: number; notional: number; rate: number }>]>;
  entries.forEach(([productType, buckets]) => {
    out[productType] = (buckets ?? []).map((bucket) => ({ ...bucket }));
  });
  return out;
};

const cloneAssetMaturityLadders = (raw: AssetMaturityLadderMap | undefined): AssetMaturityLadderMap => {
  const out: AssetMaturityLadderMap = {};
  const entries = Object.entries(raw ?? {}) as Array<[ProductType, Array<{ tenorMonths: number; monthsToMaturity: number; notional: number; rate: number }>] >;
  entries.forEach(([productType, buckets]) => {
    out[productType] = (buckets ?? []).map((bucket) => ({ ...bucket }));
  });
  return out;
};

const cloneDate = (raw: unknown): Date => raw instanceof Date ? new Date(raw.getTime()) : new Date(raw as any);

export const cloneBankState = (state: BankState): BankState => ({
  ...state,
  version: state.version ?? 'v1',
  time: { ...state.time, date: cloneDate(state.time.date) },
  financial: {
    balanceSheet: cloneBalanceSheet(state.financial.balanceSheet),
    capital: { ...state.financial.capital },
    provisionStock: { ...state.financial.provisionStock },
    hedges: (state.financial.hedges ?? []).map((hedge) => ({ ...hedge })),
    incomeStatement: cloneIncomeStatement(state.financial.incomeStatement),
    cashFlowStatement: cloneCashFlowStatement(state.financial.cashFlowStatement),
  },
  risk: {
    riskMetrics: cloneRiskMetrics(state.risk.riskMetrics),
    compliance: cloneCompliance(state.risk.compliance),
    pillar2A: clonePillar2A(state.risk.pillar2A),
    osii: cloneOsii(state.risk.osii),
    leverageFramework: cloneLeverageFramework(state.risk.leverageFramework),
  },
  board: { ...state.board },
  threeYearPlan: cloneThreeYearPlan(state.threeYearPlan),
  capitalMarkets: state.capitalMarkets ? { ...state.capitalMarkets, transactions: state.capitalMarkets.transactions.map(tx => ({ ...tx })) } : undefined,
  equityMarket: cloneEquityMarket(state.equityMarket),
  market: cloneMarket(state.market),
  behaviour: cloneBehaviour(state.behaviour),
  loanCohorts: cloneLoanCohorts(state.loanCohorts),
  loanPipelines: cloneLoanPipelines(state.loanPipelines),
  workoutPipelines: cloneWorkoutPipelines(state.workoutPipelines),
  fundingLadders: cloneFundingLadders(state.fundingLadders),
  assetMaturityLadders: cloneAssetMaturityLadders(state.assetMaturityLadders),
  status: { ...state.status },
});
