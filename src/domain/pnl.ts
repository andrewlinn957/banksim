export interface IncomeStatement {
  interestIncome: number;
  interestExpense: number;
  netInterestIncome: number;
  fvtplValuationImpact: number;
  fvociOciMovement: number;
  hedgeCarry: number;
  feeIncome: number;
  creditLosses: number;
  provisionCharge: number;
  realizedLoanLosses: number;
  realizedNonLoanLosses: number;
  operatingExpenses: number;
  fixedOperatingCosts: number;
  servicingCosts: number;
  originationCosts: number;
  workoutCosts: number;
  conductCosts: number;
  at1CouponExpense: number;
  dividendsPaid: number;
  preTaxProfit: number;
  tax: number;
  netIncome: number;
  totalComprehensiveIncome: number;
}
