import { BalanceSheet } from './balanceSheet';
import { IncomeStatement } from './pnl';
import { ComplianceStatus, RiskMetrics, CapitalState } from './risks';
import { MarketState } from './market';
import { CashFlowStatement } from './cashflow';
import { LoanCohort } from './loanCohorts';
import { ProductType } from './enums';

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

export interface BankState {
  version: string;
  time: SimulationTime;
  balanceSheet: BalanceSheet;
  capital: CapitalState;
  incomeStatement: IncomeStatement;
  cashFlowStatement: CashFlowStatement;
  riskMetrics: RiskMetrics;
  compliance: ComplianceStatus;
  market: MarketState;
  behaviour: BehaviouralState;
  loanCohorts: Partial<Record<ProductType, LoanCohort[]>>;
  isInResolution: boolean;
  hasFailed: boolean;
}
