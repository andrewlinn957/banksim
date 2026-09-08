import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType, ProductType } from '../domain/enums';
import { LoanCohort, LoanGeography, LoanSector } from '../domain/loanCohorts';
import { Pillar2AAssessmentState } from '../domain/risks';
import { regulatoryRiskWeight } from '../products/regulatory';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const performing = (cohort: LoanCohort): boolean => cohort.stage !== 'stage3' && cohort.outstandingPrincipal > 0;

const mortgageBenchmarkRiskWeight = (ltv: number): number => {
  const x = Math.max(0, ltv);
  // PRA Table A2: credit-risk IRB benchmark excluding expected losses.
  if (x < 0.50) return 0.045;
  if (x < 0.60) return 0.077;
  if (x < 0.70) return 0.097;
  if (x < 0.80) return 0.139;
  if (x < 0.90) return 0.187;
  if (x < 1.00) return 0.264;
  return 0.410;
};

export const pillar2ACreditBenchmarkRiskWeight = (
  productType: ProductType,
  cohort: LoanCohort,
  state: BankState
): number => {
  if (productType === AssetProductType.Mortgages) {
    return mortgageBenchmarkRiskWeight(cohort.ltv ?? state.behaviour.mortgagePolicy?.maxLtv ?? 0.85);
  }
  if (productType === AssetProductType.ConsumerLoans) return 0.775; // Table A2 personal loans.
  if (productType === AssetProductType.CorporateLoans) {
    // BankSim's corporate book is primarily SME/business lending. Large-corporate cohorts use
    // the published large-corporate benchmark; the remaining corporate cohorts use SME.
    return cohort.sector === 'largeCorporate' ? 0.463 : 0.598;
  }
  return regulatoryRiskWeight(productType);
};

const mapPillar2Sector = (sector: LoanSector | undefined): string => {
  if (sector === 'commercialRealEstate') return 'commercialRealEstate';
  if (sector === 'largeCorporate') return 'manufacturing';
  if (sector === 'other') return 'wholesaleRetailTrade';
  return 'servicesOther';
};

const mapPillar2Geography = (geography: LoanGeography | undefined): string => {
  // BankSim currently models a domestic UK bank. Its existing geography labels are UK regions,
  // so they all map to the PRA's UK international-geography bucket.
  void geography;
  return 'uk';
};

const hhi = (weights: number[]): number => {
  const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return 0;
  return weights.reduce((sum, value) => {
    const share = Math.max(0, value) / total;
    return sum + share * share;
  }, 0);
};

const sectorAddOnRate = (value: number, dominantSector: string | undefined): number => {
  if (value <= 0.111) return 0;
  if (value <= 0.203) return 0.00125;
  if (value <= 0.258) return 0.00375;
  if (value <= 0.417) return 0.0075;
  if (value <= 0.674) return 0.0125;
  // Figure 1 gives a 2.8% upper endpoint for CRE and 2% for financials. BankSim has no
  // separate financial-sector corporate product, so non-CRE top-bucket exposures use 2%.
  return dominantSector === 'commercialRealEstate' ? 0.0215 : 0.0175;
};

const geographicAddOnRate = (value: number): number => {
  if (value <= 0.111) return 0;
  if (value <= 0.249) return 0.001;
  if (value <= 0.345) return 0.0035;
  if (value <= 0.478) return 0.0065;
  if (value <= 0.779) return 0.01025;
  return 0.01325;
};

const singleNameAddOnRate = (value: number): number => {
  if (value <= 0) return 0;
  if (value <= 0.0029) return 0.0025;
  if (value <= 0.0059) return 0.0075;
  if (value <= 0.0115) return 0.015;
  if (value <= 0.0165) return 0.025;
  return 0.035;
};

export const concentrationAddOnRate = (
  type: 'singleName' | 'sector' | 'geographic',
  value: number,
  dominantSector?: string
): number => {
  if (type === 'singleName') return singleNameAddOnRate(value);
  if (type === 'sector') return sectorAddOnRate(value, dominantSector);
  return geographicAddOnRate(value);
};

const loanEntries = (state: BankState): Array<[ProductType, LoanCohort[]]> =>
  Object.entries(state.loanCohorts ?? {}) as Array<[ProductType, LoanCohort[]]>;

export const calculatePillar2ACreditRisk = (state: BankState) => {
  let benchmarkRwa = 0;
  let pillar1CreditRwa = 0;
  for (const [productType, cohorts] of loanEntries(state)) {
    for (const cohort of cohorts ?? []) {
      if (!performing(cohort)) continue;
      const exposure = Math.max(0, cohort.outstandingPrincipal);
      pillar1CreditRwa += exposure * regulatoryRiskWeight(productType);
      benchmarkRwa += exposure * pillar2ACreditBenchmarkRiskWeight(productType, cohort, state);
    }
  }
  const shortfallRwa = Math.max(0, benchmarkRwa - pillar1CreditRwa);
  return {
    benchmarkRwa,
    pillar1CreditRwa,
    shortfallRwa,
    capital: shortfallRwa * 0.08,
  };
};

export const calculatePillar2AConcentration = (state: BankState, config: SimulationConfig) => {
  const wholesale = state.loanCohorts?.[AssetProductType.CorporateLoans] ?? [];
  const typicalObligorExposure = Math.max(
    1,
    config.riskLimits.pillar2A?.typicalWholesaleObligorExposure ?? 5e6
  );

  const sectorRwa = new Map<string, number>();
  let wholesaleRwa = 0;
  let singleNameHhi = 0;
  const wholesaleParts: Array<{ rwa: number; obligors: number }> = [];

  for (const cohort of wholesale) {
    if (!performing(cohort)) continue;
    const rwa = Math.max(0, cohort.outstandingPrincipal) * regulatoryRiskWeight(AssetProductType.CorporateLoans);
    if (rwa <= 0) continue;
    wholesaleRwa += rwa;
    const sector = mapPillar2Sector(cohort.sector);
    sectorRwa.set(sector, (sectorRwa.get(sector) ?? 0) + rwa);
    const obligors = Math.max(1, Math.ceil(cohort.outstandingPrincipal / typicalObligorExposure));
    wholesaleParts.push({ rwa, obligors });
  }

  if (wholesaleRwa > 0) {
    singleNameHhi = wholesaleParts.reduce((sum, part) => {
      const cohortShare = part.rwa / wholesaleRwa;
      return sum + (cohortShare * cohortShare) / part.obligors;
    }, 0);
  }

  const sectorWeights = [...sectorRwa.values()];
  const sectorHhi = hhi(sectorWeights);
  const dominantSector = [...sectorRwa.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // PRA geographic concentration excludes SA residential mortgages. Consumer and corporate
  // credit are included here; all current BankSim geographic labels are domestic UK regions.
  const geographyRwa = new Map<string, number>();
  for (const productType of [AssetProductType.ConsumerLoans, AssetProductType.CorporateLoans]) {
    for (const cohort of state.loanCohorts?.[productType] ?? []) {
      if (!performing(cohort)) continue;
      const rwa = Math.max(0, cohort.outstandingPrincipal) * regulatoryRiskWeight(productType);
      const geography = mapPillar2Geography(cohort.geography);
      geographyRwa.set(geography, (geographyRwa.get(geography) ?? 0) + rwa);
    }
  }
  const geographicPortfolioRwa = [...geographyRwa.values()].reduce((sum, value) => sum + value, 0);
  const geographicHhi = hhi([...geographyRwa.values()]);

  const singleNameRate = concentrationAddOnRate('singleName', singleNameHhi);
  const sectorRate = concentrationAddOnRate('sector', sectorHhi, dominantSector);
  const geographicRate = concentrationAddOnRate('geographic', geographicHhi);

  return {
    singleNameHhi,
    sectorHhi,
    geographicHhi,
    wholesaleRwa,
    geographicPortfolioRwa,
    dominantSector,
    singleNameRate,
    sectorRate,
    geographicRate,
    singleNameCapital: wholesaleRwa * singleNameRate,
    sectorCapital: wholesaleRwa * sectorRate,
    geographicCapital: geographicPortfolioRwa * geographicRate,
  };
};

export const calculatePillar2AIrrbb = (
  state: BankState,
  config: SimulationConfig,
  eveSensitivity100bp: number
) => {
  const worstLoss200bp = Math.abs(eveSensitivity100bp) * 2;
  const policyLimit = Math.max(
    0,
    state.behaviour.riskAppetite?.irrbbEveLimit ??
      config.riskLimits.pillar2A?.defaultIrrbbEveLimit ??
      250e6
  );
  // The PRA says the smaller-firm standard methodology commonly uses a policy limit based on a
  // 200bp economic-value shock, but it does not publish a simple conversion from that limit to a
  // capital amount. BankSim therefore applies an explicit, configurable supervisory scalar.
  const capitalConversionFactor = clamp(
    config.riskLimits.pillar2A?.irrbbCapitalConversionFactor ?? 0.2,
    0,
    1
  );
  const riskMeasure = Math.max(worstLoss200bp, policyLimit);
  return {
    worstLoss200bp,
    policyLimit,
    capitalConversionFactor,
    riskMeasure,
    capital: riskMeasure * capitalConversionFactor,
  };
};

const calculateUkCcybPassThrough = (state: BankState): { ukCreditRwa: number; totalCreditRwa: number; rate: number } => {
  let totalCreditRwa = 0;
  let ukCreditRwa = 0;
  for (const [productType, cohorts] of loanEntries(state)) {
    for (const cohort of cohorts ?? []) {
      if (!performing(cohort)) continue;
      const rwa = Math.max(0, cohort.outstandingPrincipal) * regulatoryRiskWeight(productType);
      totalCreditRwa += rwa;
      // Current BankSim products and cohort geographies are UK domestic. Keep the calculation
      // explicit so international products can later supply a non-UK mapping without changing PS15/20.
      ukCreditRwa += rwa;
    }
  }
  return {
    ukCreditRwa,
    totalCreditRwa,
    rate: totalCreditRwa > 0 ? clamp(ukCreditRwa / totalCreditRwa, 0, 1) : 0,
  };
};

export const applyPs1520Offset = (args: {
  grossRate: number;
  ukPassThroughRate: number;
  structuralCcybIncrease?: number;
  initialOffsetShare?: number;
  additionalOffsetShare?: number;
  additionalFloor?: number;
  lowRiskEligible?: boolean;
  mrelEqualsTcr?: boolean;
}) => {
  const grossRate = Math.max(0, args.grossRate);
  const passThrough = clamp(args.ukPassThroughRate, 0, 1);
  const structuralIncrease = Math.max(0, args.structuralCcybIncrease ?? 0.01);
  const initialPotential = structuralIncrease * clamp(args.initialOffsetShare ?? 0.5, 0, 1) * passThrough;
  const afterInitial = Math.max(0, grossRate - initialPotential);
  const initialOffsetRate = grossRate - afterInitial;

  const lowRiskEligible = args.lowRiskEligible ?? true;
  const mrelEqualsTcr = args.mrelEqualsTcr ?? true;
  const additionalFloor = Math.max(0, args.additionalFloor ?? 0.01);
  const additionalPotential =
    lowRiskEligible && mrelEqualsTcr
      ? structuralIncrease * clamp(args.additionalOffsetShare ?? 0.5, 0, 1) * passThrough
      : 0;
  const additionalOffsetRate = Math.min(
    additionalPotential,
    Math.max(0, afterInitial - additionalFloor)
  );

  return {
    initialOffsetRate,
    additionalOffsetRate,
    finalRate: Math.max(0, afterInitial - additionalOffsetRate),
    lowRiskEligible,
    mrelEqualsTcr,
  };
};

const advanceMonths = (raw: Date, months: number): string => {
  const date = new Date(raw);
  date.setUTCMonth(date.getUTCMonth() + Math.max(0, Math.round(months)));
  return date.toISOString();
};

export const assessPillar2A = (args: {
  state: BankState;
  config: SimulationConfig;
  rwa: number;
  eveSensitivity100bp: number;
  assessmentStep?: number;
}): Pillar2AAssessmentState => {
  const { state, config } = args;
  const credit = calculatePillar2ACreditRisk(state);
  const concentration = calculatePillar2AConcentration(state, config);
  const irrbb = calculatePillar2AIrrbb(state, config, args.eveSensitivity100bp);
  const components = {
    creditRisk: credit.capital,
    singleNameConcentration: concentration.singleNameCapital,
    sectorConcentration: concentration.sectorCapital,
    geographicConcentration: concentration.geographicCapital,
    irrbb: irrbb.capital,
  };
  const grossAmount = Object.values(components).reduce((sum, value) => sum + value, 0);
  const assessmentRwa = Math.max(0, args.rwa);
  const grossRate = assessmentRwa > 0 ? grossAmount / assessmentRwa : 0;
  const uk = calculateUkCcybPassThrough(state);
  const policy = config.riskLimits.pillar2A;
  const offset = applyPs1520Offset({
    grossRate,
    ukPassThroughRate: uk.rate,
    structuralCcybIncrease: policy?.structuralCcybIncrease,
    initialOffsetShare: policy?.initialOffsetShare,
    additionalOffsetShare: policy?.additionalOffsetShare,
    additionalFloor: policy?.additionalFloor,
    lowRiskEligible: policy?.lowRiskSmallBankEligible,
    mrelEqualsTcr: policy?.mrelEqualsTcr,
  });
  const assessmentStep = Math.max(0, args.assessmentStep ?? state.time.step);
  const interval = Math.max(1, Math.round(policy?.assessmentIntervalMonths ?? 24));
  const monthsAhead = Math.max(0, assessmentStep - state.time.step);

  return {
    assessedRate: offset.finalRate,
    grossRate,
    assessmentRwa,
    assessmentStep,
    assessmentDate: advanceMonths(state.time.date, monthsAhead),
    nextAssessmentStep: assessmentStep + interval,
    components,
    creditRisk: {
      benchmarkRwa: credit.benchmarkRwa,
      pillar1CreditRwa: credit.pillar1CreditRwa,
      shortfallRwa: credit.shortfallRwa,
    },
    concentration: {
      singleNameHhi: concentration.singleNameHhi,
      sectorHhi: concentration.sectorHhi,
      geographicHhi: concentration.geographicHhi,
      wholesaleRwa: concentration.wholesaleRwa,
      geographicPortfolioRwa: concentration.geographicPortfolioRwa,
    },
    irrbb: {
      worstLoss200bp: irrbb.worstLoss200bp,
      policyLimit: irrbb.policyLimit,
      capitalConversionFactor: irrbb.capitalConversionFactor,
      assessedAmount: irrbb.capital,
    },
    ps1520: {
      ukCcybPassThroughRate: uk.rate,
      initialOffsetRate: offset.initialOffsetRate,
      additionalOffsetRate: offset.additionalOffsetRate,
      lowRiskEligible: offset.lowRiskEligible,
      mrelEqualsTcr: offset.mrelEqualsTcr,
    },
  };
};

export const pillar2AAssessmentForMetrics = (args: {
  state: BankState;
  config: SimulationConfig;
  rwa: number;
  eveSensitivity100bp: number;
}): Pillar2AAssessmentState =>
  args.state.risk.pillar2A ??
  assessPillar2A({ ...args, assessmentStep: args.state.time.step });

export const initializeOpeningPillar2AAssessment = (args: {
  state: BankState;
  config: SimulationConfig;
  rwa: number;
  eveSensitivity100bp: number;
}): Pillar2AAssessmentState => {
  const assessment = assessPillar2A({ ...args, assessmentStep: args.state.time.step });
  args.state.risk.pillar2A = assessment;
  return assessment;
};

/** Advance the frozen SREP assessment only as part of a completed month close. */
export const advancePillar2AAssessmentAtClose = (args: {
  state: BankState;
  config: SimulationConfig;
  rwa: number;
  eveSensitivity100bp: number;
}): Pillar2AAssessmentState => {
  const existing = args.state.risk.pillar2A;
  const closingStep = args.state.time.step + 1;
  if (!existing || closingStep >= existing.nextAssessmentStep) {
    const assessment = assessPillar2A({ ...args, assessmentStep: closingStep });
    args.state.risk.pillar2A = assessment;
    return assessment;
  }
  return existing;
};
