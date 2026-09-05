import { ProductType } from './enums';
import { SecuritiesClassification } from './balanceSheet';
import { LiquidityTag } from './liquidity';
import { LoanGeography, LoanSector } from './loanCohorts';
import { FundingConfidenceState, RiskLimits } from './risks';

export type EngineFeatureFlagKey =
  | 'depositSegmentation'
  | 'loanPipeline'
  | 'costDecomposition'
  | 'fundingLadder'
  | 'ifrs9Staging'
  | 'liquidityDynamics'
  | 'irrbbHedges'
  | 'securitiesAccounting'
  | 'capitalPolicy'
  | 'concentrationRisk'
  | 'boardPressure'
  | 'confidenceStateMachine'
  | 'conductRisk'
  | 'recommendations'
  | 'stepDiagnosticsAttribution';

export type FeatureFlags = Partial<Record<EngineFeatureFlagKey, boolean>>;

export interface LoanCohortParameters {
  defaultTermMonths: number;
  maxTermMonths: number;
  initialSeasoningEnabled?: boolean;
  initialCouponDispersionBps?: number;
  initialPdMultiplierRange?: { min: number; max: number };
  initialLgdMultiplierRange?: { min: number; max: number };
  initialMinBucketOutstanding?: number;
}

export interface ProductRiskParameters {
  productType: ProductType;
  riskWeight: number;
  baseDefaultRate: number;
  lossGivenDefault: number;
  volumeElasticityToRate: number;
  adverseSelectionRatePremiumThreshold?: number;
  adverseSelectionPdSlope?: number;
  adverseSelectionMaxMultiplier?: number;
  loan?: LoanCohortParameters;
}

export interface GlobalSimulationParameters {
  taxRate: number;
  operatingCostRatio: number;
  maxDepositGrowthPerStep: number;
  maxLoanGrowthPerStep: number;
  fixedOperatingCostPerMonth: number;
  initialPortfolioSeed?: number;
  competitorDepositReactionSpeed?: number;
  competitorCorporateDepositReactionSpeed?: number;
  competitorMortgageReactionSpeed?: number;
  competitorCorporateLoanSpreadReactionSpeed?: number;
  competitorReactionStressBoost?: number;
  competitorReactionMeanReversion?: number;
}

export interface DepositSegmentBehaviourParameters {
  baselineGrowthMonthly: number;
  baseChurnMonthly: number;
  policyRateBeta: number;
  competitorSensitivity: number;
  passThroughLag: number;
  underpricingConvexity?: number;
  underpricingDurationSensitivity?: number;
  franchiseDecayRate?: number;
  franchiseRecoveryRate?: number;
  reacquisitionDrag?: number;
  stabilityDecayRate?: number;
  stabilityRecoveryRate?: number;
  mixMigrationRate?: number;
  mixMigrationDurationSensitivity?: number;
}

export interface LoanPipelineParameters {
  baseDemandRateMonthly: number;
  pricingSensitivity: number;
  macroSensitivity: number;
  baseApprovalRate: number;
  underwritingSensitivity: number;
  drawdownRateMonthly: number;
  cancellationRateMonthly: number;
}

export interface AdverseSelectionLifecycleParameters {
  renewalShareMonthly: number;
  renewalEligibilityMonths: number;
  renewalRatePremiumThreshold: number;
  renewalPdSlope: number;
  renewalMaxMultiplier: number;
  underwritingInteractionWeight: number;
  selectionPressureEventThreshold: number;
}

export interface AffordabilityDynamicsParameters {
  baselineDriftMonthly: number;
  couponGapSensitivity: number;
  policyRateSensitivity: number;
  unemploymentSensitivity: number;
  gdpContractionSensitivity: number;
  recoverySpeedMonthly: number;
  pdStressSlope: number;
  minIndex: number;
  maxIndex: number;
  resetShareOnRenewal: number;
}

export interface RefinanceSelectionParameters {
  minSeasoningMonths: number;
  basePrepayRateMonthly: number;
  incentiveSensitivity: number;
  riskSelectivity: number;
  minPrepayRateMonthly: number;
  maxPrepayRateMonthly: number;
}

export interface WorkoutPipelineParameters {
  baseResolutionLagMonths: number;
  stressLagSensitivity: number;
  baseRecoveryRateFloor: number;
  macroRecoveryPenaltySensitivity: number;
  concentrationRecoveryPenaltySensitivity: number;
}

export interface CreditRiskDynamicsParameters {
  adverseSelection?: AdverseSelectionLifecycleParameters;
  affordabilityByProduct?: Partial<Record<ProductType, AffordabilityDynamicsParameters>>;
  refinanceByProduct?: Partial<Record<ProductType, RefinanceSelectionParameters>>;
  workoutPipeline?: WorkoutPipelineParameters;
}

export interface CostModelParameters {
  fixedCostPerMonth: number;
  servicingCostRateAnnual: number;
  originationCostRate: number;
  workoutCostRateOnDefaults: number;
}

export interface FundingLadderParameters {
  stRefinanceTenorMonths: number;
  ltRefinanceTenorMonths: number;
  rolloverAccessBase: number;
  rolloverAccessMin: number;
  spreadSensitivity: number;
  liquidityStressPenalty: number;
  franchiseSpreadSensitivity?: number;
  capitalSpreadSensitivity?: number;
  confidenceSpreadSensitivity?: number;
  accessCliffMidpoint?: number;
  accessCliffSlope?: number;
  accessFloorMultiplier?: number;
}

export interface Ifrs9Parameters {
  sicrPdMultiplierThreshold: number;
  eclScenarios?: Array<{ weight: number; pdMultiplier: number }>;
}

export interface LiquidityDynamicsParameters {
  recessionDepositOutflowMultiplier: number;
  franchiseRunoffSensitivity: number;
  reputationRunoffSensitivity: number;
  recessionInflowHaircut: number;
  recessionAsfPenalty: number;
  depositQualityRunoffSensitivity?: number;
  depositQualityAsfPenalty?: number;
  multiplierFloor: number;
  multiplierCap: number;
}

export interface IrrbbParameters {
  baseAssetDurationYears: number;
  baseLiabilityDurationYears: number;
  hedgeCarrySpread: number;
}

export interface SecuritiesAccountingParameters {
  defaultClassificationByProduct?: Partial<Record<ProductType, SecuritiesClassification>>;
  effectiveDurationYearsByProduct?: Partial<Record<ProductType, number>>;
  fvociCet1InclusionRate: number;
}

export interface ConcentrationParameters {
  stressActivationPdMultiplier: number;
  sectorPdMultiplierByStress?: Partial<Record<LoanSector, number>>;
  geographyPdMultiplierByStress?: Partial<Record<LoanGeography, number>>;
}

export interface BoardPressureParameters {
  earningsVolatilitySmoothing: number;
  volatilityWeight: number;
  franchiseWeight: number;
  riskWeight: number;
  payoutRestraintWeight?: number;
}

export interface ConfidenceStateImpactParameters {
  spreadPenaltyBps: number;
  accessMultiplier: number;
  equityIssuanceMultiplier: number;
  equityIssuanceFeeRate: number;
}

export interface ConfidenceStateMachineParameters {
  strongMinScore: number;
  stableMinScore: number;
  watchMinScore: number;
  hardLcrWatch: number;
  hardLcrStressed: number;
  hardNsfrWatch: number;
  hardNsfrStressed: number;
  hardCet1HeadroomWatch: number;
  hardCet1HeadroomStressed: number;
  upgradeSustainMonths: number;
  impacts: Record<FundingConfidenceState, ConfidenceStateImpactParameters>;
}

export interface ConductRiskParameters {
  depositUnderpricingThreshold: number;
  lendingOverpricingThreshold: number;
  depositWeight: number;
  lendingWeight: number;
  underwritingAmplifier: number;
  scoreBuildRate: number;
  scoreDecayRate: number;
  eventProbabilityBase: number;
  eventProbabilitySlope: number;
  eventProbabilityCap: number;
  eventCooldownMonths: number;
  fineRateOnRwa: number;
  remediationRateOnIncome: number;
  minEventCost: number;
  franchiseHit: number;
  reputationHit: number;
}

export interface SharePriceModelParameters {
  peNeutral: number;
  peMin: number;
  peMax: number;
  peScoreSensitivity: number;
  pbNeutral: number;
  pbMin: number;
  pbMax: number;
  pbScoreSensitivity: number;
  earningsValuationWeight: number;
  bookValuationWeight: number;
  meanReversionSpeedMonthly: number;
  maxMonthlyMove: number;
  epsSmoothingMonthly: number;
  epsFloor: number;
  priceFloor: number;
  costOfEquity: number;
  profitabilityWeight: number;
  capitalWeight: number;
  macroWeight: number;
  franchiseWeight: number;
  roeScale: number;
  capitalCet1Scale: number;
  capitalLeverageScale: number;
  macroGdpScale: number;
  macroUnemploymentNeutral: number;
  macroUnemploymentScale: number;
  macroCreditSpreadNeutral: number;
  macroCreditSpreadScale: number;
  franchiseNeutral: number;
  franchiseScale: number;
  capitalBreachDiscount: number;
  failurePriceFactor: number;
  equityIssuanceDiscount: number;
}

export interface BehaviourParameters {
  depositBaselineGrowthMonthly: number;
  loanBaselineGrowthMonthly: number;
  minDepositGrowthPerStep: number;
  minLoanGrowthPerStep: number;
  loanFeeRateMonthly: number;
  horizonRiskPenaltyWeight?: number;
  depositByProduct?: Partial<Record<ProductType, DepositSegmentBehaviourParameters>>;
  loanPipelineByProduct?: Partial<Record<ProductType, LoanPipelineParameters>>;
  creditRiskDynamics?: CreditRiskDynamicsParameters;
  costModel?: CostModelParameters;
  fundingLadder?: FundingLadderParameters;
  ifrs9?: Ifrs9Parameters;
  liquidityDynamics?: LiquidityDynamicsParameters;
  irrbb?: IrrbbParameters;
  securitiesAccounting?: SecuritiesAccountingParameters;
  concentration?: ConcentrationParameters;
  boardPressure?: BoardPressureParameters;
  confidenceStateMachine?: ConfidenceStateMachineParameters;
  conductRisk?: ConductRiskParameters;
  sharePriceModel?: SharePriceModelParameters;
}

export interface IdiosyncraticRunParameters {
  baseRunOffRate: number;
  incrementalRate: number;
  maxRunOffRate: number;
}

export interface ShockParameters {
  idiosyncraticRun: IdiosyncraticRunParameters;
}

export interface ToleranceParameters {
  cashFlowRoundingTolerance: number;
  cashFlowBreachThreshold: number;
}

export interface SimulationConfig {
  version: string;
  productParameters: Record<ProductType, ProductRiskParameters>;
  liquidityTags: Record<ProductType, LiquidityTag>;
  global: GlobalSimulationParameters;
  riskLimits: RiskLimits;
  behaviour: BehaviourParameters;
  shockParameters: ShockParameters;
  tolerances: ToleranceParameters;
  featureFlags?: FeatureFlags;
}
