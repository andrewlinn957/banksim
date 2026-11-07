import { cohortEcl, workoutRecoveryEstimator, workoutPresentValue } from './impairment';
import { pociBalances, stepPociAssets } from './poci';
import { serviceBorrowerLoan } from './borrowerServicing';
import { advanceCohortArrears, cohortArrearsGross, cohortArrearsStage2Gross, accrueOverdueInterest } from './delinquency';
/**
 * Loan cohort "engine" logic.
 *
 * This module contains the runtime functions that manage loan cohorts inside a
 * `BankState` during the simulation:
 * - originating new loans (funded from cash)
 * - stepping cohorts forward in time (payments, interest, defaults, write-downs)
 * - generating an initial "seasoned" portfolio (already part-way through term)
 *
 * TypeScript note: many functions take a single `args: { ... }` object parameter.
 * This makes call sites clearer (named fields) and supports optional fields like
 * `termMonths?: number`.
 *
 * Side effects: many functions mutate the passed-in `BankState` (loan cohort
 * arrays, cash balance, and balance-sheet item balances). No file/network I/O.
 */
import { BalanceSheetItem } from '../domain/balanceSheet';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import type { AffordabilityDynamicsParameters } from '../domain/config';
import { AssetProductType, ProductType } from '../domain/enums';
import {
  LoanCohort,
  LoanGeography,
  LoanSector,
  LoanStage,
  LoanWorkoutBucket,
} from '../domain/loanCohorts';
import { canonicalLoanGeography, UK_ITL1_REGIONS } from '../domain/ukItl1';
import { PRODUCTS } from '../products/catalogue';

// Used to convert annual rates/PDs into monthly equivalents.
const MONTHS_IN_YEAR = 12;
// Safety cap: prevents unrealistic/buggy terms from creating extreme math.
const MAX_TERM_MONTHS_CAP = 420;
const LOAN_SECTORS: LoanSector[] = [
  'retailMortgage',
  'consumer',
  'commercialRealEstate',
  'sme',
  'largeCorporate',
  'other',
];
const LOAN_GEOGRAPHIES: LoanGeography[] = [
  ...UK_ITL1_REGIONS,
  // Legacy values are accepted during load/validation and canonicalised below.
  'south',
  'midlands',
  'north',
  'other',
];

/**
 * Clamp a number into the inclusive range `[min, max]`.
 *
 */
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Find a balance-sheet line item for a given `productType`.
 *
 */
const findItem = (state: BankState, productType: ProductType): BalanceSheetItem | undefined =>
  state.financial.balanceSheet.items.find((i) => i.productType === productType);

/**
 * Convenience helper to get the cash reserves line item.
 *
 */
const getCashItem = (state: BankState): BalanceSheetItem | undefined =>
  state.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CashReserves);

/**
 * Check whether a `ProductType` is treated as a loan in our product metadata.
 *
 */
const isLoanProduct = (productType: ProductType): boolean => Boolean(PRODUCTS[productType]?.behaviour?.isLoan);

/**
 * Result returned by `stepLoanCohorts(...)` for one simulation step.
 *
 */
export interface LoanCohortStepResult {
  loanInterestIncome: number;
  loanInterestIncomeByProduct: Partial<Record<ProductType, number>>;
  nonCashInterest: number;
  nonCashInterestByProduct: Partial<Record<ProductType, number>>;
  recognizedLoanLosses: Partial<Record<ProductType, number>>;
  /** One-off loan write-downs from shocks; separate from workout charge-offs and ECL movements. */
  oneOffLoanWriteDownsByProduct: Partial<Record<ProductType, number>>;
  defaultedPrincipal: number;
  defaultsByProduct: Partial<Record<ProductType, number>>;
  defaultsByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number; stage?: LoanStage }>;
  renewedPrincipal: number;
  renewalsByProduct: Partial<Record<ProductType, number>>;
  prepaidPrincipal: number;
  prepaymentsByProduct: Partial<Record<ProductType, number>>;
  scheduledRepaymentsByProduct: Partial<Record<ProductType, number>>;
  recoveryCash: number;
  recoveriesByProduct: Partial<Record<ProductType, number>>;
  recoveriesByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number }>;
  realizedLossesByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number }>;
  resolvedWorkoutPrincipal: number;
  selectionPressureNotional: number;
  selectionPressureIndex: number;
}

export interface ProvisionTarget {
  stage1: number;
  stage2: number;
  stage3: number;
  total: number;
}

/**
 * A tiny seeded random number generator (RNG) interface.
 *
 */
export interface SeededRng {
  seed: number;
  uniform: () => number;
  normal: () => number;
}

/**
 * Create a deterministic (seeded) RNG used for repeatable simulations.
 *
 */
export const createSeededRng = (seed: number): SeededRng => {
  // `| 0` is a common JavaScript trick to coerce a number into a signed 32-bit int.
  let s = seed | 0;
  // Xorshift needs a non-zero state; pick a default constant if we were given 0.
  if (s === 0) s = 0x6d2b79f5;

  const nextUint32 = (): number => {
    // Xorshift32: cheap PRNG using bitwise XOR + shifts on a 32-bit state.
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    // `>>> 0` converts the signed 32-bit int into an unsigned 32-bit int in JS.
    return s >>> 0;
  };

  // Uniform random in [0, 1) by dividing by 2^32.
  const uniform = (): number => nextUint32() / 0x1_0000_0000;

  const normal = (): number => {
    // Box–Muller transform: turn two uniforms into one standard normal (mean 0, sd 1).
    let u1 = 0;
    // Avoid `log(0)` which would be `-Infinity`.
    while (u1 <= 0) u1 = uniform();
    const u2 = uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  return {
    get seed() {
      // Expose the internal state as an unsigned 32-bit number.
      return s >>> 0;
    },
    set seed(v: number) {
      // Keep the same invariants if the caller replaces the seed.
      s = v | 0;
      if (s === 0) s = 0x6d2b79f5;
    },
    uniform,
    normal,
  };
};

/**
 * Infer the original principal (starting balance) from a current outstanding balance.
 *
 * We assume a standard fixed-rate, fully-amortising loan where the borrower pays
 * the same amount each month. Given the loan's age, term, and rate, we can
 * "reverse" the amortisation math to estimate what the original balance was.
 *
 */
export const inferOriginalPrincipalFromOutstanding = (
  outstandingPrincipal: number,
  annualInterestRate: number,
  termMonths: number,
  ageMonths: number
): number => {
  // If there's nothing outstanding, the inferred original is also 0.
  if (outstandingPrincipal <= 0) return 0;
  // Validate inputs early so later math isn't working with NaN/Infinity.
  if (!Number.isFinite(outstandingPrincipal)) throw new Error('Outstanding principal must be finite');
  if (!Number.isFinite(annualInterestRate)) throw new Error('Interest rate must be finite');
  if (!Number.isFinite(termMonths) || termMonths <= 0) throw new Error('termMonths must be a positive integer');
  if (!Number.isFinite(ageMonths) || ageMonths < 0) throw new Error('ageMonths must be a non-negative integer');
  if (ageMonths >= termMonths) throw new Error(`Cannot infer original principal when ageMonths (${ageMonths}) >= termMonths (${termMonths})`);

  // Convert annual to monthly rate. (E.g. 12% annual -> 1% per month, roughly.)
  const r = annualInterestRate / MONTHS_IN_YEAR;
  const n = termMonths;
  const k = ageMonths;

  if (Math.abs(r) < 1e-12) {
    // Near-zero interest: use the simple linear relationship for equal principal repayment.
    const remaining = n - k;
    if (remaining <= 0) throw new Error(`Invalid remaining months (${remaining})`);
    return (outstandingPrincipal * n) / remaining;
  }

  // With interest, use amortisation factors. `powN` and `powK` are (1+r)^n and (1+r)^k.
  const powN = Math.pow(1 + r, n);
  const powK = Math.pow(1 + r, k);
  const denom = powN - powK;
  if (!Number.isFinite(powN) || !Number.isFinite(powK) || !Number.isFinite(denom) || denom <= 0) {
    throw new Error('Failed to infer original principal (invalid amortisation factors)');
  }

  // Derivation comes from the closed-form outstanding balance of an amortising loan.
  return outstandingPrincipal * ((powN - 1) / denom);
};

/**
 * Get (or lazily create) the loan cohort array for a specific product type.
 *
 */
const getLoanCohortsArray = (state: BankState, productType: ProductType): LoanCohort[] => {
  if (!state.loanCohorts) {
    state.loanCohorts = {};
  }
  const existing = state.loanCohorts[productType];
  if (existing) return existing;
  const created: LoanCohort[] = [];
  state.loanCohorts[productType] = created;
  return created;
};

/**
 * Sum outstanding principal across cohorts.
 *
 */
export const sumLoanOutstanding = (cohorts: readonly LoanCohort[] | undefined): number =>
  (cohorts ?? []).reduce((sum, c) => sum + (c.outstandingPrincipal ?? 0), 0);

/**
 * Update balance-sheet loan item balances so they match the cohort totals.
 *
 */
export const syncLoanBalancesFromCohorts = (state: BankState): void => {
  state.financial.balanceSheet.items.forEach(item => {
    const p = item.productType;
    if (!isLoanProduct(p) || (!state.loanCohorts?.[p] && !state.workoutPipelines?.[p] &&
      !(state.pociAssets ?? []).some(asset => asset.productType === p))) return;
    const gross = (state.loanCohorts?.[p] ?? []).reduce((sum, c) =>
      sum + c.outstandingPrincipal + (c.modificationAdjustment ?? 0), 0) +
      (state.workoutPipelines?.[p] ?? []).reduce((sum, b) =>
        sum + b.defaultedPrincipal + (b.modificationAdjustment ?? 0), 0);
    const purchasedNet = pociBalances(state, p).net;
    item.balance = Math.max(0, gross + purchasedNet - (item.lossAllowance ?? 0));
  });
};

/**
 * Remove cohorts that are effectively finished.
 *
 */
const cleanCohorts = (cohorts: LoanCohort[]): void => {
  // Small epsilon to avoid keeping "dust" balances caused by floating point math.
  const EPS = 1e-2;
  // Iterate backwards so `splice(i, 1)` doesn't shift the remaining indices we still need to visit.
  for (let i = cohorts.length - 1; i >= 0; i--) {
    const c = cohorts[i];
    if (c.outstandingPrincipal <= EPS || c.ageMonths >= c.termMonths) {
      cohorts.splice(i, 1);
    }
  }
};

/**
 * Validate a cohort's numeric fields and basic invariants.
 *
 */
const validateCohort = (cohort: LoanCohort, maxTermMonths: number): void => {
  if (!Number.isFinite(cohort.outstandingPrincipal) || cohort.outstandingPrincipal < 0) {
    throw new Error(`Invalid outstandingPrincipal for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (!Number.isFinite(cohort.originalPrincipal) || cohort.originalPrincipal < 0) {
    throw new Error(`Invalid originalPrincipal for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (!Number.isFinite(cohort.annualInterestRate) || cohort.annualInterestRate < 0) {
    throw new Error(`Invalid annualInterestRate for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (!Number.isFinite(cohort.termMonths) || !Number.isInteger(cohort.termMonths) || cohort.termMonths <= 0) {
    throw new Error(`Invalid termMonths for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (cohort.termMonths > maxTermMonths || cohort.termMonths > MAX_TERM_MONTHS_CAP) {
    throw new Error(
      `Cohort termMonths (${cohort.termMonths}) exceeds max (${Math.min(maxTermMonths, MAX_TERM_MONTHS_CAP)}) for ${cohort.productType}/${cohort.cohortId}`
    );
  }
  if (!Number.isFinite(cohort.ageMonths) || !Number.isInteger(cohort.ageMonths) || cohort.ageMonths < 0) {
    throw new Error(`Invalid ageMonths for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (cohort.ageMonths >= cohort.termMonths) {
    throw new Error(`Cohort ageMonths (${cohort.ageMonths}) >= termMonths (${cohort.termMonths}) for ${cohort.productType}/${cohort.cohortId}`);
  }
  if (!Number.isFinite(cohort.annualPd) || cohort.annualPd < 0) {
    throw new Error(`Invalid annualPd for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (!Number.isFinite(cohort.lgd) || cohort.lgd < 0 || cohort.lgd > 1) {
    throw new Error(`Invalid lgd for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (
    cohort.affordabilityIndex !== undefined &&
    (!Number.isFinite(cohort.affordabilityIndex) || cohort.affordabilityIndex <= 0)
  ) {
    throw new Error(`Invalid affordabilityIndex for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (
    cohort.renewalCount !== undefined &&
    (!Number.isFinite(cohort.renewalCount) || cohort.renewalCount < 0)
  ) {
    throw new Error(`Invalid renewalCount for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (!cohort.stage || !['stage1', 'stage2', 'stage3'].includes(cohort.stage)) {
    throw new Error(`Invalid stage for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (cohort.sector !== undefined && !isValidSector(cohort.sector)) {
    throw new Error(`Invalid sector for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
  if (cohort.geography !== undefined && !isValidGeography(cohort.geography)) {
    throw new Error(`Invalid geography for cohort ${cohort.productType}/${cohort.cohortId}`);
  }
};

const normaliseStage = (stage: LoanStage | undefined): LoanStage => {
  if (stage === 'stage1' || stage === 'stage2' || stage === 'stage3') return stage;
  return 'stage1';
};

const getMaxTermMonths = (config: SimulationConfig, productType: ProductType): number => {
  const params = config.productParameters[productType];
  const maxFromConfig = params?.loan?.maxTermMonths ?? MAX_TERM_MONTHS_CAP;
  return Math.min(MAX_TERM_MONTHS_CAP, maxFromConfig);
};

const getDefaultTermMonths = (config: SimulationConfig, productType: ProductType): number => {
  const params = config.productParameters[productType];
  const defaultTerm = params?.loan?.defaultTermMonths;
  if (!defaultTerm) {
    throw new Error(`Missing loan.defaultTermMonths for ${productType}`);
  }
  return defaultTerm;
};

const isValidSector = (value: LoanSector | undefined): value is LoanSector =>
  value !== undefined && LOAN_SECTORS.includes(value);

const isValidGeography = (value: LoanGeography | undefined): value is LoanGeography =>
  value !== undefined && LOAN_GEOGRAPHIES.includes(value);

const fallbackSectorForProduct = (productType: ProductType): LoanSector =>
  productType === AssetProductType.Mortgages ? 'retailMortgage' : productType === AssetProductType.ConsumerLoans ? 'consumer' : 'sme';

const fallbackGeographyForCohort = (cohortId: number): LoanGeography =>
  UK_ITL1_REGIONS[Math.abs(Math.floor(cohortId)) % UK_ITL1_REGIONS.length];

const normaliseSector = (productType: ProductType, cohortId: number, sector: LoanSector | undefined): LoanSector =>
  isValidSector(sector) ? sector : fallbackSectorForProduct(productType);

const normaliseGeography = (
  cohortId: number,
  geography: LoanGeography | undefined
): LoanGeography => canonicalLoanGeography(geography, cohortId);

export const upsertOriginationCohort = (args: {
  state: BankState;
  config: SimulationConfig;
  productType: ProductType;
  cohortId: number;
  principal: number;
  annualInterestRate: number;
  termMonths?: number;
  annualPd: number;
  lgd: number;
}): number => {
  const { state, config, productType, cohortId } = args;
  if (!isLoanProduct(productType)) return 0;

  const principal = Math.max(0, args.principal);
  if (principal <= 0) return 0;

  const cash = getCashItem(state);
  const availableCash = Math.max(0, cash?.balance ?? 0);
  const fundedPrincipal = Math.min(principal, availableCash);
  if (fundedPrincipal <= 0) return 0;

  const maxTermMonths = getMaxTermMonths(config, productType);
  const termMonths = Math.min(maxTermMonths, args.termMonths ?? getDefaultTermMonths(config, productType));
  if (termMonths <= 0) throw new Error(`Invalid termMonths for origination: ${termMonths}`);

  const cohorts = getLoanCohortsArray(state, productType);
  const existing = cohorts.find((c) => c.cohortId === cohortId);

  if (!cash) {
    throw new Error('Missing cash line item; cannot originate loans');
  }
  cash.balance -= fundedPrincipal;

  if (existing) {
    const w0 = Math.max(0, existing.outstandingPrincipal);
    const w1 = fundedPrincipal;
    const w = w0 + w1;
    existing.outstandingPrincipal += fundedPrincipal;
    existing.originalPrincipal += fundedPrincipal;
    existing.annualInterestRate = w > 0 ? (existing.annualInterestRate * w0 + args.annualInterestRate * w1) / w : args.annualInterestRate;
    existing.sicrReferenceAnnualPd = w > 0 ? ((existing.sicrReferenceAnnualPd ?? existing.annualPd) * w0 + args.annualPd * w1) / w : args.annualPd;
    existing.annualPd = w > 0 ? (existing.annualPd * w0 + args.annualPd * w1) / w : args.annualPd;
    existing.lgd = w > 0 ? (existing.lgd * w0 + args.lgd * w1) / w : args.lgd;
    existing.termMonths = Math.max(existing.termMonths, termMonths);
    existing.ageMonths = Math.min(existing.ageMonths, 0);
    const baseAffordability = existing.affordabilityIndex ?? 1;
    existing.affordabilityIndex = clamp((baseAffordability * w0 + 1 * w1) / Math.max(1e-9, w), 0.5, 3);
    existing.renewalCount = existing.renewalCount ?? 0;
    existing.stage = normaliseStage(existing.stage);
    existing.sector = normaliseSector(productType, cohortId, existing.sector);
    existing.geography = normaliseGeography(cohortId, existing.geography);
  } else {
    cohorts.push({
      productType,
      cohortId,
      originationStep: state.time.step + 1,
      originalPrincipal: fundedPrincipal,
      outstandingPrincipal: fundedPrincipal,
      annualInterestRate: Math.max(0, args.annualInterestRate),
      termMonths,
      ageMonths: 0,
      annualPd: Math.max(0, args.productType === AssetProductType.Mortgages ? args.annualPd * (1 + Math.max(0, (state.behaviour.mortgagePolicy?.maxLtv ?? .85) - .75) * 1.6) : args.annualPd),
      lgd: args.productType === AssetProductType.Mortgages ? clamp(args.lgd + Math.max(0, (state.behaviour.mortgagePolicy?.maxLtv ?? .85) - .75) * .8, 0, .95) : clamp(args.lgd, 0, 1),
      ltv: args.productType === AssetProductType.Mortgages ? (state.behaviour.mortgagePolicy?.maxLtv ?? .85) : undefined,
      fixedPeriodMonths: args.productType === AssetProductType.Mortgages ? (state.behaviour.mortgagePolicy?.fixedPeriodMonths ?? 24) : undefined,
      affordabilityIndex: 1,
      renewalCount: 0,
      stage: 'stage1',
      sector: normaliseSector(productType, cohortId, undefined),
      geography: normaliseGeography(cohortId, undefined),
    });
  }

  cleanCohorts(cohorts);
  syncLoanBalancesFromCohorts(state);
  return fundedPrincipal;
};

export const applyExtraPrepayment = (args: {
  state: BankState;
  productType: ProductType;
  amount: number;
}): number => {
  const { state, productType } = args;
  if (!isLoanProduct(productType)) return 0;

  const cohorts = getLoanCohortsArray(state, productType);
  const totalOutstanding = sumLoanOutstanding(cohorts);
  const requested = Math.max(0, args.amount);
  const actual = Math.min(requested, totalOutstanding);
  if (actual <= 0) return 0;

  let remaining = actual;
  const EPS = 1e-9;
  for (let i = 0; i < cohorts.length; i++) {
    const c = cohorts[i];
    if (remaining <= EPS) break;
    const base = i === cohorts.length - 1 ? remaining : (actual * c.outstandingPrincipal) / totalOutstanding;
    const reduction = Math.min(c.outstandingPrincipal, Math.max(0, base));
    c.outstandingPrincipal -= reduction;
    remaining -= reduction;
  }

  const cash = getCashItem(state);
  if (!cash) throw new Error('Missing cash line item; cannot apply prepayment');
  cash.balance += actual;

  cleanCohorts(cohorts);
  syncLoanBalancesFromCohorts(state);
  return actual;
};

const monthlyPayment = (outstandingPrincipal: number, annualRate: number, remainingMonths: number): number => {
  if (remainingMonths <= 0) return outstandingPrincipal;
  const r = annualRate / MONTHS_IN_YEAR;
  if (Math.abs(r) < 1e-12) return outstandingPrincipal / remainingMonths;
  const denom = 1 - Math.pow(1 + r, -remainingMonths);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return outstandingPrincipal;
  return (outstandingPrincipal * r) / denom;
};

/** Lifetime default risk over the same remaining contractual period. */
export const remainingLifetimeDefaultRisk = (annualPd: number, monthsRemaining: number): number =>
  1 - (1 - clamp(annualPd, 0, .999999)) ** (Math.max(1, monthsRemaining) / 12);

/** Lifetime default risk over the same remaining contractual period. */
export const remainingLifetimeDefaultRisk = (annualPd: number, monthsRemaining: number): number =>
  1 - (1 - clamp(annualPd, 0, .999999)) ** (Math.max(1, monthsRemaining) / 12);

/**
 * Move the affordability index toward a bounded stress target.
 * The baseline setting is a small neutral level offset; macro and payment stresses
 * affect the target instead of adding another permanent monthly increment.
 */
export const nextAffordabilityIndex = (args: {
  currentIndex: number;
  annualInterestRate: number;
  benchmarkRate: number;
  baseRate: number;
  unemploymentRate: number;
  gdpGrowthMoM: number;
  parameters: AffordabilityDynamicsParameters;
}): number => {
  const p = args.parameters;
  const current = clamp(args.currentIndex, p.minIndex, p.maxIndex);
  const stressOffset =
    p.couponGapSensitivity * Math.max(0, args.annualInterestRate - args.benchmarkRate) +
    p.policyRateSensitivity * Math.max(0, args.baseRate - 0.02) +
    p.unemploymentSensitivity * Math.max(0, args.unemploymentRate - 0.05) +
    p.gdpContractionSensitivity * Math.max(0, -args.gdpGrowthMoM);
  const target = clamp(1 + p.baselineDriftMonthly + stressOffset, p.minIndex, p.maxIndex);
  const recoverySpeed = clamp(p.recoverySpeedMonthly, 0, 1);
  return clamp(current + recoverySpeed * (target - current), p.minIndex, p.maxIndex);
};

/** SICR compares remaining lifetime default risk with its origination expectation. */
export const updateCohortStage = (cohort: LoanCohort, config: SimulationConfig): LoanStage => {
  if (cohort.stage === 'stage3') return 'stage3';
  if ((cohort.daysPastDue ?? 0) >= 90 || cohort.unlikelyToPay === true) {
    cohort.sicrCureMonths = 0;
    return 'stage3';
  }
  const remainingMonths = Math.max(1, cohort.termMonths - cohort.ageMonths);
  const reference = remainingLifetimeDefaultRisk(cohort.sicrReferenceAnnualPd ?? cohort.annualPd, remainingMonths);
  const current = remainingLifetimeDefaultRisk(cohort.effectiveAnnualPd ?? cohort.annualPd, remainingMonths);
  const ratio = current / Math.max(1e-9, reference);
  const increase = current - reference;
  const parameters = config.behaviour.ifrs9;
  const threshold = parameters?.sicrPdMultiplierThreshold ?? 1.75;
  const minimumIncrease = Math.max(0, parameters?.sicrMinLifetimeRiskIncrease ?? 0.01);
  const absoluteIncrease = Math.max(0, parameters?.sicrAbsoluteLifetimeRiskIncrease ?? 0.05);
  const cureRatio = Math.min(threshold, parameters?.sicrCurePdMultiplier ?? 1.25);
  const cureMaxIncrease = Math.max(0, parameters?.sicrCureMaxLifetimeRiskIncrease ?? 0.02);
  const cureMonths = Math.max(1, Math.round(parameters?.sicrCureMonths ?? 3));
  const relativeSicr = ratio >= threshold && increase >= minimumIncrease;
  // IFRS 9's more-than-30-days-past-due SICR presumption remains a backstop.
  if (relativeSicr || increase >= absoluteIncrease || (cohort.daysPastDue ?? 0) > 30) {
    cohort.sicrCureMonths = 0;
    return 'stage2';
  }
  if (cohort.stage === 'stage2') {
    const improvedEnough = ratio <= cureRatio && increase <= cureMaxIncrease;
    cohort.sicrCureMonths = improvedEnough ? (cohort.sicrCureMonths ?? 0) + 1 : 0;
    if (cohort.sicrCureMonths < cureMonths) return 'stage2';
  }
  cohort.sicrCureMonths = 0;
  return 'stage1';
};

const getLoanBenchmarkRate = (state: BankState, productType: ProductType): number => {
  const benchmark = PRODUCTS[productType]?.behaviour?.loanBenchmark;
  if (benchmark === 'mortgage') return state.market.competitorMortgageRate;
  if (benchmark === 'consumer') return state.market.competitorConsumerLoanRate;
  return state.market.riskFreeLong + state.market.corporateLoanSpread;
};

const calculateAdverseSelectionMultiplier = (args: {
  offeredRate: number;
  benchmarkRate: number;
  threshold: number;
  slope: number;
  maxMultiplier: number;
  underwritingTightness: number;
  underwritingInteractionWeight: number;
}): { multiplier: number; ratePremium: number } => {
  const ratePremium = Math.max(0, args.offeredRate - args.benchmarkRate);
  const effectivePremium = Math.max(0, ratePremium - Math.max(0, args.threshold));
  const baseMultiplier = 1 + Math.max(0, args.slope) * effectivePremium;
  const looseUnderwriting = 1 - clamp(args.underwritingTightness, 0, 1);
  const interactionBoost =
    1 + Math.max(0, args.underwritingInteractionWeight) * effectivePremium * 10 * looseUnderwriting;
  const multiplier = clamp(baseMultiplier * interactionBoost, 1, Math.max(1, args.maxMultiplier));
  return { multiplier, ratePremium };
};

const nextCohortId = (cohorts: LoanCohort[]): number =>
  cohorts.reduce((max, cohort) => Math.max(max, Math.floor(cohort.cohortId)), 0) + 1;

const getWorkoutBucketsArray = (state: BankState, productType: ProductType): LoanWorkoutBucket[] => {
  if (!state.workoutPipelines) {
    state.workoutPipelines = {};
  }
  const existing = state.workoutPipelines[productType];
  if (existing) return existing;
  const created: LoanWorkoutBucket[] = [];
  state.workoutPipelines[productType] = created;
  return created;
};

const addWorkoutBucket = (state: BankState, productType: ProductType, incoming: LoanWorkoutBucket): void => {
  const buckets = getWorkoutBucketsArray(state, productType);
  const sector = incoming.sector ?? fallbackSectorForProduct(productType);
  const geography = incoming.geography ?? fallbackGeographyForCohort(incoming.sourceCohortId);
  const incomingVintageMix = incoming.vintageBreakdown?.map((vintage) => ({ ...vintage })) ?? [
    { originationStep: incoming.originationStep ?? null, defaultedPrincipal: Math.max(0, incoming.defaultedPrincipal) },
  ];
  const existing = buckets.find((bucket) =>
    bucket.monthsToResolution === incoming.monthsToResolution &&
    bucket.stageAtDefault === incoming.stageAtDefault &&
    (bucket.sector ?? fallbackSectorForProduct(productType)) === sector &&
    (bucket.geography ?? fallbackGeographyForCohort(bucket.sourceCohortId)) === geography
  );
  if (!existing) {
    buckets.push({ ...incoming, vintageBreakdown: incomingVintageMix, sector, geography });
    return;
  }

  const oldPrincipal = Math.max(0, existing.defaultedPrincipal);
  const newPrincipal = Math.max(0, incoming.defaultedPrincipal);
  const combined = oldPrincipal + newPrincipal;
  if (combined <= 0) return;
  existing.defaultedPrincipal = combined;
  existing.modificationAdjustment = (existing.modificationAdjustment ?? 0) + (incoming.modificationAdjustment ?? 0);
  existing.expectedRecoveryRate =
    (existing.expectedRecoveryRate * oldPrincipal + incoming.expectedRecoveryRate * newPrincipal) / combined;
  existing.effectiveInterestRate =
    ((existing.effectiveInterestRate ?? 0) * oldPrincipal + (incoming.effectiveInterestRate ?? 0) * newPrincipal) /
    combined;
  const vintageMix = new Map<number | null, number>();
  const existingMix = existing.vintageBreakdown ?? [
    { originationStep: existing.originationStep ?? null, defaultedPrincipal: oldPrincipal },
  ];
  [...existingMix, ...incomingVintageMix].forEach((vintage) => {
    vintageMix.set(vintage.originationStep, (vintageMix.get(vintage.originationStep) ?? 0) + Math.max(0, vintage.defaultedPrincipal));
  });
  existing.vintageBreakdown = [...vintageMix].map(([originationStep, defaultedPrincipal]) => ({ originationStep, defaultedPrincipal }));
  existing.originationStep = undefined;
  existing.sector = sector;
  existing.geography = geography;
};

const compactRenewalAdds = (cohorts: LoanCohort[]): LoanCohort[] => {
  if (cohorts.length <= 1) return cohorts;
  const grouped = new Map<string, LoanCohort>();
  cohorts.forEach((cohort) => {
    const sector = cohort.sector ?? fallbackSectorForProduct(cohort.productType);
    const geography = cohort.geography ?? fallbackGeographyForCohort(cohort.cohortId);
    const key = [cohort.productType, cohort.stage, cohort.termMonths, sector, geography,
      cohort.arrears ? 'overdue' : 'current', cohort.daysPastDue ?? 0,
      cohort.originalEffectiveInterestRate ?? 'standard',
      cohort.borrowerId ?? 'portfolio'].join('|');
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...cohort, sector, geography });
      return;
    }

    const oldOutstanding = Math.max(0, existing.outstandingPrincipal);
    const newOutstanding = Math.max(0, cohort.outstandingPrincipal);
    const combined = oldOutstanding + newOutstanding;
    if (combined <= 0) return;
    const weighted = (a: number, b: number): number => (a * oldOutstanding + b * newOutstanding) / combined;
    existing.outstandingPrincipal = combined;
    existing.originalPrincipal += Math.max(0, cohort.originalPrincipal);
    existing.annualInterestRate = weighted(existing.annualInterestRate, cohort.annualInterestRate);
    existing.sicrReferenceAnnualPd = weighted(existing.sicrReferenceAnnualPd ?? existing.annualPd, cohort.sicrReferenceAnnualPd ?? cohort.annualPd);
    existing.sicrCureMonths = Math.min(existing.sicrCureMonths ?? 0, cohort.sicrCureMonths ?? 0);
    existing.annualPd = weighted(existing.annualPd, cohort.annualPd);
    existing.lgd = weighted(existing.lgd, cohort.lgd);
    existing.affordabilityIndex = weighted(existing.affordabilityIndex ?? 1, cohort.affordabilityIndex ?? 1);
    existing.renewalCount = weighted(existing.renewalCount ?? 0, cohort.renewalCount ?? 0);
    existing.effectiveAnnualPd = weighted(
      existing.effectiveAnnualPd ?? existing.annualPd,
      cohort.effectiveAnnualPd ?? cohort.annualPd
    );
    existing.effectiveLgd = weighted(existing.effectiveLgd ?? existing.lgd, cohort.effectiveLgd ?? cohort.lgd);
    existing.modificationAdjustment = (existing.modificationAdjustment ?? 0) + (cohort.modificationAdjustment ?? 0);
    if (cohort.arrears) {
      existing.arrears = {
        days1to30: (existing.arrears?.days1to30 ?? 0) + cohort.arrears.days1to30,
        days31to60: (existing.arrears?.days31to60 ?? 0) + cohort.arrears.days31to60,
        days61to89: (existing.arrears?.days61to89 ?? 0) + cohort.arrears.days61to89,
      };
    }
  });
  return [...grouped.values()];
};


const getAffordabilityConfig = (config: SimulationConfig, productType: ProductType) => {
  const byProduct = config.behaviour.creditRiskDynamics?.affordabilityByProduct?.[productType];
  return {
    baselineDriftMonthly: byProduct?.baselineDriftMonthly ?? 0,
    couponGapSensitivity: byProduct?.couponGapSensitivity ?? 3,
    policyRateSensitivity: byProduct?.policyRateSensitivity ?? 0.5,
    unemploymentSensitivity: byProduct?.unemploymentSensitivity ?? 2.5,
    gdpContractionSensitivity: byProduct?.gdpContractionSensitivity ?? 10,
    recoverySpeedMonthly: byProduct?.recoverySpeedMonthly ?? 0.05,
    pdStressSlope: byProduct?.pdStressSlope ?? 1,
    minIndex: byProduct?.minIndex ?? 0.7,
    maxIndex: byProduct?.maxIndex ?? 3,
    resetShareOnRenewal: byProduct?.resetShareOnRenewal ?? 0.3,
  };
};

const getRefinanceConfig = (config: SimulationConfig, productType: ProductType) => {
  const byProduct = config.behaviour.creditRiskDynamics?.refinanceByProduct?.[productType];
  return {
    minSeasoningMonths: Math.max(0, Math.round(byProduct?.minSeasoningMonths ?? 0)),
    basePrepayRateMonthly: byProduct?.basePrepayRateMonthly ?? 0,
    incentiveSensitivity: byProduct?.incentiveSensitivity ?? 0,
    riskSelectivity: byProduct?.riskSelectivity ?? 0,
    minPrepayRateMonthly: byProduct?.minPrepayRateMonthly ?? 0,
    maxPrepayRateMonthly: byProduct?.maxPrepayRateMonthly ?? 1,
  };
};

const getAdverseSelectionLifecycleConfig = (config: SimulationConfig) => {
  const adverse = config.behaviour.creditRiskDynamics?.adverseSelection;
  return {
    renewalShareMonthly: adverse?.renewalShareMonthly ?? 0,
    renewalEligibilityMonths: Math.max(1, Math.round(adverse?.renewalEligibilityMonths ?? 12)),
    renewalRatePremiumThreshold: adverse?.renewalRatePremiumThreshold ?? 0.005,
    renewalPdSlope: adverse?.renewalPdSlope ?? 16,
    renewalMaxMultiplier: adverse?.renewalMaxMultiplier ?? 2.5,
    underwritingInteractionWeight: adverse?.underwritingInteractionWeight ?? 1,
  };
};

const getWorkoutConfig = (config: SimulationConfig) => {
  const workout = config.behaviour.creditRiskDynamics?.workoutPipeline;
  return {
    baseResolutionLagMonths: Math.max(1, Math.round(workout?.baseResolutionLagMonths ?? 6)),
    stressLagSensitivity: Math.max(0, workout?.stressLagSensitivity ?? 8),
    baseRecoveryRateFloor: clamp(workout?.baseRecoveryRateFloor ?? 0.1, 0, 1),
    macroRecoveryPenaltySensitivity: Math.max(0, workout?.macroRecoveryPenaltySensitivity ?? 1.8),
    concentrationRecoveryPenaltySensitivity: Math.max(
      0,
      workout?.concentrationRecoveryPenaltySensitivity ?? 0.3
    ),
  };
};

const stepWorkoutPipelines = (args: {
  state: BankState;
  config: SimulationConfig;
  cash: BalanceSheetItem;
  recognizedLoanLosses: Partial<Record<ProductType, number>>;
}): {
  recoveryCash: number;
  recoveryCashByProduct: Partial<Record<ProductType, number>>;
  recoveriesByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number }>;
  realizedLossesByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number }>;
  resolvedWorkoutPrincipal: number;
  nonCashInterest: number;
  nonCashInterestByProduct: Partial<Record<ProductType, number>>;
} => {
  const { state, config, cash, recognizedLoanLosses } = args;
  const workoutConfig = getWorkoutConfig(config);
  const products = new Set<ProductType>([
    ...Object.keys(state.workoutPipelines ?? {}),
    ...Object.keys(state.loanCohorts ?? {}),
  ] as ProductType[]);

  let recoveryCash = 0;
  let nonCashInterest = 0;
  let resolvedWorkoutPrincipal = 0;
  const recoveryCashByProduct: Partial<Record<ProductType, number>> = {};
  const nonCashInterestByProduct: Partial<Record<ProductType, number>> = {};
  const recoveriesByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number }> = [];
  const realizedLossesByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number }> = [];

  products.forEach((productType) => {
    if (!PRODUCTS[productType]?.behaviour?.isLoan) return;
    const buckets = getWorkoutBucketsArray(state, productType);
    if (buckets.length === 0) return;

    const recoveryRateFor = workoutRecoveryEstimator(state, config, productType);
    const surviving: LoanWorkoutBucket[] = [];
    buckets.forEach((bucket) => {
      // IFRS 9 5.4.4: derecognise irrecoverable principal as soon as there is no
      // reasonable expectation of recovery, including before legal resolution.
      const expectedRecovery = recoveryRateFor(bucket);
      const threshold = config.behaviour.creditRiskDynamics?.workoutPipeline?.earlyWriteoffRecoveryThreshold ?? 0;
      if (!bucket.earlyWriteoffApplied && bucket.monthsToResolution > 1 &&
          (bucket.noReasonableExpectationOfRecovery === true || expectedRecovery < threshold)) {
        const before = Math.max(0, bucket.defaultedPrincipal);
        const writtenOff = before * (1 - expectedRecovery);
        if (writtenOff > 0) {
          bucket.recoveryPenaltyAtWriteoff = recoveryRateFor.penaltyFor(bucket);
          bucket.defaultedPrincipal = before - writtenOff;
          if (bucket.modificationAdjustment !== undefined) {
            bucket.modificationAdjustment *= bucket.defaultedPrincipal / Math.max(1e-9, before);
          }
          // The remaining contractual balance represents recoverable principal.
          // Further deterioration can still produce losses on final resolution.
          bucket.expectedRecoveryRate = bucket.defaultedPrincipal > 0 ? 1 : 0;
          bucket.earlyWriteoffApplied = true;
          recognizedLoanLosses[productType] = (recognizedLoanLosses[productType] ?? 0) + writtenOff;
          const mix = bucket.vintageBreakdown?.length ? bucket.vintageBreakdown :
            [{ originationStep: bucket.originationStep ?? null, defaultedPrincipal: before }];
          const mixTotal = mix.reduce((sum, v) => sum + Math.max(0, v.defaultedPrincipal), 0);
          mix.forEach(v => {
            const share = mixTotal > 0 ? Math.max(0, v.defaultedPrincipal) / mixTotal : 0;
            if (share > 0) realizedLossesByVintage.push({ productType, originationStep: v.originationStep, amount: writtenOff * share });
          });
        }
      }
      const bucketInterest = workoutPresentValue(state, config, productType, bucket, recoveryRateFor(bucket)) * Math.max(0, bucket.effectiveInterestRate ?? 0) / 12;
      nonCashInterest += bucketInterest;
      nonCashInterestByProduct[productType] = (nonCashInterestByProduct[productType] ?? 0) + bucketInterest;
      const nextMonths = bucket.monthsToResolution - 1;
      if (nextMonths > 0) {
        surviving.push({
          ...bucket,
          monthsToResolution: nextMonths,
        });
        return;
      }

      const principal = Math.max(0, bucket.defaultedPrincipal);
      if (principal <= 0) return;
      const recoveryRate = recoveryRateFor(bucket);
      const recovered = principal * recoveryRate;
      const chargeOff = principal + (bucket.modificationAdjustment ?? 0) - recovered;
      const vintageMix = bucket.vintageBreakdown?.length ? bucket.vintageBreakdown : [
        { originationStep: bucket.originationStep ?? null, defaultedPrincipal: principal },
      ];
      const vintageTotal = vintageMix.reduce((sum, vintage) => sum + Math.max(0, vintage.defaultedPrincipal), 0);
      vintageMix.forEach((vintage) => {
        const share = vintageTotal > 0 ? Math.max(0, vintage.defaultedPrincipal) / vintageTotal : 0;
        if (recovered > 0 && share > 0) {
          recoveriesByVintage.push({ productType, originationStep: vintage.originationStep, amount: recovered * share });
        }
        if (chargeOff > 0 && share > 0) {
          realizedLossesByVintage.push({ productType, originationStep: vintage.originationStep, amount: chargeOff * share });
        }
      });
      if (recovered > 0) {
        cash.balance += recovered;
        recoveryCashByProduct[productType] = (recoveryCashByProduct[productType] ?? 0) + recovered;
      }
      if (chargeOff > 0) {
        recognizedLoanLosses[productType] = (recognizedLoanLosses[productType] ?? 0) + chargeOff;
      }
      recoveryCash += recovered;
      resolvedWorkoutPrincipal += principal;
    });

    state.workoutPipelines[productType] = surviving;
  });

  return { recoveryCash, recoveryCashByProduct, recoveriesByVintage, realizedLossesByVintage, resolvedWorkoutPrincipal, nonCashInterest, nonCashInterestByProduct };
};

const addVintageFlow = <T extends { productType: ProductType; originationStep: number | null; amount: number }>(
  rows: T[],
  productType: ProductType,
  originationStep: number | null,
  amount: number,
  stage?: LoanStage
): void => {
  if (amount <= 0) return;
  const row = rows.find((item) =>
    item.productType === productType &&
    item.originationStep === originationStep &&
    ('stage' in item ? item.stage === stage : stage === undefined)
  );
  if (row) row.amount += amount;
  else rows.push({ productType, originationStep, amount, ...(stage ? { stage } : {}) } as T);
};

export const stepLoanCohorts = (args: {
  state: BankState;
  config: SimulationConfig;
  dtMonths: number;
  pdMultiplier: number;
  lgdMultiplier: number;
  extraLossesByProduct?: Partial<Record<ProductType, number>>;
}): LoanCohortStepResult => {
  const { state, config } = args;
  const dtMonths = Math.max(0, Math.floor(args.dtMonths));
  if (dtMonths === 0) {
    return {
      loanInterestIncome: 0,
      loanInterestIncomeByProduct: {},
      nonCashInterest: 0,
      nonCashInterestByProduct: {},
      recognizedLoanLosses: {},
      oneOffLoanWriteDownsByProduct: {},
      defaultedPrincipal: 0,
      defaultsByProduct: {},
      defaultsByVintage: [],
      renewedPrincipal: 0,
      renewalsByProduct: {},
      prepaidPrincipal: 0,
      prepaymentsByProduct: {},
      scheduledRepaymentsByProduct: {},
      recoveryCash: 0,
      recoveriesByProduct: {},
      recoveriesByVintage: [],
      realizedLossesByVintage: [],
      resolvedWorkoutPrincipal: 0,
      selectionPressureNotional: 0,
      selectionPressureIndex: 0,
    };
  }

  const cash = getCashItem(state);
  if (!cash) throw new Error('Missing cash line item; cannot step loan cohorts');

  const recognizedLoanLosses: Partial<Record<ProductType, number>> = {};
  const oneOffLoanWriteDownsByProduct: Partial<Record<ProductType, number>> = {};
  const loanInterestIncomeByProduct: Partial<Record<ProductType, number>> = {};
  const defaultsByProduct: Partial<Record<ProductType, number>> = {};
  const defaultsByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number; stage?: LoanStage }> = [];
  const renewalsByProduct: Partial<Record<ProductType, number>> = {};
  const prepaymentsByProduct: Partial<Record<ProductType, number>> = {};
  const scheduledRepaymentsByProduct: Partial<Record<ProductType, number>> = {};
  let loanInterestIncome = 0;
  let nonCashInterest = 0;
  let defaultedPrincipal = 0;
  let renewedPrincipal = 0;
  let prepaidPrincipal = 0;
  let recoveryCash = 0;
  let resolvedWorkoutPrincipal = 0;
  let selectionPressureNotional = 0;
  const recoveriesByProduct: Partial<Record<ProductType, number>> = {};
  const recoveriesByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number }> = [];
  const realizedLossesByVintage: Array<{ productType: ProductType; originationStep: number | null; amount: number }> = [];
  const nonCashInterestByProduct: Partial<Record<ProductType, number>> = {};

  for (let m = 0; m < dtMonths; m++) {
    const workoutStep = stepWorkoutPipelines({
      state,
      config,
      cash,
      recognizedLoanLosses,
    });
    recoveryCash += workoutStep.recoveryCash;
    nonCashInterest += workoutStep.nonCashInterest;
    resolvedWorkoutPrincipal += workoutStep.resolvedWorkoutPrincipal;
    Object.entries(workoutStep.recoveryCashByProduct).forEach(([p, value]) => {
      recoveriesByProduct[p as ProductType] = (recoveriesByProduct[p as ProductType] ?? 0) + (value ?? 0);
    });
    Object.entries(workoutStep.nonCashInterestByProduct).forEach(([p, value]) => {
      nonCashInterestByProduct[p as ProductType] = (nonCashInterestByProduct[p as ProductType] ?? 0) + (value ?? 0);
    });
    recoveriesByVintage.push(...workoutStep.recoveriesByVintage);
    realizedLossesByVintage.push(...workoutStep.realizedLossesByVintage);

    const loanProductTypes = new Set<ProductType>([
      ...Object.keys(state.loanCohorts ?? {}),
      ...Object.keys(state.workoutPipelines ?? {}),
    ] as ProductType[]);

    loanProductTypes.forEach((productType) => {
      if (!isLoanProduct(productType)) return;
      const cohorts = getLoanCohortsArray(state, productType);
      const maxTermMonths = getMaxTermMonths(config, productType);
      const concentrationParams = config.behaviour.concentration;
      const concentrationStressActive =
        args.pdMultiplier >= (concentrationParams?.stressActivationPdMultiplier ?? Number.POSITIVE_INFINITY);
      const productOutstanding = sumLoanOutstanding(cohorts);
      const sectorTotals: Partial<Record<LoanSector, number>> = {};
      const geographyTotals: Partial<Record<LoanGeography, number>> = {};
      if (productOutstanding > 0 && concentrationStressActive) {
        cohorts.forEach((cohort) => {
          const exposure = Math.max(0, cohort.outstandingPrincipal ?? 0);
          if (exposure <= 0) return;
          const sector = normaliseSector(productType, cohort.cohortId, cohort.sector);
          const geography = normaliseGeography(cohort.cohortId, cohort.geography);
          sectorTotals[sector] = (sectorTotals[sector] ?? 0) + exposure;
          geographyTotals[geography] = (geographyTotals[geography] ?? 0) + exposure;
        });
      }

      const benchmarkRate = getLoanBenchmarkRate(state, productType);
      const offeredRate = findItem(state, productType)?.interestRate ?? benchmarkRate;
      const underwritingTightness = clamp(state.behaviour.underwritingTightness?.[productType] ?? 0, 0, 1);
      const adverseConfig = getAdverseSelectionLifecycleConfig(config);
      const affordabilityConfig = getAffordabilityConfig(config, productType);
      const refinanceConfig = getRefinanceConfig(config, productType);
      const workoutConfig = getWorkoutConfig(config);
      let nextRenewalCohortId = nextCohortId(cohorts);
      const renewalAdds: LoanCohort[] = [];

      cohorts.forEach((cohort) => {
        if (cohort.outstandingPrincipal <= 0) return;
        // Assess observed arrears before booking this month's contractual interest.
        // An already credit-impaired cohort must use the workout net-interest basis.
        if (!cohort.borrowerId && (cohort.daysPastDue ?? 0) > 0) {
          const baselinePd = cohort.sicrReferenceAnnualPd ?? cohort.annualPd;
          const cured = (cohort.affordabilityIndex ?? 1) <= 1 &&
            (cohort.effectiveAnnualPd ?? cohort.annualPd) <= baselinePd * 1.1;
          cohort.daysPastDue = cured ? 0 : Math.min(120, (cohort.daysPastDue ?? 0) + 30);
          cohort.stage = updateCohortStage(cohort, config);
        } else if (cohort.unlikelyToPay) {
          cohort.stage = 'stage3';
        }
        if (cohort.stage === 'stage3') {
          addWorkoutBucket(state, productType, { productType, sourceCohortId: cohort.cohortId, originationStep: cohort.originationStep, stageAtDefault: 'stage3', defaultedPrincipal: cohort.outstandingPrincipal, modificationAdjustment: cohort.modificationAdjustment ?? 0, expectedRecoveryRate: 1 - (cohort.effectiveLgd ?? cohort.lgd), effectiveInterestRate: cohort.originalEffectiveInterestRate ?? cohort.annualInterestRate, monthsToResolution: Math.max(1, Math.round(workoutConfig.baseResolutionLagMonths)), sector: cohort.sector, geography: cohort.geography });
          defaultedPrincipal += cohort.outstandingPrincipal;
          defaultsByProduct[productType] = (defaultsByProduct[productType] ?? 0) + cohort.outstandingPrincipal;
          addVintageFlow(defaultsByVintage, productType, cohort.originationStep ?? null, cohort.outstandingPrincipal, 'stage3');
          cohort.outstandingPrincipal = 0;
          return;
        }
        if (cohort.ageMonths >= cohort.termMonths) return;
        cohort.stage = normaliseStage(cohort.stage);
        cohort.sector = normaliseSector(productType, cohort.cohortId, cohort.sector);
        cohort.geography = normaliseGeography(cohort.cohortId, cohort.geography);
        cohort.affordabilityIndex = clamp(
          cohort.affordabilityIndex ?? 1,
          affordabilityConfig.minIndex,
          affordabilityConfig.maxIndex
        );
        cohort.renewalCount = cohort.renewalCount ?? 0;
        validateCohort(cohort, maxTermMonths);

        const remainingMonths = cohort.termMonths - cohort.ageMonths;
        const r = cohort.annualInterestRate / MONTHS_IN_YEAR;
        const openingGross = cohort.outstandingPrincipal;
        const manualArrears = !cohort.borrowerId && (cohort.daysPastDue ?? 0) > 0;
        const overdue = manualArrears ? openingGross : Math.min(openingGross, cohortArrearsGross(cohort));
        const performing = Math.max(0, openingGross - overdue);
        const pmt = monthlyPayment(cohort.borrowerId ? openingGross : performing,
          cohort.annualInterestRate, remainingMonths);
        const contractualInterest = openingGross * r;
        const eir = (cohort.postModificationEffectiveRate ??
          cohort.originalEffectiveInterestRate ?? cohort.annualInterestRate) / MONTHS_IN_YEAR;
        const interest = Math.max(0, openingGross + (cohort.modificationAdjustment ?? 0)) * eir;
        const interestCollected = performing * r;
        let principal = 0;
        if (cohort.borrowerId) {
          const borrowerPayment = serviceBorrowerLoan(state, cohort, state.time.step + 1,
            pmt, contractualInterest, cohort.effectiveAnnualPd ?? cohort.annualPd);
          principal = borrowerPayment.principalCollected;
          cash.balance += borrowerPayment.paid;
        } else {
          principal = Math.min(performing, Math.max(0, pmt - interestCollected));
          cohort.outstandingPrincipal -= principal;
          if (manualArrears) {
            cohort.outstandingPrincipal += contractualInterest;
          } else {
            cohort.outstandingPrincipal += accrueOverdueInterest(cohort, r);
            cash.balance += principal + interestCollected;
          }
        }
        if (cohort.modificationAdjustment !== undefined) {
          cohort.modificationAdjustment += interest - contractualInterest;
        }
        loanInterestIncome += interest;
        loanInterestIncomeByProduct[productType] = (loanInterestIncomeByProduct[productType] ?? 0) + interest;
        scheduledRepaymentsByProduct[productType] = (scheduledRepaymentsByProduct[productType] ?? 0) + principal;

        const couponIncentive = Math.max(0, cohort.annualInterestRate - benchmarkRate);
        const baseAnnualPd = config.productParameters[productType]?.baseDefaultRate ?? cohort.annualPd;
        const pdPivot = Math.max(1e-4, baseAnnualPd);
        const relativeRisk = clamp((pdPivot - cohort.annualPd) / pdPivot, -1, 1.5);
        const selectiveFactor = Math.max(0.15, 1 + refinanceConfig.riskSelectivity * relativeRisk);
        const prepayRate =
          !cohort.borrowerId && cohort.ageMonths >= refinanceConfig.minSeasoningMonths
            ? clamp(
                (refinanceConfig.basePrepayRateMonthly +
                  refinanceConfig.incentiveSensitivity * couponIncentive) *
                  selectiveFactor,
                refinanceConfig.minPrepayRateMonthly,
                refinanceConfig.maxPrepayRateMonthly
              )
            : 0;
        const eligibleToPrepay = Math.max(0, cohort.outstandingPrincipal -
          ((cohort.daysPastDue ?? 0) > 0 ? cohort.outstandingPrincipal : cohortArrearsGross(cohort)));
        const prepaid = Math.min(eligibleToPrepay, eligibleToPrepay * prepayRate);
        if (prepaid > 0) {
          cohort.outstandingPrincipal -= prepaid;
          cash.balance += prepaid;
          prepaidPrincipal += prepaid;
          prepaymentsByProduct[productType] = (prepaymentsByProduct[productType] ?? 0) + prepaid;
        }

        const affordabilityIndex = nextAffordabilityIndex({
          currentIndex: cohort.affordabilityIndex ?? 1,
          annualInterestRate: cohort.annualInterestRate,
          benchmarkRate,
          baseRate: state.market.baseRate,
          unemploymentRate: state.market.unemploymentRate,
          gdpGrowthMoM: state.market.gdpGrowthMoM,
          parameters: affordabilityConfig,
        });
        cohort.affordabilityIndex = affordabilityIndex;

        const sectorShare =
          concentrationStressActive && productOutstanding > 0
            ? (sectorTotals[cohort.sector] ?? 0) / productOutstanding
            : 0;
        const geographyShare =
          concentrationStressActive && productOutstanding > 0
            ? (geographyTotals[cohort.geography] ?? 0) / productOutstanding
            : 0;
        const sectorStressMultiplier =
          concentrationParams?.sectorPdMultiplierByStress?.[cohort.sector] ?? 1;
        const geographyStressMultiplier =
          concentrationParams?.geographyPdMultiplierByStress?.[cohort.geography] ?? 1;
        const concentrationMultiplier =
          1 +
          sectorShare * Math.max(0, sectorStressMultiplier - 1) +
          geographyShare * Math.max(0, geographyStressMultiplier - 1);

        const shouldRenew =
          !cohort.borrowerId && cohort.stage !== 'stage3' && cohort.unlikelyToPay !== true &&
          (cohort.daysPastDue ?? 0) <= 30 &&
          adverseConfig.renewalShareMonthly > 0 &&
          remainingMonths <= adverseConfig.renewalEligibilityMonths &&
          cohort.ageMonths > 0 &&
          cohort.outstandingPrincipal > 0;
        if (shouldRenew) {
          const renewalShare = clamp(adverseConfig.renewalShareMonthly, 0, 1);
          const performingForRenewal = Math.max(0, cohort.outstandingPrincipal - cohortArrearsGross(cohort));
          const renewalPrincipal = Math.min(
            performingForRenewal,
            performingForRenewal * renewalShare
          );
          if (renewalPrincipal > 0) {
            const renewalSelection = calculateAdverseSelectionMultiplier({
              offeredRate,
              benchmarkRate,
              threshold: adverseConfig.renewalRatePremiumThreshold,
              slope: adverseConfig.renewalPdSlope,
              maxMultiplier: adverseConfig.renewalMaxMultiplier,
              underwritingTightness,
              underwritingInteractionWeight: adverseConfig.underwritingInteractionWeight,
            });
            const renewalAnnualPd = clamp(
              cohort.annualPd * renewalSelection.multiplier,
              0,
              0.999999
            );
            const renewalAffordability = clamp(
              1 +
                (affordabilityIndex - 1) *
                  (1 - clamp(affordabilityConfig.resetShareOnRenewal, 0, 1)),
              affordabilityConfig.minIndex,
              affordabilityConfig.maxIndex
            );
            const renewalEffectiveAnnualPd = clamp(
              renewalAnnualPd * args.pdMultiplier * concentrationMultiplier *
                clamp(1 + (renewalAffordability - 1) * affordabilityConfig.pdStressSlope, 0.55, 4),
              0,
              0.999999
            );
            cohort.outstandingPrincipal -= renewalPrincipal;
            renewedPrincipal += renewalPrincipal;
            renewalsByProduct[productType] = (renewalsByProduct[productType] ?? 0) + renewalPrincipal;
            selectionPressureNotional += renewalPrincipal * Math.max(0, renewalSelection.multiplier - 1);
            const renewalCohort: LoanCohort = {
              productType,
              cohortId: nextRenewalCohortId++,
              originationStep: state.time.step + 1,
              originalPrincipal: renewalPrincipal,
              outstandingPrincipal: renewalPrincipal,
              annualInterestRate: offeredRate,
              termMonths: getDefaultTermMonths(config, productType),
              ageMonths: 0,
              annualPd: renewalAnnualPd,
              // A renewal represents a new, repriced and screened contract.
              // Anchor SICR to the risk at this new origination, not the old loan's history.
              sicrReferenceAnnualPd: renewalEffectiveAnnualPd,
              sicrCureMonths: 0,
              effectiveAnnualPd: renewalEffectiveAnnualPd,
              effectiveLgd: clamp(cohort.lgd * args.lgdMultiplier, 0, 1),
              lgd: clamp(cohort.lgd, 0, 1),
              affordabilityIndex: renewalAffordability,
              renewalCount: (cohort.renewalCount ?? 0) + 1,
              stage: cohort.stage,
              sector: cohort.sector,
              geography: cohort.geography,
            };
            renewalCohort.stage = updateCohortStage(renewalCohort, config);
            renewalAdds.push(renewalCohort);
          }
        }

        const affordabilityPdMultiplier = clamp(
          1 + (affordabilityIndex - 1) * affordabilityConfig.pdStressSlope,
          0.55,
          4
        );
        const annualPd = clamp(
          cohort.annualPd * args.pdMultiplier * concentrationMultiplier * affordabilityPdMultiplier,
          0,
          0.999999
        );
        cohort.effectiveAnnualPd = annualPd;
        // The first close captures current conditions in the SICR baseline for
        // newly originated loans, including the macro and affordability state.
        if (
          cohort.sicrReferenceAnnualPd === undefined &&
          cohort.ageMonths === 0 &&
          cohort.originationStep === state.time.step + 1
        ) {
          cohort.sicrReferenceAnnualPd = annualPd;
        }
        cohort.effectiveLgd = clamp(cohort.lgd * args.lgdMultiplier, 0, 1);
        cohort.stage = updateCohortStage(cohort, config);

        const pdMonth = 1 - Math.pow(1 - annualPd, 1 / MONTHS_IN_YEAR);
        const arrearsFlow = cohort.borrowerId
          ? { arrearsDefault: 0, directDefaultShare: 0, newArrears: 0 }
          : advanceCohortArrears(cohort, annualPd, config);
        const currentGross = Math.max(0, cohort.outstandingPrincipal - cohortArrearsGross(cohort) - arrearsFlow.arrearsDefault);
        // Direct unlikeliness-to-pay defaults coexist with 90+ arrears defaults;
        // neither flow can default the same principal twice.
        const directDefault = Math.min(currentGross,
          currentGross * pdMonth * arrearsFlow.directDefaultShare);
        const defaulted = cohort.stage === 'stage3' ? cohort.outstandingPrincipal :
          Math.min(cohort.outstandingPrincipal, directDefault + arrearsFlow.arrearsDefault);
        if (defaulted > 0) {
          const allocatedAdjustment = (cohort.modificationAdjustment ?? 0) *
            defaulted / Math.max(1e-9, cohort.outstandingPrincipal);
          if (cohort.modificationAdjustment !== undefined)
            cohort.modificationAdjustment -= allocatedAdjustment;
          cohort.outstandingPrincipal -= defaulted;
          defaultedPrincipal += defaulted;
          defaultsByProduct[productType] = (defaultsByProduct[productType] ?? 0) + defaulted;
          addVintageFlow(defaultsByVintage, productType, cohort.originationStep ?? null, defaulted, cohort.stage);
          const stressedLgd = clamp(cohort.lgd * args.lgdMultiplier, 0, 1);
          const expectedRecoveryRate = clamp(
            1 - stressedLgd,
            workoutConfig.baseRecoveryRateFloor,
            1
          );
          const stressScore =
            Math.max(0, state.market.unemploymentRate - 0.05) +
            Math.max(0, -state.market.gdpGrowthMoM) * 12;
          const lagMultiplier = 1 + workoutConfig.stressLagSensitivity * stressScore;
          const monthsToResolution = Math.max(
            1,
            Math.round(workoutConfig.baseResolutionLagMonths * lagMultiplier)
          );
          addWorkoutBucket(state, productType, {
            productType,
            sourceCohortId: cohort.cohortId,
            originationStep: cohort.originationStep,
            stageAtDefault: cohort.stage,
            defaultedPrincipal: defaulted,
            modificationAdjustment: allocatedAdjustment,
            expectedRecoveryRate,
            effectiveInterestRate: cohort.originalEffectiveInterestRate ?? cohort.annualInterestRate,
            monthsToResolution,
            sector: cohort.sector,
            geography: cohort.geography,
          });
        }

        cohort.ageMonths += 1;
        // An overdue balance does not disappear when its contractual term
        // expires. Move the unpaid residual into a credit-impaired workout.
        if (cohort.ageMonths >= cohort.termMonths && cohort.outstandingPrincipal > 1e-2) {
          const unpaid = cohort.outstandingPrincipal;
          const recoveryRate = clamp(1 - (cohort.effectiveLgd ?? cohort.lgd), workoutConfig.baseRecoveryRateFloor, 1);
          addWorkoutBucket(state, productType, {
            productType, sourceCohortId: cohort.cohortId, originationStep: cohort.originationStep,
            stageAtDefault: 'stage2', defaultedPrincipal: unpaid,
            modificationAdjustment: cohort.modificationAdjustment ?? 0, expectedRecoveryRate: recoveryRate,
            effectiveInterestRate: cohort.originalEffectiveInterestRate ?? cohort.annualInterestRate,
            monthsToResolution: Math.max(1, Math.round(workoutConfig.baseResolutionLagMonths)),
            sector: cohort.sector, geography: cohort.geography,
          });
          defaultedPrincipal += unpaid;
          defaultsByProduct[productType] = (defaultsByProduct[productType] ?? 0) + unpaid;
          addVintageFlow(defaultsByVintage, productType, cohort.originationStep ?? null, unpaid, 'stage2');
          cohort.outstandingPrincipal = 0;
        }
      });

      if (renewalAdds.length > 0) {
        cohorts.push(...compactRenewalAdds(renewalAdds));
      }
      cleanCohorts(cohorts);
    });
  }

  const extraLosses = args.extraLossesByProduct ?? {};
  const extraEntries = Object.entries(extraLosses) as Array<[ProductType, number]>;
  extraEntries.forEach(([productType, loss]) => {
    if (!isLoanProduct(productType)) return;
    if (loss <= 0) return;
    const cohorts = getLoanCohortsArray(state, productType);
    const total = sumLoanOutstanding(cohorts);
    if (total <= 0) return;

    const lossToApply = Math.min(loss, total);
    let remaining = lossToApply;
    for (let i = 0; i < cohorts.length; i++) {
      if (remaining <= 1e-9) break;
      const c = cohorts[i];
      const alloc = i === cohorts.length - 1 ? remaining : (lossToApply * c.outstandingPrincipal) / total;
      const writeDown = Math.min(c.outstandingPrincipal, Math.max(0, alloc));
      c.outstandingPrincipal -= writeDown;
      remaining -= writeDown;
      recognizedLoanLosses[productType] = (recognizedLoanLosses[productType] ?? 0) + writeDown;
      oneOffLoanWriteDownsByProduct[productType] = (oneOffLoanWriteDownsByProduct[productType] ?? 0) + writeDown;
    }
    cleanCohorts(cohorts);
  });

  const pociFlows = stepPociAssets(state, dtMonths);
  loanInterestIncome += pociFlows.interest;
  for (const [product, amounts] of Object.entries(pociFlows.byProduct)) {
    const p = product as ProductType;
    loanInterestIncomeByProduct[p] = (loanInterestIncomeByProduct[p] ?? 0) + amounts.interest;
    // POCI receipts are cash collections, including both capital and coupon.
    scheduledRepaymentsByProduct[p] = (scheduledRepaymentsByProduct[p] ?? 0) + amounts.cash;
  }
  syncLoanBalancesFromCohorts(state);
  const selectionPressureIndex =
    renewedPrincipal > 0 ? selectionPressureNotional / renewedPrincipal : 0;
  return {
    loanInterestIncome,
    loanInterestIncomeByProduct,
    nonCashInterest,
    nonCashInterestByProduct,
    recognizedLoanLosses,
    oneOffLoanWriteDownsByProduct,
    defaultedPrincipal,
    defaultsByProduct,
    defaultsByVintage,
    renewedPrincipal,
    renewalsByProduct,
    prepaidPrincipal,
    prepaymentsByProduct,
    scheduledRepaymentsByProduct,
    recoveryCash,
    recoveriesByProduct,
    recoveriesByVintage,
    realizedLossesByVintage,
    resolvedWorkoutPrincipal,
    selectionPressureNotional,
    selectionPressureIndex,
  };
};

export const assertSeasonedLoanPortfolio = (args: {
  productType: ProductType;
  targetOutstanding: number;
  cohorts: readonly LoanCohort[];
  maxTermMonths: number;
  tolerance?: number;
}): void => {
  const tolerance = args.tolerance ?? Math.max(1e6, args.targetOutstanding * 1e-6);
  if (args.targetOutstanding > 0 && args.cohorts.length === 0) {
    throw new Error(`Seeded cohort array empty for ${args.productType} while target outstanding is non-zero`);
  }
  args.cohorts.forEach((c) => validateCohort(c, args.maxTermMonths));
  const sum = sumLoanOutstanding(args.cohorts);
  const diff = sum - args.targetOutstanding;
  if (Math.abs(diff) > tolerance) {
    throw new Error(
      `Seeded cohort outstanding mismatch for ${args.productType}: sum ${sum.toFixed(2)} vs target ${args.targetOutstanding.toFixed(
        2
      )} (diff ${diff.toFixed(2)})`
    );
  }
};

const smoothWeightsOnce = (weights: number[]): number[] => {
  if (weights.length <= 2) return weights.slice();
  const out = weights.slice();
  for (let i = 0; i < weights.length; i++) {
    const prev = weights[i - 1] ?? weights[i];
    const curr = weights[i];
    const next = weights[i + 1] ?? weights[i];
    out[i] = (prev + curr + next) / 3;
  }
  return out;
};

const normaliseWeights = (weights: number[]): number[] => {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  return weights.map((w) => w / sum);
};

const outstandingFactorAtAgeMonths = (annualInterestRate: number, termMonths: number, ageMonths: number): number => {
  const n = Math.max(1, Math.floor(termMonths));
  const k = clamp(Math.floor(ageMonths), 0, n);
  if (k >= n) return 0;

  const annualRate = Math.max(0, annualInterestRate);
  const r = annualRate / MONTHS_IN_YEAR;
  if (Math.abs(r) < 1e-12) {
    return clamp((n - k) / n, 0, 1);
  }

  const powN = Math.pow(1 + r, n);
  const powK = Math.pow(1 + r, k);
  const denom = powN - 1;
  if (!Number.isFinite(powN) || !Number.isFinite(powK) || !Number.isFinite(denom) || Math.abs(denom) < 1e-12) {
    return clamp((n - k) / n, 0, 1);
  }
  return clamp((powN - powK) / denom, 0, 1);
};

const pickWeighted = <T extends string>(
  rng: SeededRng,
  weights: Array<{ key: T; weight: number }>
): T => {
  const total = weights.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return weights[0].key;
  const draw = rng.uniform() * total;
  let running = 0;
  for (const entry of weights) {
    running += Math.max(0, entry.weight);
    if (draw <= running) return entry.key;
  }
  return weights[weights.length - 1].key;
};

const defaultSectorMix = (productType: ProductType): Array<{ key: LoanSector; weight: number }> => {
  if (productType === AssetProductType.Mortgages) {
    return [{ key: 'retailMortgage', weight: 1 }];
  }
  if (productType === AssetProductType.ConsumerLoans) {
    return [{ key: 'consumer', weight: 1 }];
  }
  return [
    { key: 'sme', weight: 0.55 },
    { key: 'commercialRealEstate', weight: 0.3 },
    { key: 'largeCorporate', weight: 0.1 },
    { key: 'other', weight: 0.05 },
  ];
};

const defaultGeographyMix = (): Array<{ key: LoanGeography; weight: number }> => [
  { key: 'northEast', weight: 0.04 },
  { key: 'northWest', weight: 0.09 },
  { key: 'yorkshireAndTheHumber', weight: 0.07 },
  { key: 'eastMidlands', weight: 0.08 },
  { key: 'westMidlands', weight: 0.10 },
  { key: 'eastOfEngland', weight: 0.08 },
  { key: 'london', weight: 0.28 },
  { key: 'southEast', weight: 0.07 },
  { key: 'southWest', weight: 0.04 },
  { key: 'scotland', weight: 0.08 },
  { key: 'wales', weight: 0.05 },
  { key: 'northernIreland', weight: 0.02 },
];

export const generateSeasonedLoanCohorts = (args: {
  productType: ProductType;
  targetOutstanding: number;
  baseAnnualInterestRate: number;
  baseAnnualPd: number;
  baseLgd: number;
  config: SimulationConfig;
  seed: number;
}): LoanCohort[] => {
  if (!isLoanProduct(args.productType)) return [];
  if (args.targetOutstanding <= 0) return [];

  const loanParams = args.config.productParameters[args.productType]?.loan;
  if (!loanParams?.initialSeasoningEnabled) {
    const seededRng = createSeededRng(args.seed);
    return [
      {
        productType: args.productType,
        cohortId: 0,
        originalPrincipal: args.targetOutstanding,
        outstandingPrincipal: args.targetOutstanding,
        annualInterestRate: Math.max(0, args.baseAnnualInterestRate),
        termMonths: getDefaultTermMonths(args.config, args.productType),
        ageMonths: 0,
      annualPd: Math.max(0, args.baseAnnualPd),
      lgd: clamp(args.baseLgd, 0, 1),
      affordabilityIndex: 1,
      renewalCount: 0,
      stage: 'stage1',
      sector: pickWeighted(seededRng, defaultSectorMix(args.productType)),
      geography: pickWeighted(seededRng, defaultGeographyMix()),
    },
  ];
  }

  const maxTermMonths = getMaxTermMonths(args.config, args.productType);
  const defaultTermMonths = clamp(getDefaultTermMonths(args.config, args.productType), 1, maxTermMonths);
  const buckets = defaultTermMonths;
  if (buckets <= 1) throw new Error('defaultTermMonths too small for seasoning');

  const rng = createSeededRng(args.seed);
  const noiseSd = 0.12;
  const baseCoupon = clamp(args.baseAnnualInterestRate, 0.0001, 0.25);

  let weights = Array.from({ length: buckets }, (_, k) => {
    const base = outstandingFactorAtAgeMonths(baseCoupon, buckets, k);
    const noise = Math.exp(rng.normal() * noiseSd);
    return Math.max(0, base * noise);
  });

  weights = smoothWeightsOnce(smoothWeightsOnce(weights));
  weights = normaliseWeights(weights);

  const minBucket = loanParams.initialMinBucketOutstanding ?? 1e6;
  const couponDispersionBps = loanParams.initialCouponDispersionBps ?? 50;
  const couponSd = couponDispersionBps / 10000;

  const pdRange = loanParams.initialPdMultiplierRange ?? { min: 0.9, max: 1.1 };
  const lgdRange = loanParams.initialLgdMultiplierRange ?? { min: 0.95, max: 1.05 };

  const cohorts: LoanCohort[] = [];
  const kept = weights
    .map((w, ageMonths) => ({ w, ageMonths, outstanding: args.targetOutstanding * w }))
    .filter((b) => b.outstanding >= minBucket);

  if (kept.length === 0) {
    const seededRng = createSeededRng(args.seed + 17);
    const termMonths = clamp(getDefaultTermMonths(args.config, args.productType), 1, maxTermMonths);
    const cohort: LoanCohort = {
      productType: args.productType,
      cohortId: 0,
      originalPrincipal: args.targetOutstanding,
      outstandingPrincipal: args.targetOutstanding,
      annualInterestRate: Math.max(0, args.baseAnnualInterestRate),
      termMonths,
      ageMonths: 0,
      annualPd: Math.max(0, args.baseAnnualPd),
      lgd: clamp(args.baseLgd, 0, 1),
      affordabilityIndex: 1,
      renewalCount: 0,
      stage: 'stage1',
      sector: pickWeighted(seededRng, defaultSectorMix(args.productType)),
      geography: pickWeighted(seededRng, defaultGeographyMix()),
    };
    assertSeasonedLoanPortfolio({
      productType: args.productType,
      targetOutstanding: args.targetOutstanding,
      cohorts: [cohort],
      maxTermMonths,
    });
    return [cohort];
  }

  const keptWeightSum = kept.reduce((s, b) => s + b.w, 0);
  const renormWeights = new Map<number, number>(kept.map((b) => [b.ageMonths, b.w / keptWeightSum]));

  renormWeights.forEach((w, ageMonths) => {
    const outstanding = args.targetOutstanding * w;
    const termMonths = buckets;

    const coupon = clamp(args.baseAnnualInterestRate + rng.normal() * couponSd, 0.0001, 0.25);
    const pdMult = clamp(pdRange.min + (pdRange.max - pdRange.min) * rng.uniform(), 0, 10);
    const lgdMult = clamp(lgdRange.min + (lgdRange.max - lgdRange.min) * rng.uniform(), 0, 10);

    const annualPd = clamp(args.baseAnnualPd * pdMult, 0, 0.999999);
    const lgd = clamp(args.baseLgd * lgdMult, 0, 1);

    const originalPrincipal = inferOriginalPrincipalFromOutstanding(outstanding, coupon, termMonths, ageMonths);
    // A seasoned portfolio has experienced borrower-specific improvement and deterioration.
    // Seed a reproducible risk distribution, then apply the same PD/SICR rule as at monthly close.
    const affordabilityConfig = getAffordabilityConfig(args.config, args.productType);
    const seasoning = Math.min(1, ageMonths / Math.max(1, args.config.behaviour.ifrs9?.initialAffordabilitySeasoningMonths ?? 12));
    const logSd = Math.max(0, args.config.behaviour.ifrs9?.initialAffordabilityLogSd ?? 0.45) * Math.sqrt(seasoning);
    const affordabilityIndex = clamp(Math.exp(rng.normal() * logSd - logSd * logSd / 2), affordabilityConfig.minIndex, affordabilityConfig.maxIndex);
    const effectiveAnnualPd = clamp(annualPd * clamp(1 + (affordabilityIndex - 1) * affordabilityConfig.pdStressSlope, 0.55, 4), 0, 0.999999);

    const cohort: LoanCohort = {
      productType: args.productType,
      cohortId: -ageMonths,
      originalPrincipal,
      outstandingPrincipal: outstanding,
      annualInterestRate: coupon,
      termMonths,
      ageMonths,
      annualPd,
      sicrReferenceAnnualPd: annualPd,
      effectiveAnnualPd,
      lgd,
      affordabilityIndex,
      renewalCount: 0,
      stage: 'stage1',
      sector: pickWeighted(rng, defaultSectorMix(args.productType)),
      geography: pickWeighted(rng, defaultGeographyMix()),
    };
    cohort.stage = updateCohortStage(cohort, args.config);
    cohorts.push(cohort);
  });

  cohorts.sort((a, b) => a.cohortId - b.cohortId);
  assertSeasonedLoanPortfolio({
    productType: args.productType,
    targetOutstanding: args.targetOutstanding,
    cohorts,
    maxTermMonths,
  });
  return cohorts;
};

export const calculateProvisionTargetFromCohorts = (args: { state: BankState; config: SimulationConfig; productType?: ProductType }): ProvisionTarget => {
  const { state, config } = args;
  const out: ProvisionTarget = { stage1: 0, stage2: 0, stage3: 0, total: 0 };
  // IFRS 9 permits collective impairment assessment for shared risk
  // characteristics. Pool the small overdue fractions by product to avoid
  // repeating full lifetime scenario paths for hundreds of seeded cohorts.
  const overduePools = new Map<ProductType, {
    exemplar: LoanCohort; amount: number; rate: number; eir: number;
    pd: number; lgd: number; months: number;
  }>();
  for (const [product, cohorts] of Object.entries(state.loanCohorts ?? {})) {
    if (args.productType && product !== args.productType) continue;
    for (const cohort of cohorts ?? []) {
      const lateArrears = cohort.stage === 'stage1' ? cohortArrearsStage2Gross(cohort) : 0;
      if (lateArrears > 0) {
        const normal = Math.max(0, cohort.outstandingPrincipal - lateArrears);
        if (normal > 0) out.stage1 += cohortEcl({ ...cohort, outstandingPrincipal: normal }, config, state.market);
        // Overdue principal receives lifetime ECL, collectively estimated
        // using exposure-weighted PD, LGD, remaining term and original EIR.
        const key = product as ProductType;
        const pool = overduePools.get(key) ?? {
          exemplar: cohort, amount: 0, rate: 0, eir: 0, pd: 0, lgd: 0, months: 0,
        };
        pool.amount += lateArrears;
        pool.rate += lateArrears * cohort.annualInterestRate;
        pool.eir += lateArrears * (cohort.originalEffectiveInterestRate ?? cohort.annualInterestRate);
        pool.pd += lateArrears * Math.max(cohort.effectiveAnnualPd ?? cohort.annualPd,
          2 * (cohort.sicrReferenceAnnualPd ?? cohort.annualPd));
        pool.lgd += lateArrears * (cohort.effectiveLgd ?? cohort.lgd);
        pool.months += lateArrears * Math.max(1, cohort.termMonths - cohort.ageMonths);
        overduePools.set(key, pool);
      } else {
        out[normaliseStage(cohort.stage)] += cohortEcl(cohort, config, state.market);
      }
    }
  }
  for (const pool of overduePools.values()) {
    if (pool.amount <= 0) continue;
    out.stage2 += cohortEcl({
      ...pool.exemplar,
      outstandingPrincipal: pool.amount,
      originalEffectiveInterestRate: pool.eir / pool.amount,
      annualInterestRate: pool.rate / pool.amount,
      effectiveAnnualPd: pool.pd / pool.amount,
      effectiveLgd: pool.lgd / pool.amount,
      ageMonths: 0,
      termMonths: Math.max(1, Math.round(pool.months / pool.amount)),
      stage: 'stage2',
    }, config, state.market);
  }
  for (const [product, buckets] of Object.entries(state.workoutPipelines ?? {})) {
    if (args.productType && product !== args.productType) continue;
    const recoveryRateFor = workoutRecoveryEstimator(state, config, product as ProductType);
    for (const bucket of buckets ?? []) out.stage3 += Math.max(0,
      bucket.defaultedPrincipal + (bucket.modificationAdjustment ?? 0) -
      workoutPresentValue(state, config, product as ProductType, bucket, recoveryRateFor(bucket)));
  }
  out.total = out.stage1 + out.stage2 + out.stage3;
  return out;
};
