import { BalanceSheet } from './balanceSheet';
import { IncomeStatement } from './pnl';
import { ComplianceStatus, RiskMetrics, CapitalState, FundingConfidenceState, Pillar2AAssessmentState, OsiiAssessmentState, LeverageFrameworkAssessmentState } from './risks';
import { MarketState } from './market';
import { CashFlowStatement } from './cashflow';
import { LoanCohort, LoanWorkoutBucket } from './loanCohorts';
import { ProductType } from './enums';
import type { ThreeYearPlanState } from './threeYearPlan';
import type { CapitalMarketsState } from './capitalMarkets';

export type LoanCohortsMap = Partial<Record<ProductType, LoanCohort[]>>;

export interface LoanPipelineState {
  demandNotional: number;
  approvedNotional: number;
  committedNotional: number;
}

export type LoanPipelineMap = Partial<Record<ProductType, LoanPipelineState>>;
export type LoanWorkoutPipelineMap = Partial<Record<ProductType, LoanWorkoutBucket[]>>;

export interface ContractualMaturityBucket {
  tenorMonths: number;
  monthsToMaturity: number;
  notional: number;
  rate: number;
}

/** @deprecated Compatibility name for liability funding code and existing saves. */
export type FundingMaturityBucket = ContractualMaturityBucket;
export type FundingLadderMap = Partial<Record<ProductType, ContractualMaturityBucket[]>>;
export type AssetMaturityLadderMap = Partial<Record<ProductType, ContractualMaturityBucket[]>>;

export interface ProvisionStock {
  stage1: number;
  stage2: number;
  stage3: number;
  total: number;
}

export interface InterestRateHedge {
  fairValue?: number;
  id: string;
  direction: 'payFixedReceiveFloat' | 'receiveFixedPayFloat';
  notional: number;
  fixedRate: number;
  maturityMonths: number;
  monthsRemaining: number;
}

export interface CapitalPolicyState {
  dividendPayoutRatio: number;
  at1CouponMode: 'auto' | 'pay' | 'skip';
}

export interface MortgagePolicyState {
  /** Maximum LTV offered on new mortgages. */
  maxLtv: number;
  /** Representative initial fixed-rate period on new mortgages. */
  fixedPeriodMonths: number;
}

export interface TreasuryPolicyState {
  /** @deprecated Legacy descriptive target retained for save/replay compatibility. */
  giltShareOfHqla: number;
  /** @deprecated Legacy/default duration retained for old treasury-policy actions. */
  giltDurationYears: number;
}

export interface BoardPressureState {
  score: number;
  earningsVolatility: number;
  franchiseGap: number;
  riskGap: number;
  payoutRestraint?: number;
}

export interface EquityMarketState {
  sharesOutstanding: number;
  sharePrice: number;
  marketCap: number;
  epsTtm: number;
  peMultiple: number;
  bookValuePerShare?: number;
  priceToBook?: number;
  fairValuePerShare?: number;
}

export interface SimulationTime {
  step: number;
  date: Date;
  stepLengthMonths: number;
}

export interface BehaviouralState {
  riskAppetite?: { cet1: number; leverage: number; lcr: number; nsfr: number; irrbbEveLimit?: number };
  depositFranchiseStrength: number;
  reputation: number;
  ratingNotchOffset: number;
  depositRateLagMemory?: Partial<Record<ProductType, number>>;
  depositUnderpricingMonths?: Partial<Record<ProductType, number>>;
  depositStabilityIndex?: Partial<Record<ProductType, number>>;
  underwritingTightness?: Partial<Record<ProductType, number>>;
  capitalPolicy?: CapitalPolicyState;
  mortgagePolicy?: MortgagePolicyState;
  treasuryPolicy?: TreasuryPolicyState;
  termDepositTenorMonths?: number;
  /** Approximate share of retail deposits protected by FSCS limits. */
  insuredRetailDepositShare?: number;
  /** Approximate share of total deposits represented by the largest depositor/group. */
  largeDepositorShare?: number;
  previousNetIncome?: number;
  earningsVolatility?: number;
  fundingConfidenceScore?: number;
  fundingConfidenceState?: FundingConfidenceState;
  confidenceUpgradeProgressMonths?: number;
  conductRiskScore?: number;
  conductEventCooldownMonths?: number;
  conductEventCount?: number;
  cumulativeConductCosts?: number;
}

export interface FinancialState {
  balanceSheet: BalanceSheet;
  capital: CapitalState;
  provisionStock: ProvisionStock;
  hedges: InterestRateHedge[];
  incomeStatement: IncomeStatement;
  cashFlowStatement: CashFlowStatement;
}

export interface RiskState {
  riskMetrics: RiskMetrics;
  compliance: ComplianceStatus;
  pillar2A?: Pillar2AAssessmentState;
  osii?: OsiiAssessmentState;
  leverageFramework?: LeverageFrameworkAssessmentState;
}

export interface SimulationStatus {
  isInResolution: boolean;
  hasFailed: boolean;
}

export interface BankState {
  version: string;
  time: SimulationTime;
  financial: FinancialState;
  risk: RiskState;
  board: BoardPressureState;
  /** Optional, opt-in management accountability layer. */
  threeYearPlan?: ThreeYearPlanState;
  /** Capital-markets execution history and effective issued-instrument terms. */
  capitalMarkets?: CapitalMarketsState;
  equityMarket: EquityMarketState;
  market: MarketState;
  behaviour: BehaviouralState;
  loanCohorts: LoanCohortsMap;
  loanPipelines: LoanPipelineMap;
  workoutPipelines: LoanWorkoutPipelineMap;
  fundingLadders: FundingLadderMap;
  /** Contractual maturity ladders for assets; separated from liability funding ladders. */
  assetMaturityLadders?: AssetMaturityLadderMap;
  status: SimulationStatus;
}
