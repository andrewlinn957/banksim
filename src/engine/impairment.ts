import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { ProductType } from '../domain/enums';
import { LoanCohort, LoanWorkoutBucket } from '../domain/loanCohorts';
import type { MarketState } from '../domain/market';

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/** Market levels at the reporting date. Scenario paths are forward projections. */
type EclMarket = Pick<MarketState, 'gdpGrowthMoM' | 'unemploymentRate' | 'creditSpread'>;
const projectedRisk = (
  market: EclMarket | undefined,
  scenario: { gdpGrowthMoMShock?: number; unemploymentRateShock?: number; creditSpreadShock?: number },
  month: number,
): { pdFactor: number; lgdFactor: number } => {
  if (!market) return { pdFactor: 1, lgdFactor: 1 };
  // Scenario shocks emerge over six months then fade; macro variables return
  // gradually towards neutral levels. This is a transparent game assumption.
  const phase = (1 - Math.exp(-month / 6)) * Math.exp(-month / 36);
  const reversion = 1 - Math.exp(-month / 30);
  const futureGdp = market.gdpGrowthMoM + (.002 - market.gdpGrowthMoM) * reversion +
    (scenario.gdpGrowthMoMShock ?? 0) * phase;
  const futureUnemployment = market.unemploymentRate + (.045 - market.unemploymentRate) * reversion +
    (scenario.unemploymentRateShock ?? 0) * phase;
  const futureSpread = market.creditSpread + (.012 - market.creditSpread) * reversion +
    (scenario.creditSpreadShock ?? 0) * phase;
  const gdpGap = futureGdp - market.gdpGrowthMoM;
  const unemploymentGap = futureUnemployment - market.unemploymentRate;
  const spreadGap = futureSpread - market.creditSpread;
  const logPd = clamp(10 * unemploymentGap - 20 * gdpGap + 8 * spreadGap, -.9, 1.3);
  const lgdFactor = clamp(1 + 3 * unemploymentGap - 2 * gdpGap + 3 * spreadGap, .7, 1.5);
  return { pdFactor: Math.exp(logPd), lgdFactor };
};

/**
 * Probability-weighted, discounted loss from 12-month defaults (Stage 1) or
 * lifetime defaults (Stage 2). The model assumes a flat annual hazard within
 * each macro path and an amortising balance; origination fees are excluded.
 */
export const cohortEcl = (c: LoanCohort, config: SimulationConfig, market?: EclMarket): number => {
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
  const totalWeight = scenarios.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  return scenarios.reduce((sum, scenario) => {
    let exposure = principal, survival = 1, loss = 0;
    for (let month = 1; month <= horizon; month++) {
      const forecast = projectedRisk(market, scenario, month);
      const annualPd = clamp((c.effectiveAnnualPd ?? c.annualPd) * scenario.pdMultiplier * forecast.pdFactor, 0, .999999);
      const pd = 1 - (1 - annualPd) ** (1 / 12);
      const scenarioLgd = clamp(lgd * (scenario.lgdMultiplier ?? 1) * forecast.lgdFactor);
      loss += survival * pd * exposure * scenarioLgd / (1 + r) ** month;
      survival *= 1 - pd;
      exposure = Math.max(0, exposure - Math.max(0, payment - exposure * r));
    }
    return sum + loss * Math.max(0, scenario.weight) / totalWeight;
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
    return sum + takeUp * cohortEcl({ productType, cohortId: -1, originalPrincipal: pipeline.committedNotional, outstandingPrincipal: Math.max(0, pipeline.committedNotional), annualInterestRate: rate, annualPd: p.baseDefaultRate, effectiveAnnualPd: pd, lgd: p.lossGivenDefault, termMonths: p.loan.defaultTermMonths, ageMonths: 0, stage: pd > p.baseDefaultRate * (config.behaviour.ifrs9?.sicrPdMultiplierThreshold ?? 1.75) ? 'stage2' : 'stage1' }, config, state.market);
  }, 0);
