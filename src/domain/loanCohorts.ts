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
  originalPrincipal: number;
  outstandingPrincipal: number;
  annualInterestRate: number;
  termMonths: number;
  ageMonths: number;
  annualPd: number;
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
  stageAtDefault: LoanStage;
  defaultedPrincipal: number;
  expectedRecoveryRate: number;
  effectiveInterestRate?: number;
  monthsToResolution: number;
  sector?: LoanSector;
  geography?: LoanGeography;
}
