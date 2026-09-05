import { hedgeExposures } from './hedgeValuation';
import { assetCreditRwa } from './creditRwa';
import { ownFundsRequirements } from './prudential';
import { centralBankExclusion, committedExposure, commitmentLiquidity, prudentialLiquidityLines } from './prudential';
import { BankState } from '../domain/bankState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { AssetProductType, BalanceSheetSide, HQLALevel, LiabilityProductType, ProductType } from '../domain/enums';
import { SimulationConfig } from '../domain/config';
import { ComplianceStatus, FundingConfidenceState, RiskLimits, RiskMetrics } from '../domain/risks';
import { LiquidityTag } from '../domain/liquidity';
import { LoanGeography, LoanSector } from '../domain/loanCohorts';
import { PRODUCT_META } from '../domain/productMeta';

export const HQLA_FACTORS: Record<HQLALevel, number> = {
  [HQLALevel.Level1]: 1.0,
  [HQLALevel.Level2A]: 0.85,
  [HQLALevel.Level2B]: 0.5,
  [HQLALevel.None]: 0,
};

const FUNDING_PRODUCTS: Array<
  LiabilityProductType.WholesaleFundingST | LiabilityProductType.WholesaleFundingLT
> = [LiabilityProductType.WholesaleFundingST, LiabilityProductType.WholesaleFundingLT];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isCustomerDeposit = (productType: ProductType): boolean =>
  Boolean(PRODUCT_META[productType]?.behaviour?.isCustomerDeposit);

const isRecessionRegime = (state: BankState): boolean =>
  state.market.macroModel.gdpRegime === 'recession' ||
  state.market.gdpGrowthMoM < 0 ||
  state.market.unemploymentRate > 0.075;

export const computeHqla = (items: BalanceSheetItem[]): number => {
  let level1 = 0, level2a = 0, level2b = 0;
  for (const i of items) {
    if (i.side !== BalanceSheetSide.Asset) continue;
    const v = Math.max(0, i.balance - Math.max(0, i.encumbrance?.encumberedAmount ?? 0));
    if (i.liquidityTag?.hqlaLevel === HQLALevel.Level1) level1 += v;
    if (i.liquidityTag?.hqlaLevel === HQLALevel.Level2A) level2a += v * .85;
    if (i.liquidityTag?.hqlaLevel === HQLALevel.Level2B) level2b += v * .5;
  }
  const a = Math.min(level2a, level1 * 2 / 3);
  const b = Math.min(level2b, (level1 + a) * .15 / .85, Math.max(0, level1 * 2 / 3 - a));
  return level1 + a + b;
};

interface LiquidityDynamicsFactors {
  depositOutflowMultiplier: number;
  inflowMultiplier: number;
  asfMultiplier: number;
}

const computeDepositQualityIndex = (state: BankState): number => {
  const qualityMap = state.behaviour.depositStabilityIndex ?? {};
  const deposits = state.financial.balanceSheet.items.filter((item) =>
    isCustomerDeposit(item.productType)
  );
  const total = deposits.reduce((sum, item) => sum + Math.max(0, item.balance), 0);
  if (total <= 0) return 1;
  const weighted = deposits.reduce((sum, item) => {
    const balance = Math.max(0, item.balance);
    const quality = clamp(qualityMap[item.productType] ?? 1, 0.4, 1.1);
    return sum + balance * quality;
  }, 0);
  return clamp(weighted / total, 0.4, 1.1);
};

const computeLiquidityDynamicsFactors = (
  state: BankState,
  config: SimulationConfig,
  lcrOutflowMultiplier: number,
  depositQualityIndex: number
): LiquidityDynamicsFactors => {
  const p = config.behaviour.liquidityDynamics;
  if (!p) {
    return {
      depositOutflowMultiplier: lcrOutflowMultiplier,
      inflowMultiplier: 1,
      asfMultiplier: 1,
    };
  }

  const recession = isRecessionRegime(state);
  const franchisePenalty = Math.max(0, 1 - clamp(state.behaviour.depositFranchiseStrength, 0, 1));
  const reputationPenalty = Math.max(0, 1 - clamp(state.behaviour.reputation, 0, 1));
  const qualityPenalty = Math.max(0, 1 - clamp(depositQualityIndex, 0, 1.1));
  const behaviouralRunoff =
    1 +
    franchisePenalty * (p.franchiseRunoffSensitivity ?? 0) +
    reputationPenalty * (p.reputationRunoffSensitivity ?? 0) +
    qualityPenalty * (p.depositQualityRunoffSensitivity ?? 0);
  const recessionRunoff = recession ? p.recessionDepositOutflowMultiplier ?? 1 : 1;

  const floor = p.multiplierFloor ?? 0.7;
  const cap = p.multiplierCap ?? 2.5;
  const depositOutflowMultiplier = clamp(
    lcrOutflowMultiplier * behaviouralRunoff * recessionRunoff,
    floor,
    cap
  );
  const inflowMultiplier = recession ? clamp(p.recessionInflowHaircut ?? 1, 0, 1) : 1;
  const qualityAsfHaircut = 1 - qualityPenalty * (p.depositQualityAsfPenalty ?? 0);
  const asfMultiplier = (recession ? clamp(p.recessionAsfPenalty ?? 1, 0, 1) : 1) * clamp(qualityAsfHaircut, 0.5, 1);

  return {
    depositOutflowMultiplier,
    inflowMultiplier,
    asfMultiplier,
  };
};

const computeFundingMaturityMetrics = (state: BankState): { fundingMaturing3m: number; fundingMaturing12m: number } => {
  const out = { fundingMaturing3m: 0, fundingMaturing12m: 0 };
  FUNDING_PRODUCTS.forEach((productType) => {
    const buckets = state.fundingLadders?.[productType] ?? [];
    buckets.forEach((bucket) => {
      const notional = Math.max(0, bucket.notional);
      if (bucket.monthsToMaturity <= 3) out.fundingMaturing3m += notional;
      if (bucket.monthsToMaturity <= 12) out.fundingMaturing12m += notional;
    });
  });
  return out;
};

const computeIrrbbSensitivities = (
  state: BankState,
  config: SimulationConfig
): { niiSensitivity100bp: number; eveSensitivity100bp: number } => {
  const irrbb = config.behaviour.irrbb;
  const assetDurationYears = Math.max(0.1, irrbb?.baseAssetDurationYears ?? 3);
  const liabilityDurationYears = Math.max(0.1, irrbb?.baseLiabilityDurationYears ?? 1.5);

  const assets = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);
  const liabilities = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Liability);
  const assetExposure = assets.reduce((sum, item) => sum + Math.max(0, item.balance), 0);
  const liabilityExposure = liabilities.reduce((sum, item) => sum + Math.max(0, item.balance), 0);

  const assetRepricingShare = clamp(1 / (1 + assetDurationYears), 0.05, 1);
  const liabilityRepricingShare = clamp(1 / (1 + liabilityDurationYears), 0.05, 1);

  const hedgeNiiOffset = (state.financial.hedges ?? []).reduce((sum, hedge) => {
    const sign = hedge.direction === 'payFixedReceiveFloat' ? 1 : -1;
    return sum + sign * hedge.notional;
  }, 0);
  const hedgeDurationOffset = (state.financial.hedges ?? []).reduce((sum, hedge) => {
    const hedgeDuration = Math.max(0.25, Math.min(5, hedge.monthsRemaining / 12));
    const sign = hedge.direction === 'payFixedReceiveFloat' ? -1 : 1;
    return sum + sign * hedge.notional * hedgeDuration;
  }, 0);

  const niiSensitivity100bp =
    (assetExposure * assetRepricingShare - liabilityExposure * liabilityRepricingShare + hedgeNiiOffset) * 0.01;
  const eveSensitivity100bp =
    -(
      assetExposure * assetDurationYears -
      liabilityExposure * liabilityDurationYears +
      hedgeDurationOffset
    ) * 0.01;

  return { niiSensitivity100bp, eveSensitivity100bp };
};

const CET1_GEOGRAPHY_FALLBACKS: LoanGeography[] = [
  'london',
  'south',
  'midlands',
  'north',
  'scotland',
  'wales',
  'northernIreland',
];

const inferFallbackSector = (productType: ProductType): LoanSector =>
  productType === AssetProductType.Mortgages ? 'retailMortgage' : 'largeCorporate';

const inferFallbackGeography = (cohortId: number): LoanGeography =>
  CET1_GEOGRAPHY_FALLBACKS[Math.abs(Math.floor(cohortId)) % CET1_GEOGRAPHY_FALLBACKS.length];

interface ConcentrationMetricSet {
  sectorConcentration: number;
  geographyConcentration: number;
  concentrationHhi: number;
}

const computeConcentrationMetrics = (state: BankState): ConcentrationMetricSet => {
  const sectorExposure: Partial<Record<LoanSector, number>> = {};
  const geographyExposure: Partial<Record<LoanGeography, number>> = {};
  let total = 0;

  const entries = Object.entries(state.loanCohorts ?? {}) as Array<
    [ProductType, Array<{ outstandingPrincipal: number; sector?: LoanSector; geography?: LoanGeography; cohortId: number }>]
  >;
  entries.forEach(([productType, cohorts]) => {
    if (!PRODUCT_META[productType]?.behaviour?.isLoan) return;
    (cohorts ?? []).forEach((cohort) => {
      const exposure = Math.max(0, cohort.outstandingPrincipal ?? 0);
      if (exposure <= 0) return;
      total += exposure;
      const sector = cohort.sector ?? inferFallbackSector(productType);
      const geography = cohort.geography ?? inferFallbackGeography(cohort.cohortId ?? 0);
      sectorExposure[sector] = (sectorExposure[sector] ?? 0) + exposure;
      geographyExposure[geography] = (geographyExposure[geography] ?? 0) + exposure;
    });
  });

  if (total <= 0) {
    return {
      sectorConcentration: 0,
      geographyConcentration: 0,
      concentrationHhi: 0,
    };
  }

  const sectorShares = Object.values(sectorExposure).map((value) => value / total);
  const geographyShares = Object.values(geographyExposure).map((value) => value / total);
  const sectorConcentration = sectorShares.length > 0 ? Math.max(...sectorShares) : 0;
  const geographyConcentration = geographyShares.length > 0 ? Math.max(...geographyShares) : 0;
  const concentrationHhi = sectorShares.reduce((sum, share) => sum + share * share, 0);

  return {
    sectorConcentration,
    geographyConcentration,
    concentrationHhi,
  };
};

const computeCet1Requirement = (limits: RiskLimits): number => {
  const stack = limits.capitalBufferStack;
  return (
    limits.minCet1Ratio +
    (stack?.conservationBuffer ?? 0) +
    (stack?.countercyclicalBuffer ?? 0) +
    (stack?.systemicBuffer ?? 0)
  );
};

const confidenceStateStressSignal = (state: FundingConfidenceState): number => {
  if (state === 'strong') return 0;
  if (state === 'stable') return 0.35;
  if (state === 'watch') return 0.8;
  return 1.2;
};

const confidenceThreshold = (raw: number | undefined, fallback: number): number =>
  Number.isFinite(raw) ? (raw as number) : fallback;

export const classifyFundingConfidenceState = (args: {
  fundingConfidenceScore: number;
  lcr: number;
  nsfr: number;
  cet1Headroom: number;
  config: SimulationConfig;
}): FundingConfidenceState => {
  const p = args.config.behaviour.confidenceStateMachine;
  const strongMinScore = confidenceThreshold(p?.strongMinScore, 0.8);
  const stableMinScore = confidenceThreshold(p?.stableMinScore, 0.6);
  const watchMinScore = confidenceThreshold(p?.watchMinScore, 0.4);

  const hardLcrWatch = confidenceThreshold(p?.hardLcrWatch, 1.02);
  const hardLcrStressed = confidenceThreshold(p?.hardLcrStressed, 0.92);
  const hardNsfrWatch = confidenceThreshold(p?.hardNsfrWatch, 1.0);
  const hardNsfrStressed = confidenceThreshold(p?.hardNsfrStressed, 0.94);
  const hardCet1HeadroomWatch = confidenceThreshold(p?.hardCet1HeadroomWatch, 0.005);
  const hardCet1HeadroomStressed = confidenceThreshold(p?.hardCet1HeadroomStressed, -0.005);

  let fromScore: FundingConfidenceState = 'stressed';
  if (args.fundingConfidenceScore >= strongMinScore) fromScore = 'strong';
  else if (args.fundingConfidenceScore >= stableMinScore) fromScore = 'stable';
  else if (args.fundingConfidenceScore >= watchMinScore) fromScore = 'watch';

  const stressedHardGate =
    args.lcr < hardLcrStressed ||
    args.nsfr < hardNsfrStressed ||
    args.cet1Headroom < hardCet1HeadroomStressed;
  if (stressedHardGate) return 'stressed';

  const watchHardGate =
    args.lcr < hardLcrWatch ||
    args.nsfr < hardNsfrWatch ||
    args.cet1Headroom < hardCet1HeadroomWatch;
  if (!watchHardGate) return fromScore;

  if (fromScore === 'strong' || fromScore === 'stable') return 'watch';
  return fromScore;
};

const computeInternalCapitalTarget = (args: {
  state: BankState;
  config: SimulationConfig;
  cet1Requirement: number;
  cet1Ratio: number;
  fundingStressIndex: number;
  fundingConfidenceState: FundingConfidenceState;
}): { internalCet1TargetRatio: number; internalCet1Headroom: number } => {
  const limits = args.config.riskLimits.capitalPolicy;
  const boardLimits = args.config.riskLimits.boardPressure;

  const baseBuffer = Math.max(0, limits.internalTargetBaseBuffer ?? 0);
  const volatilitySignal = clamp(
    (args.state.behaviour.earningsVolatility ?? 0) / Math.max(1, boardLimits.earningsVolatilityTolerance),
    0,
    3
  );
  const stressSignal = clamp(args.fundingStressIndex, 0, 2);
  const confidenceSignal = confidenceStateStressSignal(args.fundingConfidenceState);
  const conductSignal = clamp(args.state.behaviour.conductRiskScore ?? 0, 0, 2);

  const incrementalBuffer =
    volatilitySignal * Math.max(0, limits.internalTargetVolatilitySensitivity ?? 0) +
    stressSignal * Math.max(0, limits.internalTargetStressSensitivity ?? 0) +
    confidenceSignal * Math.max(0, limits.internalTargetConfidenceSensitivity ?? 0) +
    conductSignal * Math.max(0, limits.internalTargetConductSensitivity ?? 0);

  const maxBuffer = Math.max(baseBuffer, limits.internalTargetMaxBuffer ?? baseBuffer);
  const dynamicBuffer = clamp(baseBuffer + incrementalBuffer, baseBuffer, maxBuffer);
  const internalCet1TargetRatio = args.cet1Requirement + dynamicBuffer;
  const internalCet1Headroom = args.cet1Ratio - internalCet1TargetRatio;

  return {
    internalCet1TargetRatio,
    internalCet1Headroom,
  };
};

const computeBoardPressureMetrics = (
  state: BankState,
  limits: RiskLimits,
  config: SimulationConfig,
  cet1Headroom: number,
  maxPayoutRatio: number
): {
  boardPressureScore: number;
  boardPressureVolatility: number;
  boardPressureFranchiseGap: number;
  boardPressureRiskGap: number;
  boardPressurePayoutRestraint: number;
} => {
  const boardLimits = limits.boardPressure;
  const volatility = Math.max(0, state.behaviour.earningsVolatility ?? 0);
  const volatilityTolerance = Math.max(1, boardLimits.earningsVolatilityTolerance);
  const boardPressureVolatility = clamp(volatility / volatilityTolerance, 0, 3);

  const franchiseGap = Math.max(0, boardLimits.franchiseTarget - state.behaviour.depositFranchiseStrength);
  const boardPressureFranchiseGap = clamp(franchiseGap / 0.25, 0, 3);

  const riskGap = Math.max(0, boardLimits.riskAppetiteCet1Headroom - cet1Headroom);
  const boardPressureRiskGap = clamp(riskGap / Math.max(1e-4, boardLimits.riskAppetiteCet1Headroom), 0, 3);
  const boardPressurePayoutRestraint = clamp((1 - clamp(maxPayoutRatio, 0, 1)) * 3, 0, 3);

  const weights = config.behaviour.boardPressure ?? {
    volatilityWeight: 0.4,
    franchiseWeight: 0.3,
    riskWeight: 0.3,
    payoutRestraintWeight: 0.15,
  };
  const weightDenom = Math.max(
    1e-9,
    Math.abs(weights.volatilityWeight) +
      Math.abs(weights.franchiseWeight) +
      Math.abs(weights.riskWeight) +
      Math.abs(weights.payoutRestraintWeight ?? 0)
  );
  const weighted =
    (weights.volatilityWeight * boardPressureVolatility +
      weights.franchiseWeight * boardPressureFranchiseGap +
      weights.riskWeight * boardPressureRiskGap +
      (weights.payoutRestraintWeight ?? 0) * boardPressurePayoutRestraint) /
    weightDenom;
  const boardPressureScore = clamp((weighted / 3) * 100, 0, 100);

  return {
    boardPressureScore,
    boardPressureVolatility,
    boardPressureFranchiseGap,
    boardPressureRiskGap,
    boardPressurePayoutRestraint,
  };
};

const computeFundingConfidenceMetrics = (args: {
  state: BankState;
  cet1Ratio: number;
  cet1Requirement: number;
  lcr: number;
  nsfr: number;
  depositQualityIndex: number;
  asf: number;
  fundingMaturing12m: number;
}): { fundingStressIndex: number; fundingConfidenceScore: number } => {
  const liquidityStress = Math.max(0, 1.1 - Math.min(1.1, args.lcr)) / 1.1;
  const nsfrStress = Math.max(0, 1.05 - Math.min(1.05, args.nsfr)) / 1.05;
  const capitalStress = Math.max(0, args.cet1Requirement - args.cet1Ratio) / Math.max(1e-4, args.cet1Requirement);
  const franchiseStress =
    Math.max(0, 0.78 - clamp(args.state.behaviour.depositFranchiseStrength, 0, 1)) / 0.78;
  const qualityStress = Math.max(0, 0.9 - clamp(args.depositQualityIndex, 0, 1.1)) / 0.9;
  const maturityStress = Math.max(0, args.fundingMaturing12m / Math.max(1, args.asf) - 0.42);

  const fundingStressIndex =
    liquidityStress * 0.28 +
    nsfrStress * 0.2 +
    capitalStress * 0.2 +
    franchiseStress * 0.16 +
    qualityStress * 0.1 +
    maturityStress * 0.06;
  const fundingConfidenceScore = clamp(1 - fundingStressIndex, 0, 1);

  return { fundingStressIndex, fundingConfidenceScore };
};

export interface MetricsInput {
  state: BankState;
  config: SimulationConfig;
  lcrOutflowMultiplier?: number;
}

export const calculateRiskMetrics = ({
  state,
  config,
  lcrOutflowMultiplier = 1,
}: MetricsInput): RiskMetrics => {
  const assets = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);
  const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
  const baseRwa = assets.reduce((sum, a) => {
    const params = config.productParameters[a.productType];
    return sum + assetCreditRwa(state, config, a);
  }, 0);
  const rwaAddOns = config.riskLimits.rwaAddOns;
  const additionalRwa =
    Math.max(0, rwaAddOns?.operationalRisk ?? 0) +
    Math.max(0, rwaAddOns?.counterpartyRisk ?? 0) +
    Math.max(0, rwaAddOns?.otherAdjustments ?? 0);
  const commitmentRwa = Object.keys(state.loanPipelines ?? {}).reduce((sum, p) => sum + committedExposure(state, p as ProductType) * .2 * (config.productParameters[p as ProductType]?.riskWeight ?? 1), 0);
  const rwa = baseRwa + additionalRwa + commitmentRwa;
  const derivativeBook = assets.find(i=>i.productType===AssetProductType.DerivativeAssets)?.balance ?? 0;
  const leverageExposure = totalAssets - derivativeBook + hedgeExposures(state).leverage - centralBankExclusion(state) + committedExposure(state) * .2;
  const fvociInclusionRate = clamp(config.behaviour.securitiesAccounting?.fvociCet1InclusionRate ?? 1, 0, 1);
  const adjustedCet1 = state.financial.capital.cet1 + state.financial.capital.accumulatedOCI * fvociInclusionRate;
  const cet1Ratio = rwa > 0 ? adjustedCet1 / rwa : Infinity;
  const minima = ownFundsRequirements(config.riskLimits, rwa);
  const ownFundsCet1Floor = rwa > 0 ? Math.max(minima.cet1, minima.tier1 - state.financial.capital.at1 / rwa, minima.total - state.financial.capital.at1 / rwa) : minima.cet1;
  const cet1Requirement = computeCet1Requirement(config.riskLimits) + ownFundsCet1Floor - config.riskLimits.minCet1Ratio;
  const praBufferTarget = cet1Requirement + Math.max(0, config.riskLimits.praBufferRatio ?? 0);
  const cet1Headroom = cet1Ratio - cet1Requirement;
  const leverageRatio =
    leverageExposure > 0
      ? (adjustedCet1 + state.financial.capital.at1) / leverageExposure
      : Infinity;

  const hqla = computeHqla(assets);
  const depositQualityIndex = computeDepositQualityIndex(state);
  const liquidityFactors = computeLiquidityDynamicsFactors(
    state,
    config,
    lcrOutflowMultiplier,
    depositQualityIndex
  );
  const lines = prudentialLiquidityLines(state, config);
  const commitments = commitmentLiquidity(state);
  const inflows = lines.reduce((sum, l) => sum + l.inflow, 0);
  const outflows = lines.reduce((sum, l) => sum + l.outflow, commitments.outflow);
  const net = outflows - Math.min(inflows, outflows * .75);
  const lcr = net > 0 ? hqla / net : Infinity;
  const asf = adjustedCet1 + state.financial.capital.at1 + lines.reduce((sum, l) => sum + l.asf, 0);
  const rsf = lines.reduce((sum, l) => sum + l.rsf, commitments.rsf);
  const nsfr = rsf > 0 ? asf / rsf : Infinity;
  const stressOut = lines.reduce((sum, l) => sum + l.outflow * (isCustomerDeposit(l.productType) ? liquidityFactors.depositOutflowMultiplier : 1), commitments.outflow);
  const stressNet = stressOut - Math.min(inflows * liquidityFactors.inflowMultiplier, stressOut * .75);
  const managementLcr = stressNet > 0 ? hqla / stressNet : Infinity;
  const stressAsf = adjustedCet1 + state.financial.capital.at1 + lines.reduce((sum, l) => sum + l.asf * (isCustomerDeposit(l.productType) ? liquidityFactors.asfMultiplier : 1), 0);
  const managementNsfr = rsf > 0 ? stressAsf / rsf : Infinity;
  const { niiSensitivity100bp, eveSensitivity100bp } = computeIrrbbSensitivities(state, config);
  const { fundingMaturing3m, fundingMaturing12m } = computeFundingMaturityMetrics(state);
  const { fundingStressIndex, fundingConfidenceScore } = computeFundingConfidenceMetrics({
    state,
    cet1Ratio,
    cet1Requirement,
    lcr: managementLcr,
    nsfr: managementNsfr,
    depositQualityIndex,
    asf,
    fundingMaturing12m,
  });
  const inferredConfidenceState = classifyFundingConfidenceState({
    fundingConfidenceScore,
    lcr,
    nsfr,
    cet1Headroom,
    config,
  });
  const fundingConfidenceState = state.behaviour.fundingConfidenceState ?? inferredConfidenceState;
  const conductRiskScore = clamp(state.behaviour.conductRiskScore ?? 0, 0, 2);
  const capPolicy = config.riskLimits.capitalPolicy;
  const { internalCet1TargetRatio, internalCet1Headroom } = computeInternalCapitalTarget({
    state,
    config,
    cet1Requirement: praBufferTarget,
    cet1Ratio,
    fundingStressIndex,
    fundingConfidenceState,
  });

  const { sectorConcentration, geographyConcentration, concentrationHhi } = computeConcentrationMetrics(state);
  const mdaTriggered = cet1Ratio < cet1Requirement;
  // Conservative bank policy: suspend all distributions inside buffers. This is
  // not the PRA's MDA amount, which needs four-quarter profits and notifications.
  const regulatoryMaxPayoutRatio = mdaTriggered ? 0 : 1;
  const payoutRestrictionSlope = Math.max(1e-4, capPolicy.payoutRestrictionSlope ?? 0.04);
  const internalMaxPayoutRatio =
    internalCet1Headroom >= 0 ? 1 : clamp(1 + internalCet1Headroom / payoutRestrictionSlope, 0, 1);
  const maxPayoutRatio = Math.min(regulatoryMaxPayoutRatio, internalMaxPayoutRatio);
  const payoutBlockedByInternalTarget =
    internalMaxPayoutRatio + 1e-9 < 1 && regulatoryMaxPayoutRatio >= 1 - 1e-9;
  const {
    boardPressureScore,
    boardPressureVolatility,
    boardPressureFranchiseGap,
    boardPressureRiskGap,
    boardPressurePayoutRestraint,
  } = computeBoardPressureMetrics(state, config.riskLimits, config, cet1Headroom, maxPayoutRatio);

  return {
    rwa,
    leverageExposure,
    cet1Ratio,
    cet1Requirement,
    minimumCet1Ratio: minima.cet1, minimumTier1Ratio: minima.tier1, minimumTotalCapitalRatio: minima.total,
    praBufferTarget, praBufferBreached: cet1Ratio < praBufferTarget,
    cet1Headroom,
    leverageRatio,
    hqla,
    lcr,
    lcrOutflowMultiplier: 1,
    managementLcr,
    managementNsfr,
    tier1Ratio: rwa > 0 ? (adjustedCet1 + state.financial.capital.at1) / rwa : Infinity,
    totalCapitalRatio: rwa > 0 ? (adjustedCet1 + state.financial.capital.at1) / rwa : Infinity,
    depositQualityIndex,
    asf,
    rsf,
    nsfr,
    fundingStressIndex,
    fundingConfidenceScore,
    fundingConfidenceState,
    internalCet1TargetRatio,
    internalCet1Headroom,
    payoutBlockedByInternalTarget,
    conductRiskScore,
    niiSensitivity100bp,
    eveSensitivity100bp,
    fundingMaturing3m,
    fundingMaturing12m,
    mdaTriggered,
    maxPayoutRatio,
    sectorConcentration,
    geographyConcentration,
    concentrationHhi,
    boardPressureScore,
    boardPressureVolatility,
    boardPressureFranchiseGap,
    boardPressureRiskGap,
    boardPressurePayoutRestraint,
  };
};

export const evaluateCompliance = (metrics: RiskMetrics, limits: RiskLimits): ComplianceStatus => ({
  cet1Breached: !(metrics.cet1Ratio >= ownFundsRequirements(limits, metrics.rwa).cet1),
  ownFundsBreached: !(metrics.tier1Ratio === undefined || metrics.tier1Ratio >= ownFundsRequirements(limits, metrics.rwa).tier1) || !(metrics.totalCapitalRatio === undefined || metrics.totalCapitalRatio >= ownFundsRequirements(limits, metrics.rwa).total),
  leverageBreached: !(metrics.leverageRatio >= limits.minLeverageRatio),
  lcrBreached: !(metrics.lcr >= limits.minLcr),
  nsfrBreached: !(metrics.nsfr >= limits.minNsfr),
  concentrationBreached:
    metrics.sectorConcentration > limits.concentration.maxSingleSectorShare ||
    metrics.geographyConcentration > limits.concentration.maxSingleGeographyShare,
  mdaTriggered: metrics.mdaTriggered,
});
