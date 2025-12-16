import { ProductType } from './enums';

export interface LoanCohort {
  productType: ProductType;
  cohortId: number;

  originalPrincipal: number;
  outstandingPrincipal: number;

  annualInterestRate: number;
  termMonths: number;
  ageMonths: number;

  annualPd: number;
  lgd: number;
}

