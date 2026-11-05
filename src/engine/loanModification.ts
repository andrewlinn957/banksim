import type { LoanCohort } from '../domain/loanCohorts';
import type { BankState } from '../domain/bankState';
import type { LoanProductType } from '../products/capabilities';
import { syncLoanBalancesFromCohorts } from './loanCohorts';

const requireFinite = (n: number, name: string): void => {
  if (!Number.isFinite(n) || n < 0) throw new Error(name + ' must be a non-negative finite number');
};

/** Discount an equal-payment contractual schedule at the instrument's original EIR. */
export const contractualPresentValue = (
  principal: number, annualCoupon: number, discountAnnual: number, months: number,
): number => {
  requireFinite(principal, 'principal');
  requireFinite(annualCoupon, 'annualCoupon');
  requireFinite(discountAnnual, 'discountAnnual');
  if (!Number.isInteger(months) || months < 1 || months > 420) throw new Error('Invalid remaining term');
  const coupon = annualCoupon / 12;
  const discount = discountAnnual / 12;
  const cash = coupon < 1e-12 ? principal / months :
    principal * coupon / (1 - (1 + coupon) ** (-months));
  const annuityFactor = discount < 1e-12 ? months :
    (1 - (1 + discount) ** (-months)) / discount;
  return cash * annuityFactor;
};

/**
 * IFRS 9 5.4.3: non-derecognition modification of a fixed-rate amortising loan.
 * The original EIR and SICR reference are preserved. This function only handles
 * contracts already assessed as not requiring derecognition. Origination fees,
 * modification fees and floating-rate benchmark reform are not modelled.
 */
export const remeasureModifiedCohort = (
  cohort: LoanCohort,
  newAnnualCoupon: number,
  newRemainingMonths: number,
): { modificationGainLoss: number; oldGross: number; modifiedGross: number; originalEir: number } => {
  const originalEir = cohort.originalEffectiveInterestRate ?? cohort.annualInterestRate;
  const oldGross = cohort.outstandingPrincipal + (cohort.modificationAdjustment ?? 0);
  if (cohort.stage === 'stage3' || cohort.unlikelyToPay)
    throw new Error('Stage 3 workouts require a discounted recovery schedule');
  const modifiedGross = contractualPresentValue(
    cohort.outstandingPrincipal, newAnnualCoupon, originalEir, newRemainingMonths);
  const modificationGainLoss = modifiedGross - oldGross;
  cohort.originalEffectiveInterestRate = originalEir;
  cohort.modificationAdjustment = modifiedGross - cohort.outstandingPrincipal;
  cohort.annualInterestRate = newAnnualCoupon;
  cohort.termMonths = cohort.ageMonths + newRemainingMonths;
  return { modificationGainLoss, oldGross, modifiedGross, originalEir };
};

/** Calculate the credit-adjusted EIR at initial recognition of a POCI instrument. */
export const creditAdjustedEffectiveRate = (purchasePrice: number, expectedCashFlowsMonthly: number[]): number => {
  requireFinite(purchasePrice, 'purchasePrice');
  if (purchasePrice <= 0 || expectedCashFlowsMonthly.length < 1 || expectedCashFlowsMonthly.length > 420)
    throw new Error('Invalid POCI initial recognition inputs');
  if (expectedCashFlowsMonthly.some(x => !Number.isFinite(x) || x < 0))
    throw new Error('POCI cash flows must be non-negative and finite');
  if (expectedCashFlowsMonthly.every(x => x === 0)) throw new Error('No POCI recoveries expected');
  const presentValue = (r: number) =>
    expectedCashFlowsMonthly.reduce((sum, v, i) => sum + v / (1 + r) ** (i + 1), 0);
  let lower = -.95, upper = 1;
  while (presentValue(upper) > purchasePrice && upper < 1e6) upper *= 2;
  if (presentValue(lower) < purchasePrice || presentValue(upper) > purchasePrice)
    throw new Error('No stable credit-adjusted EIR for specified price and cash flows');
  for (let i = 0; i < 100; i++) {
    const middle = (lower + upper) / 2;
    if (presentValue(middle) > purchasePrice) lower = middle;
    else upper = middle;
  }
  // Return an annual rate under the same nominal annual/12 convention as BankSim.
  return 12 * (lower + upper) / 2;
};

/**
 * POCI loss allowance records the cumulative *change* in initially expected
 * lifetime losses. Initial lifetime losses are embedded in the credit-adjusted
 * EIR and must not be charged again as day-one ECL.
 */
export const cumulativePociEclChange = (
  initialExpectedCashFlows: number[], revisedExpectedCashFlows: number[], creditAdjustedEir: number,
): number => {
  if (initialExpectedCashFlows.length !== revisedExpectedCashFlows.length ||
    initialExpectedCashFlows.length === 0) throw new Error('Incompatible POCI cash-flow horizons');
  const r = creditAdjustedEir / 12;
  if (!Number.isFinite(r) || r <= -1) throw new Error('Invalid credit-adjusted EIR');
  let change = 0;
  for (let i = 0; i < initialExpectedCashFlows.length; i++) {
    const prior = initialExpectedCashFlows[i], current = revisedExpectedCashFlows[i];
    if (!Number.isFinite(prior) || !Number.isFinite(current) || prior < 0 || current < 0)
      throw new Error('Invalid forecast POCI recoveries');
    change += (prior - current) / (1 + r) ** (i + 1);
  }
  return change;
};

/** Apply the non-derecognition modification to the active simulation loan ledger. */
export const applyLoanModification = (
  state: BankState, productType: LoanProductType, cohortId: number,
  newAnnualCoupon: number, newRemainingMonths: number,
  feeReceived = 0, modificationCostPaid = 0,
): { modificationGainLoss: number; oldGross: number; modifiedGross: number } => {
  const cohort = state.loanCohorts[productType]?.find(c => c.cohortId === cohortId);
  if (!cohort) throw new Error('No loan cohort with this ID');
  if (![feeReceived, modificationCostPaid].every(Number.isFinite) ||
    feeReceived < 0 || modificationCostPaid < 0) throw new Error('Invalid modification fees');
  const cash = state.financial.balanceSheet.items
    .find(item => item.productType === 'CashReserves');
  // Validate cash before mutating the cohort; rejected actions are atomic.
  if ((feeReceived > 0 || modificationCostPaid > 0) &&
      (!cash || cash.balance + feeReceived < modificationCostPaid))
    throw new Error('Insufficient cash for modification costs');
  const result = remeasureModifiedCohort(cohort, newAnnualCoupon, newRemainingMonths);
  // Capitalise integral costs and origination/modification fees over the new term.
  // The separate modification gain/loss remains discounted at original EIR.
  if (feeReceived > 0 || modificationCostPaid > 0) {
    const amount = modificationCostPaid - feeReceived;
    cash.balance -= amount;
    cohort.modificationAdjustment = (cohort.modificationAdjustment ?? 0) + amount;
    const contractualMonthlyPayment = newAnnualCoupon === 0
      ? cohort.outstandingPrincipal / newRemainingMonths :
        cohort.outstandingPrincipal * (newAnnualCoupon / 12) /
        (1 - (1 + newAnnualCoupon / 12) ** -newRemainingMonths);
    cohort.postModificationEffectiveRate = creditAdjustedEffectiveRate(
      cohort.outstandingPrincipal + (cohort.modificationAdjustment ?? 0),
      Array.from({ length: newRemainingMonths }, () => contractualMonthlyPayment),
    );
  } else {
    cohort.postModificationEffectiveRate = result.originalEir;
  }
  state.pendingLoanModificationGainLoss = (state.pendingLoanModificationGainLoss ?? 0) + result.modificationGainLoss;
  syncLoanBalancesFromCohorts(state);
  return result;
};

/**
 * Derecognition requires a separate legal assessment of expiry or qualifying
 * transfer of contractual cash-flow rights. IFRS 9 has no automatic asset 10%
 * quantitative test. The provision close releases existing funded ECL; this
 * action recognises proceeds minus GROSS amortised cost, avoiding double count.
 */
export const derecognizeLoanCohort = (
  state: BankState, productType: LoanProductType, cohortId: number,
  event: 'rightsExpired' | 'qualifyingTransfer', cashConsideration: number,
  feeReceived = 0, transactionCostPaid = 0,
): { gainLossBeforeAllowanceRelease: number; oldGross: number; netCash: number } => {
  if (!['rightsExpired', 'qualifyingTransfer'].includes(event))
    throw new Error('A legally assessed derecognition event is required');
  for (const [name, amount] of Object.entries({ cashConsideration, feeReceived, transactionCostPaid })) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid '+name);
  }
  const cohorts = state.loanCohorts[productType];
  const index = cohorts?.findIndex(cohort => cohort.cohortId === cohortId) ?? -1;
  if (index < 0 || !cohorts) throw new Error('No contract for derecognition');
  const cohort = cohorts[index];
  if (cohort.borrowerId && (cohort.daysPastDue ?? 0) >= 90)
    throw new Error('Defaulted borrower loans require workout resolution');
  const cash = state.financial.balanceSheet.items.find(item => item.productType === 'CashReserves');
  const netCash = cashConsideration + feeReceived - transactionCostPaid;
  if (!cash || cash.balance + netCash < 0) throw new Error('Insufficient cash for transfer costs');
  const oldGross = cohort.outstandingPrincipal + (cohort.modificationAdjustment ?? 0);
  cash.balance += netCash;
  cohorts.splice(index, 1);
  const gainLossBeforeAllowanceRelease = netCash - oldGross;
  state.pendingLoanDerecognitionGainLoss =
    (state.pendingLoanDerecognitionGainLoss ?? 0) + gainLossBeforeAllowanceRelease;
  syncLoanBalancesFromCohorts(state);
  return { gainLossBeforeAllowanceRelease, oldGross, netCash };
};
