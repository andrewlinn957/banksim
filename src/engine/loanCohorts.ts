import { cohortEcl, workoutRecoveryEstimator, workoutPresentValue } from './impairment';
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
import {
  LoanCohort,
  LoanGeography,
  LoanSector,
  LoanStage,
  LoanWorkoutBucket,
} from '../domain/loanCohorts';
import { PRODUCT_META } from '../domain/productMeta';

// Used to convert annual rates/PDs into monthly equivalents.
const MONTHS_IN_YEAR = 12;
// Safety cap: prevents unrealistic/buggy terms from creating extreme math.
const MAX_TERM_MONTHS_CAP = 420;
const LOAN_SECTORS: LoanSector[] = [
  'retailMortgage',
  'commercialRealEstate',
  'sme',
  'largeCorporate',
  'other',
];
const LOAN_GEOGRAPHIES: LoanGeography[] = [
  'london',
  'south',
  'midlands',
  'north',
  'scotland',
  'wales',
  'northernIreland',
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
const isLoanProduct = (productType: ProductType): boolean => Boolean(PRODUCT_META[productType]?.behaviour?.isLoan);

/**
 * Result returned by `stepLoanCohorts(...)` for one simulation step.
 *
 */
export interface LoanCohortStepResult {
  loanInterestIncome: number;
  nonCashInterest: number;
  recognizedLoanLosses: Partial<Record<ProductType, number>>;
  defaultedPrincipal: number;
  renewedPrincipal: number;
  prepaidPrincipal: number;
  recoveryCash: number;
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
    if (!isLoanProduct(p) || (!state.loanCohorts?.[p] && !state.workoutPipelines?.[p])) return;
    const gross = sumLoanOutstanding(state.loanCohorts?.[p]) + (state.workoutPipelines?.[p] ?? []).reduce((sum, b) => sum + b.defaultedPrincipal, 0);
    item.balance = Math.max(0, gross - (item.lossAllowance ?? 0));
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
  productType === AssetProductType.Mortgages ? 'retailMortgage' : 'largeCorporate';

const fallbackGeographyForCohort = (cohortId: number): LoanGeography =>
  LOAN_GEOGRAPHIES[Math.abs(Math.floor(cohortId)) % LOAN_GEOGRAPHIES.length];

const normaliseSector = (productType: ProductType, cohortId: number, sector: LoanSector | undefined): LoanSector =>
  isValidSector(sector) ? sector : fallbackSectorForProduct(productType);

const normaliseGeography = (
  cohortId: number,
  geography: LoanGeography | undefined
): LoanGeography => (isValidGeography(geography) ? geography : fallbackGeographyForCohort(cohortId));

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
      originalPrincipal: fundedPrincipal,
      outstandingPrincipal: fundedPrincipal,
      annualInterestRate: Math.max(0, args.annualInterestRate),
      termMonths,
      ageMonths: 0,
      annualPd: Math.max(0, args.annualPd),
      lgd: clamp(args.lgd, 0, 1),
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

const classifyStage = (args: { currentStage: LoanStage; stressedAnnualPd: number; baseAnnualPd: number; sicrThreshold: number }): LoanStage => {
  // SICR is assessed relative to origination, including macro effects in stressed PD.
  // A single negative GDP observation does not move every borrower into lifetime ECL.
  if (args.currentStage === 'stage3') return 'stage3';
  if (args.stressedAnnualPd >= Math.max(1e-6, args.baseAnnualPd) * args.sicrThreshold) return 'stage2';
  if (args.currentStage === 'stage2' && args.stressedAnnualPd > Math.max(1e-6, args.baseAnnualPd) * 1.1) return 'stage2';
  return 'stage1';
};

const getLoanBenchmarkRate = (state: BankState, productType: ProductType): number =>
  productType === AssetProductType.Mortgages
    ? state.market.competitorMortgageRate
    : state.market.riskFreeLong + state.market.corporateLoanSpread;

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
}): { recoveryCash: number; resolvedWorkoutPrincipal: number; nonCashInterest: number } => {
  const { state, config, cash, recognizedLoanLosses } = args;
  const workoutConfig = getWorkoutConfig(config);
  const products = new Set<ProductType>([
    ...Object.keys(state.workoutPipelines ?? {}),
    ...Object.keys(state.loanCohorts ?? {}),
  ] as ProductType[]);

  let recoveryCash = 0;
  let nonCashInterest = 0;
  let resolvedWorkoutPrincipal = 0;

  products.forEach((productType) => {
    if (!PRODUCT_META[productType]?.behaviour?.isLoan) return;
    const buckets = getWorkoutBucketsArray(state, productType);
    if (buckets.length === 0) return;

    const recoveryRateFor = workoutRecoveryEstimator(state, config, productType);
    const surviving: LoanWorkoutBucket[] = [];
    buckets.forEach((bucket) => {
      nonCashInterest += workoutPresentValue(state, config, productType, bucket, recoveryRateFor(bucket)) * Math.max(0, bucket.effectiveInterestRate ?? 0) / 12;
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
      const chargeOff = principal - recovered;
      if (recovered > 0) {
        cash.balance += recovered;
      }
      if (chargeOff > 0) {
        recognizedLoanLosses[productType] = (recognizedLoanLosses[productType] ?? 0) + chargeOff;
      }
      recoveryCash += recovered;
      resolvedWorkoutPrincipal += principal;
    });

    state.workoutPipelines[productType] = surviving;
  });

  return { recoveryCash, resolvedWorkoutPrincipal, nonCashInterest };
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
      nonCashInterest: 0,
      recognizedLoanLosses: {},
      defaultedPrincipal: 0,
      renewedPrincipal: 0,
      prepaidPrincipal: 0,
      recoveryCash: 0,
      resolvedWorkoutPrincipal: 0,
      selectionPressureNotional: 0,
      selectionPressureIndex: 0,
    };
  }

  const cash = getCashItem(state);
  if (!cash) throw new Error('Missing cash line item; cannot step loan cohorts');

  const recognizedLoanLosses: Partial<Record<ProductType, number>> = {};
  let loanInterestIncome = 0;
  let nonCashInterest = 0;
  let defaultedPrincipal = 0;
  let renewedPrincipal = 0;
  let prepaidPrincipal = 0;
  let recoveryCash = 0;
  let resolvedWorkoutPrincipal = 0;
  let selectionPressureNotional = 0;

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
        if (cohort.stage === 'stage3') {
          getWorkoutBucketsArray(state, productType).push({ productType, sourceCohortId: cohort.cohortId, stageAtDefault: 'stage3', defaultedPrincipal: cohort.outstandingPrincipal, expectedRecoveryRate: 1 - (cohort.effectiveLgd ?? cohort.lgd), effectiveInterestRate: cohort.annualInterestRate, monthsToResolution: Math.max(1, Math.round(workoutConfig.baseResolutionLagMonths)), sector: cohort.sector, geography: cohort.geography });
          defaultedPrincipal += cohort.outstandingPrincipal;
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
        const pmt = monthlyPayment(cohort.outstandingPrincipal, cohort.annualInterestRate, remainingMonths);
        const r = cohort.annualInterestRate / MONTHS_IN_YEAR;
        const interest = cohort.outstandingPrincipal * r;
        const principal = Math.min(cohort.outstandingPrincipal, Math.max(0, pmt - interest));

        cohort.outstandingPrincipal -= principal;
        cash.balance += interest + principal;
        loanInterestIncome += interest;

        const couponIncentive = Math.max(0, cohort.annualInterestRate - benchmarkRate);
        const baseAnnualPd = config.productParameters[productType]?.baseDefaultRate ?? cohort.annualPd;
        const pdPivot = Math.max(1e-4, baseAnnualPd);
        const relativeRisk = clamp((pdPivot - cohort.annualPd) / pdPivot, -1, 1.5);
        const selectiveFactor = Math.max(0.15, 1 + refinanceConfig.riskSelectivity * relativeRisk);
        const prepayRate =
          cohort.ageMonths >= refinanceConfig.minSeasoningMonths
            ? clamp(
                (refinanceConfig.basePrepayRateMonthly +
                  refinanceConfig.incentiveSensitivity * couponIncentive) *
                  selectiveFactor,
                refinanceConfig.minPrepayRateMonthly,
                refinanceConfig.maxPrepayRateMonthly
              )
            : 0;
        const prepaid = Math.min(cohort.outstandingPrincipal, cohort.outstandingPrincipal * prepayRate);
        if (prepaid > 0) {
          cohort.outstandingPrincipal -= prepaid;
          cash.balance += prepaid;
          prepaidPrincipal += prepaid;
        }

        const affordabilityCurrent = clamp(
          cohort.affordabilityIndex ?? 1,
          affordabilityConfig.minIndex,
          affordabilityConfig.maxIndex
        );
        const affordabilityDrift =
          affordabilityConfig.baselineDriftMonthly +
          affordabilityConfig.couponGapSensitivity * Math.max(0, cohort.annualInterestRate - benchmarkRate) +
          affordabilityConfig.policyRateSensitivity * Math.max(0, state.market.baseRate - 0.02) +
          affordabilityConfig.unemploymentSensitivity * Math.max(0, state.market.unemploymentRate - 0.05) +
          affordabilityConfig.gdpContractionSensitivity * Math.max(0, -state.market.gdpGrowthMoM);
        const affordabilityReversion = affordabilityConfig.recoverySpeedMonthly * (affordabilityCurrent - 1);
        const affordabilityIndex = clamp(
          affordabilityCurrent + affordabilityDrift - affordabilityReversion,
          affordabilityConfig.minIndex,
          affordabilityConfig.maxIndex
        );
        cohort.affordabilityIndex = affordabilityIndex;

        const shouldRenew =
          adverseConfig.renewalShareMonthly > 0 &&
          remainingMonths <= adverseConfig.renewalEligibilityMonths &&
          cohort.ageMonths > 0 &&
          cohort.outstandingPrincipal > 0;
        if (shouldRenew) {
          const renewalShare = clamp(adverseConfig.renewalShareMonthly, 0, 1);
          const renewalPrincipal = Math.min(
            cohort.outstandingPrincipal,
            cohort.outstandingPrincipal * renewalShare
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
            cohort.outstandingPrincipal -= renewalPrincipal;
            renewedPrincipal += renewalPrincipal;
            selectionPressureNotional += renewalPrincipal * Math.max(0, renewalSelection.multiplier - 1);
            renewalAdds.push({
              productType,
              cohortId: nextRenewalCohortId++,
              originalPrincipal: renewalPrincipal,
              outstandingPrincipal: renewalPrincipal,
              annualInterestRate: offeredRate,
              termMonths: getDefaultTermMonths(config, productType),
              ageMonths: 0,
              annualPd: renewalAnnualPd,
              lgd: clamp(cohort.lgd, 0, 1),
              affordabilityIndex: renewalAffordability,
              renewalCount: (cohort.renewalCount ?? 0) + 1,
              stage: 'stage1',
              sector: cohort.sector,
              geography: cohort.geography,
            });
          }
        }

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
        const sicrThreshold = config.behaviour.ifrs9?.sicrPdMultiplierThreshold ?? 1.75;
        cohort.effectiveAnnualPd = annualPd;
        cohort.effectiveLgd = clamp(cohort.lgd * args.lgdMultiplier, 0, 1);
        cohort.stage = classifyStage({
          currentStage: cohort.stage,
          stressedAnnualPd: annualPd,
          baseAnnualPd: cohort.annualPd,
          sicrThreshold,
        });

        const pdMonth = 1 - Math.pow(1 - annualPd, 1 / MONTHS_IN_YEAR);
        const defaulted = Math.max(0, cohort.outstandingPrincipal * pdMonth);
        if (defaulted > 0) {
          cohort.outstandingPrincipal -= defaulted;
          defaultedPrincipal += defaulted;
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
          const workoutBuckets = getWorkoutBucketsArray(state, productType);
          workoutBuckets.push({
            productType,
            sourceCohortId: cohort.cohortId,
            stageAtDefault: cohort.stage,
            defaultedPrincipal: defaulted,
            expectedRecoveryRate,
            effectiveInterestRate: cohort.annualInterestRate,
            monthsToResolution,
            sector: cohort.sector,
            geography: cohort.geography,
          });
        }

        cohort.ageMonths += 1;
      });

      if (renewalAdds.length > 0) {
        cohorts.push(...renewalAdds);
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
    }
    cleanCohorts(cohorts);
  });

  syncLoanBalancesFromCohorts(state);
  const selectionPressureIndex =
    renewedPrincipal > 0 ? selectionPressureNotional / renewedPrincipal : 0;
  return {
    loanInterestIncome,
    nonCashInterest,
    recognizedLoanLosses,
    defaultedPrincipal,
    renewedPrincipal,
    prepaidPrincipal,
    recoveryCash,
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
    return [
      { key: 'retailMortgage', weight: 0.9 },
      { key: 'commercialRealEstate', weight: 0.05 },
      { key: 'other', weight: 0.05 },
    ];
  }
  return [
    { key: 'largeCorporate', weight: 0.45 },
    { key: 'sme', weight: 0.3 },
    { key: 'commercialRealEstate', weight: 0.2 },
    { key: 'other', weight: 0.05 },
  ];
};

const defaultGeographyMix = (): Array<{ key: LoanGeography; weight: number }> => [
  { key: 'london', weight: 0.28 },
  { key: 'south', weight: 0.17 },
  { key: 'midlands', weight: 0.18 },
  { key: 'north', weight: 0.2 },
  { key: 'scotland', weight: 0.08 },
  { key: 'wales', weight: 0.05 },
  { key: 'northernIreland', weight: 0.02 },
  { key: 'other', weight: 0.02 },
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
      affordabilityIndex: clamp(1 + rng.normal() * 0.08, 0.75, 1.3),
      renewalCount: 0,
      stage: 'stage1',
      sector: pickWeighted(rng, defaultSectorMix(args.productType)),
      geography: pickWeighted(rng, defaultGeographyMix()),
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

export const calculateProvisionTargetFromCohorts = (args: { state: BankState; config: SimulationConfig; productType?: ProductType }): ProvisionTarget => {
  const { state, config } = args;
  const out: ProvisionTarget = { stage1: 0, stage2: 0, stage3: 0, total: 0 };
  for (const [product, cohorts] of Object.entries(state.loanCohorts ?? {})) {
    if (args.productType && product !== args.productType) continue;
    for (const cohort of cohorts ?? []) out[normaliseStage(cohort.stage)] += cohortEcl(cohort, config);
  }
  for (const [product, buckets] of Object.entries(state.workoutPipelines ?? {})) {
    if (args.productType && product !== args.productType) continue;
    const recoveryRateFor = workoutRecoveryEstimator(state, config, product as ProductType);
    for (const bucket of buckets ?? []) out.stage3 += Math.max(0, bucket.defaultedPrincipal - workoutPresentValue(state, config, product as ProductType, bucket, recoveryRateFor(bucket)));
  }
  out.total = out.stage1 + out.stage2 + out.stage3;
  return out;
};
