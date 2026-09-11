import type {
  FundingMarketAssessment,
  FundingMarketDriverEffect,
  FundingMarketDriverKey,
  FundingMarketModel,
} from '../domain/fundingMarket';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const lowerIsWorse = (value: number, neutral: number, scale: number): number =>
  clamp((neutral - value) / Math.max(1e-9, scale), 0, 1.5);

const higherIsWorse = (value: number, neutral: number, scale: number): number =>
  clamp((value - neutral) / Math.max(1e-9, scale), 0, 1.5);

const weighted = (...terms: Array<[number, number]>): number =>
  terms.reduce((sum, [value, weight]) => sum + value * weight, 0);

const effect = (
  key: FundingMarketDriverKey,
  severity: number,
  spreadBps: number,
  capacityMultiplier: number,
  observations: Record<string, number>
): FundingMarketDriverEffect => ({
  key,
  severity,
  spreadBps: Math.max(0, spreadBps),
  capacityMultiplier: clamp(capacityMultiplier, 0.05, 1),
  observations,
});

/**
 * Calibration is intentionally expressed in observable banking measures.  It is
 * exported so tests, scenarios and future UX can explain exactly where market
 * pricing and capacity come from rather than treating the result as a confidence score.
 */
export const FUNDING_MARKET_CALIBRATION = {
  neutral: {
    cet1Headroom: 0.025,
    leverageHeadroom: 0.0125,
    lcr: 1.25,
    nsfr: 1.08,
    wholesaleFundingRatio: 0.20,
    wholesaleFundingMaturing12mRatio: 0.08,
    depositFranchiseStrength: 0.70,
    stage2Share: 0.12,
    stage3Share: 0.025,
    annualisedRoa: 0.005,
    marketSeniorSpreadBps: 140,
  },
  scale: {
    cet1Headroom: 0.04,
    leverageHeadroom: 0.02,
    lcr: 0.50,
    nsfr: 0.25,
    wholesaleFundingRatio: 0.40,
    wholesaleFundingMaturing12mRatio: 0.25,
    depositFranchiseStrength: 0.50,
    stage2Share: 0.30,
    stage3Share: 0.10,
    annualisedRoa: 0.02,
    marketSeniorSpreadBps: 400,
  },
  spreadPenaltyBps: {
    capital: 90,
    liquidity: 70,
    fundingStructure: 80,
    assetQuality: 120,
    earnings: 70,
    recentIssuance: 180,
  },
  capacityPenalty: {
    market: 0.45,
    capital: 0.55,
    liquidity: 0.45,
    fundingStructure: 0.35,
    assetQuality: 0.50,
    earnings: 0.25,
  },
  minimumCapacityFactor: 0.05,
  minimumViableIssueAmount: 50e6,
} as const;

const tenorCapacityMultiplier = (
  model: FundingMarketModel,
  tenorMonths: number | undefined,
  baseCapacityMultiplier: number
): number => {
  const defaultTenor = model.instrument.defaultTenorMonths;
  if (tenorMonths === undefined || defaultTenor === undefined || tenorMonths <= defaultTenor) return 1;
  const extraYears = (tenorMonths - defaultTenor) / 12;
  const issuerStress = clamp(1 - baseCapacityMultiplier, 0, 1);
  return clamp(1 / (1 + extraYears * (0.04 + issuerStress * 0.10)), 0.35, 1);
};

const maximumAvailableTenor = (
  model: FundingMarketModel,
  baseCapacityMultiplier: number
): number | undefined => {
  const permitted = model.instrument.permittedTenorMonths;
  if (!permitted?.length) return model.requestedTenorMonths ?? model.instrument.defaultTenorMonths;

  const baseCapacity =
    Math.max(0, model.referenceAmount) *
    Math.max(0, model.instrument.baseCapacityMultiple) *
    baseCapacityMultiplier;
  const minimumViable = Math.min(
    FUNDING_MARKET_CALIBRATION.minimumViableIssueAmount,
    Math.max(5e6, Math.max(0, model.referenceAmount) * Math.max(0, model.instrument.baseCapacityMultiple) * 0.15)
  );

  const sorted = [...permitted].sort((a, b) => a - b);
  let maxAvailable: number | undefined;
  sorted.forEach((tenor) => {
    const capacity =
      baseCapacity *
      tenorCapacityMultiplier(model, tenor, baseCapacityMultiplier) *
      Math.max(1, model.instrument.hardCapacityMultiple);
    if (capacity >= minimumViable) maxAvailable = tenor;
  });
  return maxAvailable;
};

export const calculateFundingMarket = (model: FundingMarketModel): FundingMarketAssessment => {
  const f = model.fundamentals;
  const c = FUNDING_MARKET_CALIBRATION;
  const sensitivity = Math.max(0.25, model.instrument.spreadSensitivity);

  const capitalSeverity = weighted(
    [lowerIsWorse(f.cet1Headroom, c.neutral.cet1Headroom, c.scale.cet1Headroom), 0.7],
    [lowerIsWorse(f.leverageHeadroom, c.neutral.leverageHeadroom, c.scale.leverageHeadroom), 0.3]
  );
  const liquiditySeverity = weighted(
    [lowerIsWorse(f.lcr, c.neutral.lcr, c.scale.lcr), 0.6],
    [lowerIsWorse(f.nsfr, c.neutral.nsfr, c.scale.nsfr), 0.4]
  );
  const fundingStructureSeverity = weighted(
    [higherIsWorse(f.wholesaleFundingRatio, c.neutral.wholesaleFundingRatio, c.scale.wholesaleFundingRatio), 0.35],
    [
      higherIsWorse(
        f.wholesaleFundingMaturing12mRatio,
        c.neutral.wholesaleFundingMaturing12mRatio,
        c.scale.wholesaleFundingMaturing12mRatio
      ),
      0.4,
    ],
    [
      lowerIsWorse(
        f.depositFranchiseStrength,
        c.neutral.depositFranchiseStrength,
        c.scale.depositFranchiseStrength
      ),
      0.25,
    ]
  );
  const assetQualitySeverity = weighted(
    [higherIsWorse(f.stage2Share, c.neutral.stage2Share, c.scale.stage2Share), 0.35],
    [higherIsWorse(f.stage3Share, c.neutral.stage3Share, c.scale.stage3Share), 0.65]
  );
  const earningsSeverity = f.annualisedRoa === undefined
    ? 0
    : lowerIsWorse(f.annualisedRoa, c.neutral.annualisedRoa, c.scale.annualisedRoa);
  const marketSeverity = higherIsWorse(
    f.marketSeniorSpreadBps,
    c.neutral.marketSeniorSpreadBps,
    c.scale.marketSeniorSpreadBps
  );
  const recentIssuanceSeverity = clamp(model.recentIssuanceRatio, 0, 2);

  const marketEffect = effect(
    'market',
    marketSeverity,
    Math.max(0, f.marketSeniorSpreadBps) * sensitivity,
    1 - marketSeverity * c.capacityPenalty.market * sensitivity,
    { marketSeniorSpreadBps: f.marketSeniorSpreadBps }
  );
  const capitalEffect = effect(
    'capital',
    capitalSeverity,
    capitalSeverity * c.spreadPenaltyBps.capital * sensitivity,
    1 - capitalSeverity * c.capacityPenalty.capital * sensitivity,
    { cet1Headroom: f.cet1Headroom, leverageHeadroom: f.leverageHeadroom }
  );
  const liquidityEffect = effect(
    'liquidity',
    liquiditySeverity,
    liquiditySeverity * c.spreadPenaltyBps.liquidity * sensitivity,
    1 - liquiditySeverity * c.capacityPenalty.liquidity * sensitivity,
    { lcr: f.lcr, nsfr: f.nsfr }
  );
  const fundingStructureEffect = effect(
    'fundingStructure',
    fundingStructureSeverity,
    fundingStructureSeverity * c.spreadPenaltyBps.fundingStructure * sensitivity,
    1 - fundingStructureSeverity * c.capacityPenalty.fundingStructure * sensitivity,
    {
      wholesaleFundingRatio: f.wholesaleFundingRatio,
      wholesaleFundingMaturing12mRatio: f.wholesaleFundingMaturing12mRatio,
      depositFranchiseStrength: f.depositFranchiseStrength,
    }
  );
  const assetQualityEffect = effect(
    'assetQuality',
    assetQualitySeverity,
    assetQualitySeverity * c.spreadPenaltyBps.assetQuality * sensitivity,
    1 - assetQualitySeverity * c.capacityPenalty.assetQuality * sensitivity,
    { stage2Share: f.stage2Share, stage3Share: f.stage3Share }
  );
  const earningsEffect = effect(
    'earnings',
    earningsSeverity,
    earningsSeverity * c.spreadPenaltyBps.earnings * sensitivity,
    1 - earningsSeverity * c.capacityPenalty.earnings * sensitivity,
    f.annualisedRoa === undefined ? {} : { annualisedRoa: f.annualisedRoa }
  );
  const recentIssuanceEffect = effect(
    'recentIssuance',
    recentIssuanceSeverity,
    recentIssuanceSeverity * c.spreadPenaltyBps.recentIssuance * sensitivity,
    1 / (1 + recentIssuanceSeverity * 1.75 * sensitivity),
    { recentIssuanceRatio: recentIssuanceSeverity }
  );
  const instrumentEffect = effect(
    'instrument',
    0,
    Math.max(0, model.instrument.basePremiumBps) + Math.max(0, model.instrument.newIssueConcessionBps),
    1,
    {
      basePremiumBps: model.instrument.basePremiumBps,
      newIssueConcessionBps: model.instrument.newIssueConcessionBps,
    }
  );

  const baseDrivers = [
    marketEffect,
    capitalEffect,
    liquidityEffect,
    fundingStructureEffect,
    assetQualityEffect,
    earningsEffect,
    recentIssuanceEffect,
    instrumentEffect,
  ];
  const baseCapacityMultiplier = clamp(
    baseDrivers.reduce((product, driver) => product * driver.capacityMultiplier, 1),
    c.minimumCapacityFactor,
    1
  );

  const maxTenorMonths = maximumAvailableTenor(model, baseCapacityMultiplier);
  const requestedTenorMonths = model.requestedTenorMonths ?? model.instrument.defaultTenorMonths;
  const tenorAvailable = requestedTenorMonths === undefined || maxTenorMonths === undefined || requestedTenorMonths <= maxTenorMonths;
  const extraTenorYears = requestedTenorMonths !== undefined && model.instrument.defaultTenorMonths !== undefined
    ? Math.max(0, requestedTenorMonths - model.instrument.defaultTenorMonths) / 12
    : 0;
  const tenorEffect = effect(
    'tenor',
    extraTenorYears,
    extraTenorYears * Math.max(0, model.instrument.tenorSpreadBpsPerYear),
    tenorCapacityMultiplier(model, requestedTenorMonths, baseCapacityMultiplier),
    requestedTenorMonths === undefined ? {} : { requestedTenorMonths }
  );

  const drivers = [...baseDrivers, tenorEffect];
  const capacityMultiplier = clamp(
    baseCapacityMultiplier * tenorEffect.capacityMultiplier,
    c.minimumCapacityFactor,
    1
  );
  const fairSpreadBps = drivers.reduce((sum, driver) => sum + driver.spreadBps, 0);
  const capacityAtFairSpread = tenorAvailable
    ? Math.max(0, model.referenceAmount) * Math.max(0, model.instrument.baseCapacityMultiple) * capacityMultiplier
    : 0;
  const hardCapacity = capacityAtFairSpread * Math.max(1, model.instrument.hardCapacityMultiple);
  const slope = Math.max(1, model.instrument.demandSlopeBps);

  const demandAtPrice = !tenorAvailable
    ? 0
    : model.maxSpreadBps === undefined
      ? hardCapacity
      : model.maxSpreadBps + 1e-9 < fairSpreadBps
        ? 0
        : Math.min(
          hardCapacity,
          capacityAtFairSpread * (1 + Math.max(0, model.maxSpreadBps - fairSpreadBps) / slope)
        );

  const executableAmount = Math.min(Math.max(0, model.targetAmount), demandAtPrice);
  const clearingSpreadBps = capacityAtFairSpread <= 1e-9 || executableAmount <= capacityAtFairSpread
    ? fairSpreadBps
    : fairSpreadBps + slope * (executableAmount / capacityAtFairSpread - 1);

  const baselineSpread =
    marketEffect.spreadBps + instrumentEffect.spreadBps + tenorEffect.spreadBps;
  const endogenousPenalty = Math.max(0, fairSpreadBps - baselineSpread);
  const status: FundingMarketAssessment['status'] = !tenorAvailable || hardCapacity <= 1e-6
    ? 'closed'
    : capacityMultiplier < 0.30
      ? 'restricted'
      : capacityMultiplier < 0.70 || endogenousPenalty >= 100
        ? 'open-expensive'
        : 'open';

  return {
    status,
    fundamentals: f,
    drivers,
    fairSpreadBps,
    clearingSpreadBps,
    capacityAtFairSpread,
    hardCapacity,
    demandAtPrice,
    maxTenorMonths,
    requestedTenorMonths,
    tenorAvailable,
    capacityMultiplier,
  };
};
