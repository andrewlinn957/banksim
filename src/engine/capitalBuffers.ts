import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType, BalanceSheetSide, ProductType } from '../domain/enums';
import { OsiiAssessmentState, OsiiScopeRoute } from '../domain/risks';
import { hasCapability } from '../products/capabilities';
import { regulatoryRiskWeight } from '../products/regulatory';
import { hedgeExposures } from './hedgeValuation';
import { committedExposure, eligibleCet1 } from './prudential';

const CORE_DEPOSIT_SCOPE_THRESHOLD = 35e9;
const LOW_TRADING_THRESHOLD = 0.10;
const OSII_ASSESSMENT_INTERVAL_MONTHS = 12;

export interface OsiiThresholdBucket {
  lowerBound: number;
  rate: number;
}

export const osiiThresholdsForYear = (effectiveYear: number): { year: number; buckets: OsiiThresholdBucket[] } => {
  if (effectiveYear <= 2026) {
    return {
      year: 2026,
      buckets: [
        { lowerBound: 190e9, rate: 0.01 },
        { lowerBound: 365e9, rate: 0.015 },
        { lowerBound: 540e9, rate: 0.02 },
        { lowerBound: 715e9, rate: 0.025 },
        { lowerBound: 890e9, rate: 0.03 },
      ],
    };
  }
  return {
    year: 2027,
    buckets: [
      { lowerBound: 205e9, rate: 0.01 },
      { lowerBound: 390e9, rate: 0.015 },
      { lowerBound: 575e9, rate: 0.02 },
      { lowerBound: 760e9, rate: 0.025 },
      { lowerBound: 945e9, rate: 0.03 },
    ],
  };
};

export const osiiRateForAverageLem = (averageUkLem: number, effectiveYear: number): number => {
  const buckets = osiiThresholdsForYear(effectiveYear).buckets;
  let rate = 0;
  for (const bucket of buckets) {
    if (averageUkLem >= bucket.lowerBound) rate = bucket.rate;
  }
  return rate;
};

const nextOsiiThreshold = (averageUkLem: number, effectiveYear: number) =>
  osiiThresholdsForYear(effectiveYear).buckets.find((bucket) => averageUkLem < bucket.lowerBound);

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const advanceMonths = (raw: Date, months: number): Date => {
  const date = new Date(raw);
  date.setUTCMonth(date.getUTCMonth() + Math.max(0, Math.round(months)));
  return date;
};

const currentCoreDeposits = (state: BankState): number =>
  state.financial.balanceSheet.items.reduce(
    (sum, item) => sum + (hasCapability(item.productType, 'customerDeposit') ? Math.max(0, item.balance) : 0),
    0
  );

const currentTradingAssetsProxy = (state: BankState): number =>
  state.financial.balanceSheet.items.reduce(
    (sum, item) => sum + (item.productType === AssetProductType.DerivativeAssets ? Math.max(0, item.balance) : 0),
    0
  );

export const calculateOsiiScope = (state: BankState, config: SimulationConfig) => {
  const coreDeposits = currentCoreDeposits(state);
  const tradingAssets = currentTradingAssetsProxy(state);
  const tier1 = Math.max(0, eligibleCet1(state, config) + state.financial.capital.at1);
  const tradingAssetsToTier1 = tier1 > 0 ? tradingAssets / tier1 : Infinity;
  const inScope = coreDeposits > CORE_DEPOSIT_SCOPE_THRESHOLD;
  const scopeRoute: OsiiScopeRoute = !inScope
    ? 'belowCoreDepositThreshold'
    : tradingAssetsToTier1 < LOW_TRADING_THRESHOLD
      ? 'largeDomesticBank'
      : 'ringFencedBankProxy';
  return { inScope, scopeRoute, coreDeposits, tradingAssets, tradingAssetsToTier1 };
};

/**
 * BankSim's O-SII UK LEM proxy follows the published framework description: central-bank
 * reserves are excluded and committed but undrawn credit facilities are included. The game is
 * currently a domestic UK bank, so the whole measure is treated as UK. The derivative book is
 * replaced by the model's prudential derivative exposure, consistently with the leverage engine.
 */
export const calculateOsiiUkLeverageExposure = (state: BankState): number => {
  const assets = state.financial.balanceSheet.items.filter((item) => item.side === BalanceSheetSide.Asset);
  const totalAssets = assets.reduce((sum, item) => sum + Math.max(0, item.balance), 0);
  const centralBankReserves = assets.reduce(
    (sum, item) => sum + (item.productType === AssetProductType.CashReserves ? Math.max(0, item.balance) : 0),
    0
  );
  const derivativeBook = assets.reduce(
    (sum, item) => sum + (item.productType === AssetProductType.DerivativeAssets ? Math.max(0, item.balance) : 0),
    0
  );
  return Math.max(
    0,
    totalAssets - centralBankReserves - derivativeBook + hedgeExposures(state).leverage + committedExposure(state)
  );
};

const relevantCreditRwa = (state: BankState): number => {
  let total = 0;
  const entries = Object.entries(state.loanCohorts ?? {}) as Array<
    [ProductType, Array<{ outstandingPrincipal: number }>]
  >;
  for (const [productType, cohorts] of entries) {
    if (!hasCapability(productType, 'loan')) continue;
    for (const cohort of cohorts ?? []) {
      total += Math.max(0, cohort.outstandingPrincipal) * regulatoryRiskWeight(productType);
    }
  }
  return total;
};

export const calculateInstitutionSpecificCcyb = (state: BankState, config: SimulationConfig) => {
  const ukRate = Math.max(0, config.riskLimits.capitalBufferStack.countercyclicalBuffer);
  const totalRelevantCreditRwa = relevantCreditRwa(state);
  // All currently modelled cohort geographies are UK regions. Keep this explicit so international
  // products can later supply non-UK weights without changing the combined-buffer engine.
  const ukRelevantCreditRwa = totalRelevantCreditRwa;
  const ukShare = totalRelevantCreditRwa > 0 ? ukRelevantCreditRwa / totalRelevantCreditRwa : 0;
  return {
    rate: ukRate * ukShare,
    ukRate,
    ukShare,
    ukRelevantCreditRwa,
    totalRelevantCreditRwa,
  };
};

const observationDate = (state: BankState, observationStep: number): Date =>
  observationStep > state.time.step
    ? advanceMonths(state.time.date, state.time.stepLengthMonths)
    : new Date(state.time.date);

export const ensureOsiiAssessment = (state: BankState, config: SimulationConfig): OsiiAssessmentState => {
  const existing = state.risk.osii;
  const currentUkLem = calculateOsiiUkLeverageExposure(state);
  const currentScope = calculateOsiiScope(state, config);
  const closingStep = existing ? state.time.step + 1 : state.time.step;
  let observations = existing?.quarterEndObservations.map((x) => ({ ...x })) ?? [];

  if (closingStep === 0 || closingStep % 3 === 0) {
    if (!observations.some((x) => x.step === closingStep)) {
      observations.push({
        step: closingStep,
        date: observationDate(state, closingStep).toISOString(),
        ukLeverageExposure: currentUkLem,
      });
      observations = observations.sort((a, b) => a.step - b.step).slice(-4);
    }
  }

  const due = !existing || closingStep >= existing.nextAssessmentStep;
  if (!due && existing) {
    const updated = { ...existing, quarterEndObservations: observations };
    state.risk.osii = updated;
    return updated;
  }

  const assessmentStep = existing ? closingStep : state.time.step;
  const assessmentDate = observationDate(state, assessmentStep);
  const effectiveYear = assessmentDate.getUTCFullYear() + 1;
  const averageQuarterEndUkLeverageExposure = observations.length
    ? average(observations.map((x) => x.ukLeverageExposure))
    : currentUkLem;
  const assessedRate = currentScope.inScope
    ? osiiRateForAverageLem(averageQuarterEndUkLeverageExposure, effectiveYear)
    : 0;

  const assessment: OsiiAssessmentState = {
    assessedRate,
    assessmentStep,
    nextAssessmentStep: assessmentStep + OSII_ASSESSMENT_INTERVAL_MONTHS,
    effectiveYear,
    averageQuarterEndUkLeverageExposure,
    inScopeAtAssessment: currentScope.inScope,
    scopeRouteAtAssessment: currentScope.scopeRoute,
    quarterEndObservations: observations,
  };
  state.risk.osii = assessment;
  return assessment;
};

export const calculateCapitalBufferFramework = (args: { state: BankState; config: SimulationConfig }) => {
  const { state, config } = args;
  const conservationRate = Math.max(0, config.riskLimits.capitalBufferStack.conservationBuffer);
  const ccyb = calculateInstitutionSpecificCcyb(state, config);
  const osii = ensureOsiiAssessment(state, config);
  const scope = calculateOsiiScope(state, config);
  const currentUkLem = calculateOsiiUkLeverageExposure(state);
  const trailingAverage = osii.quarterEndObservations.length
    ? average(osii.quarterEndObservations.map((x) => x.ukLeverageExposure))
    : currentUkLem;
  const manualSystemicFloor = Math.max(0, config.riskLimits.capitalBufferStack.systemicBuffer);
  const osiiRate = Math.max(osii.assessedRate, manualSystemicFloor);
  const nextEffectiveYear = osii.effectiveYear + 1;
  const schedule = osiiThresholdsForYear(nextEffectiveYear);
  const next = nextOsiiThreshold(trailingAverage, nextEffectiveYear);

  return {
    conservationRate,
    ccybRate: ccyb.rate,
    ukCcybRate: ccyb.ukRate,
    ukRelevantCreditRwaShare: ccyb.ukShare,
    osiiRate,
    combinedBufferRate: conservationRate + ccyb.rate + osiiRate,
    osiiInScope: scope.inScope,
    osiiScopeRoute: scope.scopeRoute,
    osiiCoreDeposits: scope.coreDeposits,
    osiiTradingAssets: scope.tradingAssets,
    osiiTradingAssetsToTier1: scope.tradingAssetsToTier1,
    osiiCurrentUkLeverageExposure: currentUkLem,
    osiiTrailingAverageUkLeverageExposure: trailingAverage,
    osiiAssessedAverageUkLeverageExposure: osii.averageQuarterEndUkLeverageExposure,
    osiiNextThreshold: next?.lowerBound,
    osiiNextThresholdRate: next?.rate,
    osiiNextAssessmentStep: osii.nextAssessmentStep,
    osiiThresholdScheduleYear: schedule.year,
  };
};
