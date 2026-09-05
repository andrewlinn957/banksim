import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { ProductType } from '../domain/enums';
import { LoanCohort, LoanWorkoutBucket } from '../domain/loanCohorts';

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

// Probability-weighted discounted cash shortfalls. PD/LGD paths are model estimates.
export const cohortEcl = (c: LoanCohort, config: SimulationConfig): number => {
  const principal = Math.max(0, c.outstandingPrincipal);
  const term = Math.max(1, c.termMonths - c.ageMonths);
  const horizon = c.stage === 'stage1' ? Math.min(12, term) : term;
  const r = Math.max(0, c.annualInterestRate) / 12;
  const lgd = clamp(c.effectiveLgd ?? c.lgd);
  if (c.stage === 'stage3') {
    const lag = Math.max(1, config.behaviour.creditRiskDynamics?.workoutPipeline?.baseResolutionLagMonths ?? 6);
    return principal - principal * (1 - lgd) / (1 + r) ** lag;
  }
  const payment = r > 0 ? principal * r / (1 - (1 + r) ** -term) : principal / term;
  const configured = config.behaviour.ifrs9?.eclScenarios;
  const scenarios = configured?.some(s => s.weight > 0) ? configured : [{ weight: 1, pdMultiplier: 1 }];
  const weight = scenarios.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  return scenarios.reduce((sum, s) => {
    const pd = 1 - (1 - clamp((c.effectiveAnnualPd ?? c.annualPd) * s.pdMultiplier)) ** (1 / 12);
    let exposure = principal, survival = 1, loss = 0;
    for (let month = 1; month <= horizon; month++) {
      loss += survival * pd * exposure * lgd / (1 + r) ** month;
      survival *= 1 - pd;
      exposure = Math.max(0, exposure - Math.max(0, payment - exposure * r));
    }
    return sum + loss * Math.max(0, s.weight) / weight;
  }, 0);
};

export const workoutRecoveryEstimator = (state: BankState, config: SimulationConfig, product: ProductType) => {
  const buckets = state.workoutPipelines?.[product] ?? [];
  const sectors = new Map<string, number>(), geographies = new Map<string, number>();
  let total = 0;
  for (const b of buckets) {
    total += b.defaultedPrincipal;
    sectors.set(b.sector ?? 'other', (sectors.get(b.sector ?? 'other') ?? 0) + b.defaultedPrincipal);
    geographies.set(b.geography ?? 'other', (geographies.get(b.geography ?? 'other') ?? 0) + b.defaultedPrincipal);
  }
  const p = config.behaviour.creditRiskDynamics?.workoutPipeline;
  const macroPenalty = (p?.macroRecoveryPenaltySensitivity ?? 0) * (Math.max(0, state.market.unemploymentRate - 0.05) + Math.max(0, -state.market.gdpGrowthMoM) * 12);
  return (b: LoanWorkoutBucket) => {
    const share = total > 0 ? Math.max(sectors.get(b.sector ?? 'other') ?? 0, geographies.get(b.geography ?? 'other') ?? 0) / total : 0;
    return clamp(b.expectedRecoveryRate - macroPenalty - (p?.concentrationRecoveryPenaltySensitivity ?? 0) * share, Math.min(b.expectedRecoveryRate, p?.baseRecoveryRateFloor ?? 0));
  };
};
export const workoutPresentValue = (state: BankState, config: SimulationConfig, product: ProductType, bucket: LoanWorkoutBucket, recoveryRate?: number): number =>
  Math.max(0, bucket.defaultedPrincipal) * (recoveryRate ?? workoutRecoveryEstimator(state, config, product)(bucket)) /
  (1 + Math.max(0, bucket.effectiveInterestRate ?? 0) / 12) ** Math.max(0, bucket.monthsToResolution);

// Pipeline offers use expected take-up and the resulting loan's ECL.
// IFRS expected drawdowns are independent of prudential CCFs.
export const commitmentEcl = (state: BankState, config: SimulationConfig): number =>
  Object.entries(state.loanPipelines ?? {}).reduce((sum, [key, pipeline]) => {
    const productType = key as ProductType, p = config.productParameters[productType];
    if (!p?.loan || !pipeline?.committedNotional) return sum;
    const cohorts = state.loanCohorts[productType] ?? [];
    const gross = cohorts.reduce((n, c) => n + c.outstandingPrincipal, 0);
    const pd = gross > 0 ? cohorts.reduce((n, c) => n + c.outstandingPrincipal * (c.effectiveAnnualPd ?? c.annualPd), 0) / gross : p.baseDefaultRate;
    const rate = state.financial.balanceSheet.items.find(i => i.productType === productType)?.interestRate ?? 0;
    const flow = config.behaviour.loanPipelineByProduct?.[productType];
    const draw = clamp(flow?.drawdownRateMonthly ?? 1), cancel = clamp(flow?.cancellationRateMonthly ?? 0);
    const monthlyDraw = (1 - cancel) * draw;
    const takeUp = monthlyDraw + cancel > 0 ? monthlyDraw / (monthlyDraw + cancel) : 0;
    return sum + takeUp * cohortEcl({ productType, cohortId: -1, originalPrincipal: pipeline.committedNotional, outstandingPrincipal: Math.max(0, pipeline.committedNotional), annualInterestRate: rate, annualPd: p.baseDefaultRate, effectiveAnnualPd: pd, lgd: p.lossGivenDefault, termMonths: p.loan.defaultTermMonths, ageMonths: 0, stage: pd > p.baseDefaultRate * (config.behaviour.ifrs9?.sicrPdMultiplierThreshold ?? 1.75) ? 'stage2' : 'stage1' }, config);
  }, 0);
