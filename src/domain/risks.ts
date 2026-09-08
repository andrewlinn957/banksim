export type FundingConfidenceState = 'strong' | 'stable' | 'watch' | 'stressed';

export interface CapitalState {
  cet1: number;
  at1: number;
  tier2?: number;
  accumulatedOCI: number;
}

export interface Pillar2AComponentAmounts {
  creditRisk: number;
  singleNameConcentration: number;
  sectorConcentration: number;
  geographicConcentration: number;
  irrbb: number;
}

export interface Pillar2AAssessmentState {
  /** Variable Pillar 2A rate fixed at the latest annual SREP assessment. */
  assessedRate: number;
  grossRate: number;
  assessmentRwa: number;
  assessmentStep: number;
  assessmentDate: string;
  nextAssessmentStep: number;
  components: Pillar2AComponentAmounts;
  creditRisk: {
    benchmarkRwa: number;
    pillar1CreditRwa: number;
    shortfallRwa: number;
  };
  concentration: {
    singleNameHhi: number;
    sectorHhi: number;
    geographicHhi: number;
    wholesaleRwa: number;
    geographicPortfolioRwa: number;
  };
  irrbb: {
    worstLoss200bp: number;
    policyLimit: number;
    capitalConversionFactor: number;
    assessedAmount: number;
  };
  ps1520: {
    ukCcybPassThroughRate: number;
    initialOffsetRate: number;
    additionalOffsetRate: number;
    lowRiskEligible: boolean;
    mrelEqualsTcr: boolean;
  };
}

export interface RiskMetrics {
  internalLeverageTargetRatio?: number;
  internalLcrTargetRatio?: number;
  internalNsfrTargetRatio?: number;
  tier1Requirement?: number;
  totalCapitalRequirement?: number;
  pillar2ARate?: number;
  pillar2AAmount?: number;
  pillar2AGrossRate?: number;
  pillar2AOffsetRate?: number;
  pillar2ANextAssessmentStep?: number;
  rwa: number;
  tier1Ratio?: number;
  totalCapitalRatio?: number;
  managementLcr?: number;
  managementNsfr?: number;
  leverageExposure: number;
  cet1Ratio: number;
  cet1Requirement: number;
  minimumCet1Ratio?: number;
  minimumTier1Ratio?: number;
  minimumTotalCapitalRatio?: number;
  praBufferTarget?: number;
  praBufferBreached?: boolean;
  cet1Headroom: number;
  leverageRatio: number;
  hqla: number;
  lcr: number;
  lcrOutflowMultiplier: number;
  depositQualityIndex: number;
  insuredRetailDepositShare?: number;
  largeDepositorShare?: number;
  termDepositShare?: number;
  asf: number;
  rsf: number;
  nsfr: number;
  fundingStressIndex: number;
  fundingConfidenceScore: number;
  fundingConfidenceState: FundingConfidenceState;
  internalCet1TargetRatio: number;
  internalCet1Headroom: number;
  payoutBlockedByInternalTarget: boolean;
  conductRiskScore: number;
  niiSensitivity100bp: number;
  eveSensitivity100bp: number;
  fundingMaturing3m: number;
  fundingMaturing12m: number;
  mdaTriggered: boolean;
  maxPayoutRatio: number;
  sectorConcentration: number;
  geographyConcentration: number;
  concentrationHhi: number;
  boardPressureScore: number;
  boardPressureVolatility: number;
  boardPressureFranchiseGap: number;
  boardPressureRiskGap: number;
  boardPressurePayoutRestraint: number;
}

export interface CapitalBufferStack {
  conservationBuffer: number;
  countercyclicalBuffer: number;
  systemicBuffer: number;
  managementBuffer: number;
}

export interface CapitalPolicyLimits {
  defaultDividendPayoutRatio: number;
  at1CouponRateAnnual: number;
  at1DiscretionaryCet1Threshold: number;
  internalTargetBaseBuffer: number;
  internalTargetVolatilitySensitivity: number;
  internalTargetStressSensitivity: number;
  internalTargetConfidenceSensitivity: number;
  internalTargetConductSensitivity: number;
  internalTargetMaxBuffer: number;
  payoutRestrictionSlope: number;
  at1InternalTargetHeadroom: number;
}

export interface ConcentrationLimits {
  maxSingleSectorShare: number;
  maxSingleGeographyShare: number;
}

export interface BoardPressureLimits {
  earningsVolatilityTolerance: number;
  franchiseTarget: number;
  riskAppetiteCet1Headroom: number;
}

export interface RwaAddOnLimits {
  operationalRisk?: number;
  counterpartyRisk?: number;
  otherAdjustments?: number;
}

export interface Pillar2ALimits {
  /** Optional scenario/manual floor retained for backwards-compatible scenario design. */
  totalRatio?: number;
  fixedAmount?: number;
  /** Capital-quality shares are game assumptions, separate from the annual risk assessment. */
  cet1Share?: number;
  tier1Share?: number;
  assessmentIntervalMonths?: number;
  typicalWholesaleObligorExposure?: number;
  defaultIrrbbEveLimit?: number;
  /** BankSim scalar because the PRA does not publish a simple small-bank limit-to-capital conversion. */
  irrbbCapitalConversionFactor?: number;
  structuralCcybIncrease?: number;
  initialOffsetShare?: number;
  additionalOffsetShare?: number;
  additionalFloor?: number;
  /** BankSim assumptions until a full MREL / supervisory categorisation engine exists. */
  lowRiskSmallBankEligible?: boolean;
  mrelEqualsTcr?: boolean;
}

export interface RiskLimits {
  pillar2A?: Pillar2ALimits;
  praBufferRatio?: number;
  minCet1Ratio: number;
  minTier1Ratio?: number;
  minTotalCapitalRatio?: number;
  minLeverageRatio: number;
  minLcr: number;
  minNsfr: number;
  rwaAddOns?: RwaAddOnLimits;
  capitalBufferStack: CapitalBufferStack;
  capitalPolicy: CapitalPolicyLimits;
  concentration: ConcentrationLimits;
  boardPressure: BoardPressureLimits;
}

export interface ComplianceStatus {
  cet1Breached: boolean;
  ownFundsBreached?: boolean;
  leverageBreached: boolean;
  lcrBreached: boolean;
  nsfrBreached: boolean;
  concentrationBreached: boolean;
  mdaTriggered: boolean;
}
