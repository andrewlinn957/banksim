import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import {
  LeverageFrameworkAssessmentState,
  LeverageScopeRoute,
} from '../domain/risks';
import { PRODUCTS } from '../products/catalogue';

export const UK_LEVERAGE_RULES = {
  baseRate: 0.0325,
  minimumCet1Share: 0.75,
  retailDepositsThreshold: 75e9,
  nonUkAssetsThreshold: 10e9,
  accountingReferenceDates: 3,
  assessmentIntervalMonths: 12,
  leverageBufferScalar: 0.35,
  cclbRoundingIncrement: 0.001,
} as const;

const average = (values: number[]): number =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const advanceMonths = (raw: Date, months: number): Date => {
  const date = new Date(raw);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
};

export const calculateLeverageRetailDeposits = (state: BankState): number =>
  state.financial.balanceSheet.items.reduce((sum, item) => {
    const product = PRODUCTS[item.productType];
    return sum + (product?.behaviour?.depositSegment === 'retail' ? Math.max(0, item.balance) : 0);
  }, 0);

/**
 * The current BankSim catalogue models a domestic UK bank only. Keep non-UK assets as an explicit
 * leverage-scope measure so international products can populate it later without changing the
 * framework logic.
 */
export const calculateLeverageNonUkAssets = (_state: BankState): number => 0;

export const roundCclbRate = (institutionSpecificCcybRate: number): number => {
  const raw = Math.max(0, institutionSpecificCcybRate) * UK_LEVERAGE_RULES.leverageBufferScalar;
  const increment = UK_LEVERAGE_RULES.cclbRoundingIncrement;
  return Math.round(raw / increment) * increment;
};

export const calculateAlrbRate = (systemicBufferRate: number): number =>
  Math.max(0, systemicBufferRate) * UK_LEVERAGE_RULES.leverageBufferScalar;

export const leverageScopeRoute = (
  averageRetailDeposits: number,
  averageNonUkAssets: number
): LeverageScopeRoute => {
  const retail = averageRetailDeposits >= UK_LEVERAGE_RULES.retailDepositsThreshold;
  const nonUk = averageNonUkAssets >= UK_LEVERAGE_RULES.nonUkAssetsThreshold;
  if (retail && nonUk) return 'both';
  if (retail) return 'retailDeposits';
  if (nonUk) return 'nonUkAssets';
  return 'belowThresholds';
};

const buildAssessment = (
  state: BankState,
  assessmentStep: number,
  observations: LeverageFrameworkAssessmentState['accountingReferenceObservations']
): LeverageFrameworkAssessmentState => {
  const recent = [...observations]
    .sort((a, b) => a.step - b.step)
    .slice(-UK_LEVERAGE_RULES.accountingReferenceDates);
  const averageRetailDeposits = average(recent.map((x) => x.retailDeposits));
  const averageNonUkAssets = average(recent.map((x) => x.nonUkAssets));
  const scopeRoute = leverageScopeRoute(averageRetailDeposits, averageNonUkAssets);
  const assessmentDate = assessmentStep > state.time.step
    ? advanceMonths(state.time.date, state.time.stepLengthMonths)
    : new Date(state.time.date);
  return {
    inScope: scopeRoute !== 'belowThresholds',
    scopeRoute,
    assessmentStep,
    assessmentDate: assessmentDate.toISOString(),
    nextAssessmentStep: assessmentStep + UK_LEVERAGE_RULES.assessmentIntervalMonths,
    averageRetailDeposits,
    averageNonUkAssets,
    accountingReferenceObservations: recent,
  };
};

const openingObservations = (state: BankState): LeverageFrameworkAssessmentState['accountingReferenceObservations'] => {
  const retailDeposits = calculateLeverageRetailDeposits(state);
  const nonUkAssets = calculateLeverageNonUkAssets(state);
  return [-24, -12, 0].map((offset) => ({
    step: state.time.step + offset,
    date: advanceMonths(state.time.date, offset).toISOString(),
    retailDeposits,
    nonUkAssets,
  }));
};

/** Read-only view used by ordinary metric refreshes. */
export const leverageFrameworkAssessmentForMetrics = (
  state: BankState
): LeverageFrameworkAssessmentState =>
  state.risk.leverageFramework ?? buildAssessment(state, state.time.step, openingObservations(state));

export const initializeOpeningLeverageFrameworkAssessment = (
  state: BankState
): LeverageFrameworkAssessmentState => {
  const assessment = buildAssessment(state, state.time.step, openingObservations(state));
  state.risk.leverageFramework = assessment;
  return assessment;
};

/** Record a new accounting-reference-date observation only on an explicit completed-year close. */
export const advanceLeverageFrameworkAssessmentAtClose = (
  state: BankState
): LeverageFrameworkAssessmentState => {
  const existing = state.risk.leverageFramework ?? initializeOpeningLeverageFrameworkAssessment(state);
  const closingStep = state.time.step + 1;
  if (closingStep < existing.nextAssessmentStep) return existing;

  const observationDate = advanceMonths(state.time.date, state.time.stepLengthMonths);
  const observation = {
    step: closingStep,
    date: observationDate.toISOString(),
    retailDeposits: calculateLeverageRetailDeposits(state),
    nonUkAssets: calculateLeverageNonUkAssets(state),
  };
  const observations = [
    ...existing.accountingReferenceObservations.map((x) => ({ ...x })),
    observation,
  ];
  const assessment = buildAssessment(state, closingStep, observations);
  state.risk.leverageFramework = assessment;
  return assessment;
};

export const calculateLeverageFramework = (args: {
  state: BankState;
  config: SimulationConfig;
  institutionSpecificCcybRate: number;
  systemicBufferRate: number;
}) => {
  const assessment = leverageFrameworkAssessmentForMetrics(args.state);
  const baseRate = Math.max(0, args.config.riskLimits.minLeverageRatio || UK_LEVERAGE_RULES.baseRate);
  const cclbIndicativeRate = roundCclbRate(args.institutionSpecificCcybRate);
  const alrbIndicativeRate = calculateAlrbRate(args.systemicBufferRate);
  const cclbRate = assessment.inScope ? cclbIndicativeRate : 0;
  const alrbRate = assessment.inScope ? alrbIndicativeRate : 0;
  const bufferRate = cclbRate + alrbRate;
  const applicableThresholdRate = baseRate + bufferRate;
  const cet1ThresholdRate = baseRate * UK_LEVERAGE_RULES.minimumCet1Share + bufferRate;

  return {
    inScope: assessment.inScope,
    scopeRoute: assessment.scopeRoute,
    baseRate,
    minimumCet1Share: UK_LEVERAGE_RULES.minimumCet1Share,
    retailDeposits: calculateLeverageRetailDeposits(args.state),
    averageRetailDeposits: assessment.averageRetailDeposits,
    nonUkAssets: calculateLeverageNonUkAssets(args.state),
    averageNonUkAssets: assessment.averageNonUkAssets,
    retailDepositsThreshold: UK_LEVERAGE_RULES.retailDepositsThreshold,
    nonUkAssetsThreshold: UK_LEVERAGE_RULES.nonUkAssetsThreshold,
    cclbIndicativeRate,
    alrbIndicativeRate,
    cclbRate,
    alrbRate,
    bufferRate,
    applicableThresholdRate,
    cet1ThresholdRate,
    nextAssessmentStep: assessment.nextAssessmentStep,
  };
};
