import type { ProductType } from './enums';
import type { LoanStage } from './loanCohorts';

export interface VintageFlow {
  productType: ProductType;
  /** Closing simulation step of origination; null means the loan predates the run. */
  originationStep: number | null;
  amount: number;
  stage?: LoanStage;
}

export interface AllowanceStageBalances {
  stage1: number;
  stage2: number;
  stage3: number;
  total: number;
}

/** Reconciles allowance stocks with the components posted to the period P&L. */
export interface ProvisionBridgeDiagnostics {
  fundedAllowanceOpeningByStage: AllowanceStageBalances;
  fundedAllowanceClosingByStage: AllowanceStageBalances;
  fundedAllowanceOpeningByProduct: Partial<Record<ProductType, number>>;
  fundedAllowanceClosingByProduct: Partial<Record<ProductType, number>>;
  fundedAllowanceMovementByProduct: Partial<Record<ProductType, number>>;
  commitmentAllowanceOpening: number;
  commitmentAllowanceClosing: number;
  workoutWriteoffsByProduct: Partial<Record<ProductType, number>>;
  oneOffLoanWriteDownsByProduct: Partial<Record<ProductType, number>>;
  securityImpairmentByProduct: Partial<Record<ProductType, number>>;
  workoutDiscountUnwindByProduct: Partial<Record<ProductType, number>>;
  provisionCharge: number;
  reconciliationDifference: number;
}

/** Exact inputs and intermediate terms used by the share-price calculation this period. */
export interface ShareValuationDiagnostics {
  gdpGrowthMoM: number;
  unemploymentRate: number;
  creditSpread: number;
  epsTtmOpening: number;
  annualisedEps: number;
  epsAlpha: number;
  epsTtm: number;
  bvps: number;
  roeProxy: number;
  costOfEquity: number;
  profitabilityScore: number;
  cet1Headroom: number;
  leverageHeadroom: number;
  capitalScore: number;
  macroScore: number;
  franchiseStrength: number;
  franchiseScore: number;
  weightedProfitability: number;
  weightedCapital: number;
  weightedMacro: number;
  weightedFranchise: number;
  rawWeightedScore: number;
  scoreWeightDenominator: number;
  normalizedScore: number;
  modelPe: number;
  modelPb: number;
  stressedEarningsBase: number;
  earningsValue: number;
  bookValue: number;
  earningsReliability: number;
  earningsWeight: number;
  bookWeight: number;
  fairValueBeforeStress: number;
  capitalDiscount: number;
  failureDiscount: number;
  fairValue: number;
  priorSharePrice: number;
  unconstrainedSharePrice: number;
  moveLimitFactor: number;
  sharePrice: number;
  quotedPe: number | null;
  baseCostOfEquity: number;
  creditSpreadPremium: number;
  uncertaintyPremium: number;
  capitalRiskPremium: number;
  profitabilitySignal: number;
  capitalSignal: number;
  macroSignal: number;
  franchiseSignal: number;
  trailingEarningsMonths: number;
  trailingNetIncome: number;
  trailingCommonIncome: number;
  trailingWeightedAverageShares: number;
  earningsVolatility: number;
  earningsDownsideSurprise: number;
  earningsUncertainty: number;
  earningsPersistence: number;
  persistentEps: number;
  discountRateFactor: number;
  distributableCapitalProxy: number;
  excessCapitalPerShare: number;
  trailingEps: number | null;
  quotedPeTtm: number | null;
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
  provisionBridge?: ProvisionBridgeDiagnostics;
  shareValuation?: ShareValuationDiagnostics | null;
  lcr30d: {
    weightedOutflows: number;
    weightedInflows: number;
    netOutflow: number;
    hqla: number;
  };
}
