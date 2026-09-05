import { BalanceSheet } from './balanceSheet';
import { IncomeStatement } from './pnl';
import { ComplianceStatus, RiskMetrics, CapitalState, FundingConfidenceState } from './risks';
import { MarketState } from './market';
import { CashFlowStatement } from './cashflow';
import { LoanCohort, LoanWorkoutBucket } from './loanCohorts';
import { ProductType } from './enums';

export type LoanCohortsMap = Partial<Record<ProductType, LoanCohort[]>>;

export interface LoanPipelineState {
  demandNotional: number;
  approvedNotional: number;
  committedNotional: number;
}

export type LoanPipelineMap = Partial<Record<ProductType, LoanPipelineState>>;
export type LoanWorkoutPipelineMap = Partial<Record<ProductType, LoanWorkoutBucket[]>>;

export interface FundingMaturityBucket {
  tenorMonths: number;
  monthsToMaturity: number;
  notional: number;
  rate: number;
}

export type FundingLadderMap = Partial<Record<ProductType, FundingMaturityBucket[]>>;

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
  depositFranchiseStrength: number;
  reputation: number;
  ratingNotchOffset: number;
  depositRateLagMemory?: Partial<Record<ProductType, number>>;
  depositUnderpricingMonths?: Partial<Record<ProductType, number>>;
  depositStabilityIndex?: Partial<Record<ProductType, number>>;
  underwritingTightness?: Partial<Record<ProductType, number>>;
  capitalPolicy?: CapitalPolicyState;
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
  equityMarket: EquityMarketState;
  market: MarketState;
  behaviour: BehaviouralState;
  loanCohorts: LoanCohortsMap;
  loanPipelines: LoanPipelineMap;
  workoutPipelines: LoanWorkoutPipelineMap;
  fundingLadders: FundingLadderMap;
  status: SimulationStatus;
}
