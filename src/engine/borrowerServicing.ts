import type { BankState } from '../domain/bankState';
import type { ProductType } from '../domain/enums';
import type { LoanCohort } from '../domain/loanCohorts';

const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const uniform = (id: string, step: number) => {
  let h = 2166136261 >>> 0;
  const str = id + ':' + step;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Borrower-level payments are cash movements, with complete per-month receipts. */
export const serviceBorrowerLoan = (
  state: BankState, cohort: LoanCohort, step: number, scheduledDue: number,
  contractualInterest: number, effectiveAnnualPd: number,
): { paid: number; principalCollected: number; defaultAtClose: boolean } => {
  if (!cohort.borrowerId) throw new Error('Identified borrower required');
  const principal = Math.max(0, cohort.outstandingPrincipal);
  const overdue = Math.max(0, cohort.overduePaymentAmount ?? 0);
  const due = Math.max(0, scheduledDue);
  // Expected missed-payment propensity rises with PD and affordability pressure.
  // The seeded ID-month draw makes a saved simulation exactly replayable.
  const propensity = clamp(effectiveAnnualPd / 6 +
    0.035 * Math.max(0, (cohort.affordabilityIndex ?? 1) - 1), 0, .40);
  const planned = uniform(cohort.borrowerId, step) < propensity ? 0 : due + overdue;
  const paid = Math.min(principal + contractualInterest, Math.max(0,
    cohort.nextPaymentAmount ?? planned));
  cohort.nextPaymentAmount = undefined;
  cohort.overduePaymentAmount = Math.max(0, due + overdue - paid);
  cohort.daysPastDue = cohort.overduePaymentAmount > 1e-6
    ? Math.min(120, (cohort.daysPastDue ?? 0) + 30) : 0;
  cohort.outstandingPrincipal = Math.max(0, principal + contractualInterest - paid);
  cohort.paymentHistory ??= [];
  cohort.paymentHistory.push({
    step, scheduledDue: due, received: paid,
    overdueAtClose: cohort.overduePaymentAmount,
    daysPastDueAtClose: cohort.daysPastDue,
    closingContractualPrincipal: cohort.outstandingPrincipal,
  });
  if (cohort.paymentHistory.length > 36) cohort.paymentHistory.splice(0, cohort.paymentHistory.length - 36);
  (state.borrowerPaymentHistory ??= {})[cohort.borrowerId] =
    cohort.paymentHistory.map(record => ({ ...record }));
  return { paid, principalCollected: Math.max(0, paid - contractualInterest),
    defaultAtClose: cohort.daysPastDue >= 90 };
};

/** Cohort representation of one borrower; the existing loan ledger owns cash and repayment. */
export const createBorrowerLoan = (
  state: BankState,
  args: { borrowerId: string; productType: ProductType; principal: number;
    annualInterestRate: number; annualPd: number; lgd: number; termMonths: number },
): LoanCohort => {
  if (!args.borrowerId.trim() || args.borrowerId.length > 80 ||
    Object.values(state.loanCohorts).some(cohorts => (cohorts ?? [])
      .some(cohort => cohort.borrowerId === args.borrowerId)))
    throw new Error('Borrower ID must be unique and non-empty');
  if (![args.principal, args.annualInterestRate, args.annualPd, args.lgd].every(Number.isFinite) ||
    args.principal <= 0 || args.annualInterestRate < 0 ||
    args.annualPd < 0 || args.annualPd >= 1 || args.lgd < 0 || args.lgd > 1 ||
    !Number.isInteger(args.termMonths) || args.termMonths < 1 || args.termMonths > 420)
    throw new Error('Invalid borrower loan parameters');
  const existing = state.loanCohorts[args.productType] ?? [];
  // Pool origination uses simulation step as a positive cohort ID. Keep
  // individually serviced borrower IDs in a separate negative namespace.
  let id = -1_000_000;
  while (existing.some(cohort => cohort.cohortId === id)) id--;
  const cohort: LoanCohort = {
    productType: args.productType, cohortId: id, originationStep: state.time.step + 1,
    borrowerId: args.borrowerId,
    paymentHistory: [], overduePaymentAmount: 0, daysPastDue: 0,
    originalPrincipal: args.principal, outstandingPrincipal: args.principal,
    annualInterestRate: args.annualInterestRate, annualPd: args.annualPd,
    sicrReferenceAnnualPd: args.annualPd, effectiveAnnualPd: args.annualPd,
    lgd: args.lgd, termMonths: args.termMonths, ageMonths: 0,
    stage: 'stage1', affordabilityIndex: 1,
  };
  (state.loanCohorts[args.productType] ??= []).push(cohort);
  return cohort;
};
