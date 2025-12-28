import { BalanceSheet } from './balanceSheet';
import { IncomeStatement } from './pnl';
import { ComplianceStatus, RiskMetrics, CapitalState } from './risks';
import { MarketState } from './market';
import { CashFlowStatement } from './cashflow';
import { LoanCohort } from './loanCohorts';
import { ProductType } from './enums';

export type LoanCohortsMap = Partial<Record<ProductType, LoanCohort[]>>;

export interface SimulationTime {
  step: number;
  date: Date;
  stepLengthMonths: number;
}

export interface BehaviouralState {
  depositFranchiseStrength: number;
  reputation: number;
  ratingNotchOffset: number;
}

export interface FinancialState {
  balanceSheet: BalanceSheet;
  capital: CapitalState;
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
  market: MarketState;
  behaviour: BehaviouralState;
  loanCohorts: LoanCohortsMap;
  status: SimulationStatus;
}
