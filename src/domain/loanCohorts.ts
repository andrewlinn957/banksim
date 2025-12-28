/**
 * Domain model for loan cohorts.
 *
 * A "loan cohort" is a bucket of many similar loans (same product type, similar
 * pricing/credit assumptions) tracked together. This keeps the simulation fast:
 * we can model thousands of loans as a small number of cohorts.
 *
 * This file only contains TypeScript types/interfaces, so it produces no
 * runtime JavaScript and has no side effects.
 */
import { ProductType } from './enums';

/**
 * Represents one group ("cohort") of loans that move together through time.
 *
 * Parameters: none (this is a type, not a function).
 * Return type: none (interfaces only describe shape).
 * Side effects: none.
 * Thrown errors: none.
 */
export interface LoanCohort {
  // Which product this cohort belongs to (e.g. mortgages vs corporate loans).
  productType: ProductType;
  // Identifier within the product (conventions are defined by the engine code).
  cohortId: number;

  // Principal at the time these loans were originated (starting balance).
  originalPrincipal: number;
  // Current unpaid principal balance at the current simulation time.
  outstandingPrincipal: number;

  // Annual nominal interest rate expressed as a decimal (e.g. 0.05 === 5% APR).
  annualInterestRate: number;
  // Original contractual term, in months.
  termMonths: number;
  // How many months have elapsed since origination (0 means "brand new").
  ageMonths: number;

  // Annual probability of default (PD) as a decimal between 0 and 1.
  annualPd: number;
  // Loss given default (LGD) as a decimal between 0 and 1.
  lgd: number;
}
