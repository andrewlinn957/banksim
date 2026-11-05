/**
 * Domain model for loan cohorts.
 *
 * A "loan cohort" is a bucket of many similar loans (same product type, similar
 * pricing/credit assumptions) tracked together. This keeps the simulation fast:
 * we can model thousands of loans as a small number of cohorts.
 */
import { ProductType } from './enums';
import { UkItl1Region } from './ukItl1';

export type LoanStage = 'stage1' | 'stage2' | 'stage3';
export type LoanSector =
  | 'retailMortgage'
  | 'consumer'
  | 'commercialRealEstate'
  | 'sme'
  | 'largeCorporate'
  | 'other';
export type LegacyLoanGeography = 'south' | 'midlands' | 'north' | 'other';
export type LoanGeography = UkItl1Region | LegacyLoanGeography;

export interface BorrowerPaymentRecord {
  step: number;
  scheduledDue: number;
  received: number;
  overdueAtClose: number;
  daysPastDueAtClose: number;
  closingContractualPrincipal: number;
}

export interface LoanCohort {
  productType: ProductType;
  cohortId: number;
  /** Explicitly serviced individual loan; aggregate portfolios omit this. */
  borrowerId?: string;
  /** Last 36 month-end due/paid entries for identified borrowers. */
  paymentHistory?: BorrowerPaymentRecord[];
  /** Gross scheduled payments unpaid at the prior close. */
  overduePaymentAmount?: number;
  /** Optional borrower instruction consumed in the next step. */
  nextPaymentAmount?: number;
  /** Simulation step at origination; absent for the opening portfolio. */
  originationStep?: number;
  originalPrincipal: number;
  outstandingPrincipal: number;
  annualInterestRate: number;
  termMonths: number;
  ageMonths: number;
  annualPd: number;
  /** Origination PD retained through a continuing borrower relationship/renewal. */
  sicrReferenceAnnualPd?: number;
  /** Consecutive monthly closes meeting the Stage 2 cure criterion. */
  sicrCureMonths?: number;
  /** Observable contractual arrears; 31+ days is a SICR backstop, 90+ is default. */
  daysPastDue?: number;
  /** Qualitative default / unlikeliness-to-pay signal. */
  unlikelyToPay?: boolean;
  /** The initial effective-interest rate is retained for modification remeasurement. */
  originalEffectiveInterestRate?: number;
  /** Prospective yield including capitalised modification fees and costs. */
  postModificationEffectiveRate?: number;
  /** Difference between principal outstanding and IFRS gross amortised cost. */
  modificationAdjustment?: number;
  /** Cohort-level overdue principal, split into monthly arrears bands; included in outstandingPrincipal. */
  arrears?: { days1to30: number; days31to60: number; days61to89: number };
  effectiveAnnualPd?: number;
  effectiveLgd?: number;
  lgd: number;
  affordabilityIndex?: number;
  renewalCount?: number;
  stage: LoanStage;
  sector?: LoanSector;
  geography?: LoanGeography;
  /** Representative LTV for mortgage cohorts. Undefined for non-mortgage lending. */
  ltv?: number;
  /** Representative initial fixed-rate period for mortgages. */
  fixedPeriodMonths?: number;
}

export interface LoanWorkoutBucket {
  productType: ProductType;
  sourceCohortId: number;
  /** Simulation step at origination; absent for the opening portfolio. */
  originationStep?: number;
  /** Vintage principal mix retained when similar workout balances are compacted together. */
  vintageBreakdown?: Array<{ originationStep: number | null; defaultedPrincipal: number }>;
  stageAtDefault: LoanStage;
  defaultedPrincipal: number;
  modificationAdjustment?: number;
  expectedRecoveryRate: number;
  effectiveInterestRate?: number;
  monthsToResolution: number;
  /** Write-offs can precede legal workout resolution. */
  earlyWriteoffApplied?: boolean;
  /** Recovery penalty already incorporated when the irrecoverable portion was written off. */
  recoveryPenaltyAtWriteoff?: number;
  noReasonableExpectationOfRecovery?: boolean;
  sector?: LoanSector;
  geography?: LoanGeography;
}
