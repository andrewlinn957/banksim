import { BankState } from '../domain/bankState';
import { ScenarioGoals, ScenarioMetricKey, ScenarioScore } from '../domain/scoring';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const resolveMetric = (state: BankState, key: ScenarioMetricKey): number => {
  const equity =
    state.financial.capital.cet1 +
    state.financial.capital.at1 +
    state.financial.capital.accumulatedOCI;
  const assets = state.financial.balanceSheet.items
    .filter((item) => item.side === 'Asset')
    .reduce((sum, item) => sum + item.balance, 0);
  const income = state.financial.incomeStatement;
  const roe = equity > 0 ? (income.netIncome * 12) / equity : 0;
  const nim = assets > 0 ? (income.netInterestIncome * 12) / assets : 0;

  switch (key) {
    case 'cet1Ratio':
      return state.risk.riskMetrics.cet1Ratio;
    case 'leverageRatio':
      return state.risk.riskMetrics.leverageRatio;
    case 'lcr':
      return state.risk.riskMetrics.lcr;
    case 'nsfr':
      return state.risk.riskMetrics.nsfr;
    case 'roe':
      return roe;
    case 'nim':
      return nim;
    case 'netIncome':
      return income.netIncome;
    case 'equity':
      return equity;
    case 'assets':
      return assets;
    default:
      return 0;
  }
};

const objectiveCompletion = (direction: 'min' | 'max', current: number, target: number): number => {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return 0;
  if (target === 0) return direction === 'min' ? (current >= 0 ? 1 : 0) : current <= 0 ? 1 : 0;

  if (direction === 'min') {
    return clamp(current / target, 0, 1);
  }
  return clamp(target / current, 0, 1);
};

export interface ScenarioScoringOptions {
  horizonRiskPenaltyWeight?: number;
}

export const evaluateScenarioGoals = (
  state: BankState,
  goals: ScenarioGoals,
  options?: ScenarioScoringOptions
): ScenarioScore => {
  const details = goals.objectives.map((objective) => {
    const current = resolveMetric(state, objective.metric);
    const completion = objectiveCompletion(objective.direction, current, objective.target);
    const passed = objective.direction === 'min' ? current >= objective.target : current <= objective.target;
    return {
      label: objective.label,
      metric: objective.metric,
      current,
      target: objective.target,
      direction: objective.direction,
      weight: objective.weight,
      completion,
      passed,
    };
  });

  const maxScore = details.reduce((sum, detail) => sum + detail.weight, 0);
  const rawScore = details.reduce((sum, detail) => sum + detail.weight * detail.completion, 0);
  const franchisePenalty = clamp((0.75 - state.behaviour.depositFranchiseStrength) / 0.75, 0, 1);
  const fundingPenalty = clamp((state.risk.riskMetrics.fundingStressIndex ?? 0) / 1.25, 0, 1);
  const liquidityPenalty = clamp((1.02 - Math.min(state.risk.riskMetrics.lcr, state.risk.riskMetrics.nsfr)) / 1.02, 0, 1);
  const baseQualityPenalty = clamp(
    franchisePenalty * 0.35 + fundingPenalty * 0.4 + liquidityPenalty * 0.25,
    0,
    0.65
  );
  const configuredWeight = clamp(options?.horizonRiskPenaltyWeight ?? 0.35, 0, 1);
  const qualityPenalty = clamp(
    baseQualityPenalty * (configuredWeight / 0.35),
    0,
    0.9
  );
  const score = rawScore * (1 - qualityPenalty);
  const completionPct = maxScore > 0 ? score / maxScore : 0;
  const passed = details.every((detail) => detail.passed);

  return {
    horizonMonths: goals.horizonMonths,
    rawScore,
    score,
    maxScore,
    completionPct,
    qualityPenalty,
    qualityPenaltyBreakdown: {
      franchise: franchisePenalty,
      funding: fundingPenalty,
      liquidity: liquidityPenalty,
    },
    passed,
    details,
  };
};
