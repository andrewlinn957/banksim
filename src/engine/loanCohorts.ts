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
import { AssetProductType, ProductType } from '../domain/enums';
import { LoanCohort } from '../domain/loanCohorts';
import { PRODUCT_META } from '../domain/productMeta';

// Used to convert annual rates/PDs into monthly equivalents.
const MONTHS_IN_YEAR = 12;
// Safety cap: prevents unrealistic/buggy terms from creating extreme math.
const MAX_TERM_MONTHS_CAP = 420;

/**
 * Clamp a number into the inclusive range `[min, max]`.
 *
 * Parameters:
 * - `value: number` - the input number we want to limit.
 * - `min: number` - lowest allowed value.
 * - `max: number` - highest allowed value.
 *
 * Returns: `number` within the range.
 * Side effects: none.
 * Thrown errors: none.
 */
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Find a balance-sheet line item for a given `productType`.
 *
 * Parameters:
 * - `state: BankState`
 * - `productType: ProductType`
 *
 * Returns: `BalanceSheetItem | undefined` (a union type) because `.find(...)`
 * might not find anything.
 * Side effects: none.
 * Thrown errors: none.
 */
const findItem = (state: BankState, productType: ProductType): BalanceSheetItem | undefined =>
  state.financial.balanceSheet.items.find((i) => i.productType === productType);

/**
 * Convenience helper to get the cash reserves line item.
 *
 * Parameters:
 * - `state: BankState`
 *
 * Returns: `BalanceSheetItem | undefined` (cash might be missing in malformed states).
 * Side effects: none.
 * Thrown errors: none.
 */
const getCashItem = (state: BankState): BalanceSheetItem | undefined =>
  state.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CashReserves);

/**
 * Check whether a `ProductType` is treated as a loan in our product metadata.
 *
 * Parameters:
 * - `productType: ProductType`
 *
 * Returns: `boolean`.
 * Side effects: none.
 * Thrown errors: none.
 *
 * TypeScript note: optional chaining (`?.`) prevents a crash if any intermediate
 * value is `undefined` (e.g. missing metadata for a product type).
 */
const isLoanProduct = (productType: ProductType): boolean => Boolean(PRODUCT_META[productType]?.behaviour?.isLoan);

/**
 * Result returned by `stepLoanCohorts(...)` for one simulation step.
 *
 * Parameters: none (this is a data shape).
 * Return type: none.
 * Side effects: none.
 * Thrown errors: none.
 *
 * TypeScript note: `Partial<Record<ProductType, number>>` means:
 * - `Record<K, V>`: "a map from keys K to values V"
 * - `Partial<T>`: "all properties are optional"
 *
 * So `recognizedLoanLosses` can contain only the product types that actually had
 * losses this step (missing keys are treated as 0).
 */
export interface LoanCohortStepResult {
  loanInterestIncome: number;
  recognizedLoanLosses: Partial<Record<ProductType, number>>;
}

/**
 * A tiny seeded random number generator (RNG) interface.
 *
 * Parameters: none (data + functions).
 * Return type: none.
 * Side effects: calling `uniform()` / `normal()` advances internal RNG state.
 * Thrown errors: none.
 */
export interface SeededRng {
  seed: number;
  uniform: () => number;
  normal: () => number;
}

/**
 * Create a deterministic (seeded) RNG used for repeatable simulations.
 *
 * Parameters:
 * - `seed: number` - initial seed value. Any number is accepted; internally we
 *   coerce it into a 32-bit integer for the RNG algorithm.
 *
 * Returns: `SeededRng` (an object with `uniform()` and `normal()` methods).
 * Side effects: the returned object stores mutable internal RNG state in a closure.
 * Thrown errors: none.
 *
 * Optional TODO: This RNG is for simulation/replay, not security (do not use it
 * for cryptography).
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
 * Parameters:
 * - `outstandingPrincipal: number` - current unpaid balance (>= 0).
 * - `annualInterestRate: number` - annual rate as a decimal (e.g. 0.06 means 6%).
 * - `termMonths: number` - total term in months (positive integer).
 * - `ageMonths: number` - months since origination (integer in [0, termMonths)).
 *
 * Returns: `number` (estimated original principal).
 * Side effects: none.
 * Thrown errors: if inputs are invalid (non-finite, inconsistent) or if the
 * amortisation factors become numerically invalid.
 *
 * Optional TODO: The function allows negative `annualInterestRate` values. Most
 * other code paths clamp rates to >= 0; confirm whether negative rates are intended.
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
 * Parameters:
 * - `state: BankState` - the bank state we mutate/store cohorts in.
 * - `productType: ProductType` - which product's cohort list to return.
 *
 * Returns: `LoanCohort[]` (a mutable array stored inside `state`).
 * Side effects: may create/mutate `state.loanCohorts` and `state.loanCohorts[productType]`.
 * Thrown errors: none.
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
 * Parameters:
 * - `cohorts: readonly LoanCohort[] | undefined`
 *   - `readonly ...[]` means callers can't reassign array elements or push/splice
 *     through this reference (but the objects inside could still be mutable).
 *   - `| undefined` is a union type allowing "no cohorts".
 *
 * Returns: `number`.
 * Side effects: none.
 * Thrown errors: none.
 *
 * TypeScript note: nullish coalescing (`??`) falls back only when the left side
 * is `null`/`undefined` (unlike `||`, which also treats 0 as "falsey").
 *
 * Optional TODO: `LoanCohort.outstandingPrincipal` is not optional in the interface,
 * but the code still uses `?? 0` when summing; confirm whether partial/legacy cohort
 * objects can exist at runtime.
 */
export const sumLoanOutstanding = (cohorts: readonly LoanCohort[] | undefined): number =>
  (cohorts ?? []).reduce((sum, c) => sum + (c.outstandingPrincipal ?? 0), 0);

/**
 * Update balance-sheet loan item balances so they match the cohort totals.
 *
 * Parameters:
 * - `state: BankState`
 *
 * Returns: `void`.
 * Side effects: mutates `state.financial.balanceSheet.items[*].balance`.
 * Thrown errors: none.
 */
export const syncLoanBalancesFromCohorts = (state: BankState): void => {
  // `Object.entries(...)` is typed as `[string, unknown][]` in TS, so we assert
  // the tuple type we expect at runtime.
  // Optional TODO: Consider validating that the keys are valid `ProductType` values.
  const entries = Object.entries(state.loanCohorts ?? {}) as Array<[ProductType, LoanCohort[]]>;
  entries.forEach(([productType, cohorts]) => {
    if (!isLoanProduct(productType)) return;
    const item = findItem(state, productType);
    if (!item) return;
    item.balance = sumLoanOutstanding(cohorts);
  });
};

/**
 * Remove cohorts that are effectively finished.
 *
 * Parameters:
 * - `cohorts: LoanCohort[]` - the mutable cohort array to clean.
 *
 * Returns: `void`.
 * Side effects: mutates the input array in-place (removes elements).
 * Thrown errors: none.
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
 * Parameters:
 * - `cohort: LoanCohort` - the cohort to check.
 * - `maxTermMonths: number` - product/config-specific maximum allowed term.
 *
 * Returns: `void`.
 * Side effects: none (but it can throw).
 * Thrown errors: throws `Error` with a descriptive message if a check fails.
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
    existing.annualPd = w > 0 ? (existing.annualPd * w0 + args.annualPd * w1) / w : args.annualPd;
    existing.lgd = w > 0 ? (existing.lgd * w0 + args.lgd * w1) / w : args.lgd;
    existing.termMonths = Math.max(existing.termMonths, termMonths);
    existing.ageMonths = Math.min(existing.ageMonths, 0);
  } else {
    cohorts.push({
      productType,
      cohortId,
      originalPrincipal: fundedPrincipal,
      outstandingPrincipal: fundedPrincipal,
      annualInterestRate: Math.max(0, args.annualInterestRate),
      termMonths,
      ageMonths: 0,
      annualPd: Math.max(0, args.annualPd),
      lgd: clamp(args.lgd, 0, 1),
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
  if (dtMonths === 0) return { loanInterestIncome: 0, recognizedLoanLosses: {} };

  const cash = getCashItem(state);
  if (!cash) throw new Error('Missing cash line item; cannot step loan cohorts');

  const recognizedLoanLosses: Partial<Record<ProductType, number>> = {};
  let loanInterestIncome = 0;

  const loanProductTypes = Object.keys(state.loanCohorts ?? {}) as ProductType[];
  for (let m = 0; m < dtMonths; m++) {
    loanProductTypes.forEach((productType) => {
      if (!isLoanProduct(productType)) return;
      const cohorts = getLoanCohortsArray(state, productType);
      const maxTermMonths = getMaxTermMonths(config, productType);

      cohorts.forEach((cohort) => {
        if (cohort.outstandingPrincipal <= 0) return;
        if (cohort.ageMonths >= cohort.termMonths) return;
        validateCohort(cohort, maxTermMonths);

        const remainingMonths = cohort.termMonths - cohort.ageMonths;
        const pmt = monthlyPayment(cohort.outstandingPrincipal, cohort.annualInterestRate, remainingMonths);
        const r = cohort.annualInterestRate / MONTHS_IN_YEAR;
        const interest = cohort.outstandingPrincipal * r;
        const principal = Math.min(cohort.outstandingPrincipal, Math.max(0, pmt - interest));

        cohort.outstandingPrincipal -= principal;
        cash.balance += interest + principal;
        loanInterestIncome += interest;

        const annualPd = clamp(cohort.annualPd * args.pdMultiplier, 0, 0.999999);
        const pdMonth = 1 - Math.pow(1 - annualPd, 1 / MONTHS_IN_YEAR);
        const defaulted = Math.max(0, cohort.outstandingPrincipal * pdMonth);

        if (defaulted > 0) {
          const lgd = clamp(cohort.lgd * args.lgdMultiplier, 0, 1);
          const loss = defaulted * lgd;
          const recovery = defaulted - loss;
          cohort.outstandingPrincipal -= defaulted;
          cash.balance += recovery;
          recognizedLoanLosses[productType] = (recognizedLoanLosses[productType] ?? 0) + loss;
        }

        cohort.ageMonths += 1;
      });

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
    }
    cleanCohorts(cohorts);
  });

  syncLoanBalancesFromCohorts(state);
  return { loanInterestIncome, recognizedLoanLosses };
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

const sampleTermMonths = (args: {
  productType: ProductType;
  ageMonths: number;
  maxTermMonths: number;
  rng: SeededRng;
}): number => {
  const { productType, ageMonths, maxTermMonths, rng } = args;
  const minAllowed = Math.min(maxTermMonths, ageMonths + 1);

  const maxTerm = maxTermMonths;
  const u = rng.uniform();

  if (productType === AssetProductType.Mortgages) {
    const minTypical = Math.min(maxTerm, 240);
    const biased = Math.pow(u, 0.35); // bias toward longer terms
    const sampled = Math.round(minTypical + (maxTerm - minTypical) * biased);
    return clamp(sampled, minAllowed, maxTerm);
  }

  if (productType === AssetProductType.CorporateLoans) {
    const minTypical = Math.min(maxTerm, 12);
    const maxTypical = Math.min(maxTerm, 120);
    const biased = Math.pow(u, 1.4); // bias toward shorter terms
    const sampled = Math.round(minTypical + (maxTypical - minTypical) * biased);
    return clamp(Math.max(sampled, minAllowed), minAllowed, maxTerm);
  }

  return clamp(minAllowed, minAllowed, maxTerm);
};

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

    cohorts.push({
      productType: args.productType,
      cohortId: -ageMonths,
      originalPrincipal,
      outstandingPrincipal: outstanding,
      annualInterestRate: coupon,
      termMonths,
      ageMonths,
      annualPd,
      lgd,
    });
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
