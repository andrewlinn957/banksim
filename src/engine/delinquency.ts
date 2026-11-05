import type { LoanCohort } from '../domain/loanCohorts';
import type { SimulationConfig } from '../domain/config';

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

/** The arrears bands are gross principal already included in a cohort's outstanding principal. */
export const cohortArrearsGross = (cohort: LoanCohort): number =>
  Math.max(0, cohort.arrears?.days1to30 ?? 0) +
  Math.max(0, cohort.arrears?.days31to60 ?? 0) +
  Math.max(0, cohort.arrears?.days61to89 ?? 0);

export const cohortArrearsStage2Gross = (cohort: LoanCohort): number =>
  Math.min(Math.max(0, cohort.outstandingPrincipal),
    Math.max(0, cohort.arrears?.days31to60 ?? 0) +
    Math.max(0, cohort.arrears?.days61to89 ?? 0));

/** Capitalised interest on overdue principal remains overdue until cured or defaulted. */
export const accrueOverdueInterest = (cohort: LoanCohort, interestRateMonthly: number): number => {
  const bands = cohort.arrears;
  if (!bands) return 0;
  const arrearsTotal = cohortArrearsGross(cohort);
  const gross = Math.max(0, cohort.outstandingPrincipal);
  if (arrearsTotal <= 0 || gross <= 0) return 0;
  const factor = 1 + interestRateMonthly;
  bands.days1to30 *= factor;
  bands.days31to60 *= factor;
  bands.days61to89 *= factor;
  return Math.min(gross, arrearsTotal) * interestRateMonthly;
};

/**
 * Deterministic expected flows across delinquency ages, calibrated to annual PD.
 * This keeps aggregate cohorts compact: flows represent fractions of borrower
 * exposures, rather than random wholesale default of an entire large cohort.
 * Returns the fraction reaching the 90+ day default backstop this month; the
 * caller transfers that principal to workout and removes it from gross loans.
 */
export const advanceCohortArrears = (
  cohort: LoanCohort, annualPd: number, config: SimulationConfig,
): { arrearsDefault: number; directDefaultShare: number; newArrears: number } => {
  const setting = config.behaviour.ifrs9?.delinquency;
  if (!setting?.enabled || cohort.stage === 'stage3' || (cohort.daysPastDue ?? 0) > 0) {
    return { arrearsDefault: 0, directDefaultShare: 1, newArrears: 0 };
  }
  const gross = Math.max(0, cohort.outstandingPrincipal);
  const prior = cohort.arrears ?? { days1to30: 0, days31to60: 0, days61to89: 0 };
  const first = Math.max(0, prior.days1to30);
  const second = Math.max(0, prior.days31to60);
  const third = Math.max(0, prior.days61to89);
  const arrearsGross = Math.min(gross, first + second + third);
  const performing = Math.max(0, gross - arrearsGross);
  const pressure = Math.max(0, (cohort.affordabilityIndex ?? 1) - 1) *
    Math.max(0, setting.affordabilityRollSensitivity);
  const roll1 = clamp(setting.days1to30RollRate + pressure);
  const roll2 = clamp(setting.days31to60RollRate + pressure);
  const roll3 = clamp(setting.days61to89DefaultRate + pressure);
  const annualDefault = clamp(annualPd, 0, .999999);
  const monthlyDefault = 1 - (1 - annualDefault) ** (1 / 12);
  const newArrears = Math.min(performing,
    performing * clamp(monthlyDefault * setting.monthlyEntryPdMultiplier));
  const arrearsDefault = Math.min(third * roll3, gross);
  cohort.arrears = {
    days1to30: newArrears,
    days31to60: first * roll1,
    days61to89: second * roll2,
  };
  return { arrearsDefault, directDefaultShare: clamp(setting.directDefaultShare), newArrears };
};
