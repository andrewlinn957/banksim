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

export interface LoanCohort {
  productType: ProductType;
  cohortId: number;
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
  expectedRecoveryRate: number;
  effectiveInterestRate?: number;
  monthsToResolution: number;
  /** Write-offs can precede legal workout resolution. */
  earlyWriteoffApplied?: boolean;
  noReasonableExpectationOfRecovery?: boolean;
  sector?: LoanSector;
  geography?: LoanGeography;
}
