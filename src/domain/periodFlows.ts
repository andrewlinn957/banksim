import type { ProductType } from './enums';
import type { LoanStage } from './loanCohorts';

export interface VintageFlow {
  productType: ProductType;
  /** Closing simulation step of origination; null means the loan predates the run. */
  originationStep: number | null;
  amount: number;
  stage?: LoanStage;
}

/** Compact flow data retained with each closing state for run analysis. */
export interface PeriodFlowDiagnostics {
  periodMonths: number;
  competitorPricing: {
    retailCurrentAccount: number;
    retailTermDeposit: number;
    corporateDeposit: number | null;
    mortgage: number;
    consumerLoan: number;
    corporateLoan: number;
  };
  openingLoanExposureByProduct: Partial<Record<ProductType, number>>;
  interestIncomeByProduct: Partial<Record<ProductType, number>>;
  fundingCostByProduct: Partial<Record<ProductType, number>>;
  newLendingByProduct: Partial<Record<ProductType, number>>;
  renewalsByProduct: Partial<Record<ProductType, number>>;
  scheduledRepaymentsByProduct: Partial<Record<ProductType, number>>;
  prepaymentsByProduct: Partial<Record<ProductType, number>>;
  defaultsByProduct: Partial<Record<ProductType, number>>;
  defaultsByVintage: VintageFlow[];
  recoveriesByProduct: Partial<Record<ProductType, number>>;
  recoveriesByVintage: VintageFlow[];
  realizedLossesByVintage: VintageFlow[];
  recognizedLoanLossesByProduct: Partial<Record<ProductType, number>>;
  lcr30d: {
    weightedOutflows: number;
    weightedInflows: number;
    netOutflow: number;
    hqla: number;
  };
}
