export type FundingConfidenceState = 'strong' | 'stable' | 'watch' | 'stressed';

export interface CapitalState {
  cet1: number;
  at1: number;
  accumulatedOCI: number;
}

export interface RiskMetrics {
  rwa: number;
  tier1Ratio?: number;
  totalCapitalRatio?: number;
  managementLcr?: number;
  managementNsfr?: number;
  leverageExposure: number;
  cet1Ratio: number;
  cet1Requirement: number;
  cet1Headroom: number;
  leverageRatio: number;
  hqla: number;
  lcr: number;
  lcrOutflowMultiplier: number;
  depositQualityIndex: number;
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

export interface RiskLimits {
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
