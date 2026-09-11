import {
  LcrCalculationSummary,
  LcrEngineResult,
  LcrHqlaAdjustment,
  LcrHqlaLevel,
  LcrInflowCapClass,
  LcrLevelAdjustmentSummary,
  LcrModel,
} from '../domain/lcr';

const nonNegative = (value: number): number => Math.max(0, Number.isFinite(value) ? value : 0);

const emptyAdjustmentSummary = (): LcrLevelAdjustmentSummary => ({
  collateralOutflows: 0,
  collateralInflows: 0,
  securedCashOutflows: 0,
  securedCashInflows: 0,
});

export const calculateLcrNetOutflow = (
  totalOutflows: number,
  inflows: { capClass: LcrInflowCapClass; amount: number }[]
) => {
  const outflows = nonNegative(totalOutflows);
  const fullyExemptInflows = inflows
    .filter(inflow => inflow.capClass === 'exempt')
    .reduce((sum, inflow) => sum + nonNegative(inflow.amount), 0);
  const inflows90 = inflows
    .filter(inflow => inflow.capClass === '90')
    .reduce((sum, inflow) => sum + nonNegative(inflow.amount), 0);
  const inflows75 = inflows
    .filter(inflow => inflow.capClass === '75')
    .reduce((sum, inflow) => sum + nonNegative(inflow.amount), 0);

  // C76 applies the exempt class first, then the 90%-cap class, then the
  // ordinary 75%-cap class. Keeping the classes separate is essential for
  // adding specialised inflow populations later.
  const reductionFullyExempt = Math.min(fullyExemptInflows, outflows);
  const reduction90 = Math.min(
    inflows90,
    0.90 * Math.max(outflows - fullyExemptInflows, 0)
  );
  const reduction75 = Math.min(
    inflows75,
    0.75 * Math.max(outflows - fullyExemptInflows - inflows90 / 0.90, 0)
  );
  const netLiquidityOutflow = Math.max(
    0,
    outflows - reductionFullyExempt - reduction90 - reduction75
  );

  return {
    fullyExemptInflows,
    inflows90,
    inflows75,
    reductionFullyExempt,
    reduction90,
    reduction75,
    netLiquidityOutflow,
  };
};

const sumHqla = (model: LcrModel, level: LcrHqlaLevel): number =>
  model.liquidAssets
    .filter(line => line.hqlaLevel === level)
    .reduce((sum, line) => sum + nonNegative(line.weighted), 0);

const summariseAdjustments = (
  adjustments: LcrHqlaAdjustment[]
): Record<LcrHqlaLevel, LcrLevelAdjustmentSummary> => {
  const result: Record<LcrHqlaLevel, LcrLevelAdjustmentSummary> = {
    level1: emptyAdjustmentSummary(),
    level2a: emptyAdjustmentSummary(),
    level2b: emptyAdjustmentSummary(),
  };

  for (const adjustment of adjustments) {
    const amount = nonNegative(adjustment.amount);
    const summary = result[adjustment.level];
    if (adjustment.kind === 'collateral' && adjustment.direction === 'outflow') summary.collateralOutflows += amount;
    if (adjustment.kind === 'collateral' && adjustment.direction === 'inflow') summary.collateralInflows += amount;
    if (adjustment.kind === 'securedCash' && adjustment.direction === 'outflow') summary.securedCashOutflows += amount;
    if (adjustment.kind === 'securedCash' && adjustment.direction === 'inflow') summary.securedCashInflows += amount;
  }

  return result;
};

const adjustedHqla = (
  unadjusted: number,
  adjustment: LcrLevelAdjustmentSummary
): number => Math.max(
  0,
  unadjusted
    - adjustment.collateralOutflows
    + adjustment.collateralInflows
    - adjustment.securedCashOutflows
    + adjustment.securedCashInflows
);

/**
 * Pure regulatory LCR engine.
 *
 * It does not know about BankState, products, balance-sheet sides, loan cohorts,
 * funding ladders or derivative accounting. Its input is the LCR model itself:
 * eligible liquid-asset lines, 30-day outflows/inflows and C76 HQLA adjustments.
 *
 * That separation is deliberate: new products or richer cash-flow modelling
 * should change the adapter that constructs LcrModel, not this calculation.
 */
export const calculateLcr = (model: LcrModel): LcrEngineResult => {
  const hqlaAdjustments = model.hqlaAdjustments ?? [];
  const adjustmentsByLevel = summariseAdjustments(hqlaAdjustments);

  const unadjustedLevel1 = sumHqla(model, 'level1');
  const unadjustedLevel2A = sumHqla(model, 'level2a');
  const unadjustedLevel2B = sumHqla(model, 'level2b');

  const adjustedLevel1 = adjustedHqla(unadjustedLevel1, adjustmentsByLevel.level1);
  const adjustedLevel2A = adjustedHqla(unadjustedLevel2A, adjustmentsByLevel.level2a);
  const adjustedLevel2B = adjustedHqla(unadjustedLevel2B, adjustmentsByLevel.level2b);

  const adjustedTotal = adjustedLevel1 + adjustedLevel2A + adjustedLevel2B;

  // HQLA composition limits: Level 2 may be no more than 40% of the buffer and
  // Level 2B no more than 15%. C76 determines the excess using adjusted HQLA,
  // then deducts that excess from the unadjusted stock used in the numerator.
  const maxTotalFromLevel2Cap = adjustedLevel1 > 0 ? adjustedLevel1 / 0.60 : 0;
  const maxTotalFromLevel2BCap = adjustedLevel1 + adjustedLevel2A > 0
    ? (adjustedLevel1 + adjustedLevel2A) / 0.85
    : 0;
  const compositionLimitedAdjustedTotal = Math.min(
    adjustedTotal,
    maxTotalFromLevel2Cap,
    maxTotalFromLevel2BCap
  );
  const excessLiquidAssets = Math.max(0, adjustedTotal - compositionLimitedAdjustedTotal);

  const unadjustedTotal = unadjustedLevel1 + unadjustedLevel2A + unadjustedLevel2B;
  const liquidityBuffer = Math.max(
    0,
    unadjustedTotal - Math.min(unadjustedTotal, excessLiquidAssets)
  );

  const totalOutflows = model.outflows.reduce(
    (sum, line) => sum + nonNegative(line.weighted),
    0
  );
  const net = calculateLcrNetOutflow(
    totalOutflows,
    model.inflows.map(line => ({
      capClass: line.capClass ?? '75',
      amount: nonNegative(line.weighted),
    }))
  );
  const lcr = net.netLiquidityOutflow > 0
    ? liquidityBuffer / net.netLiquidityOutflow
    : Infinity;

  const level1 = adjustmentsByLevel.level1;
  const c76: LcrCalculationSummary = {
    unadjustedLevel1,
    unadjustedLevel2A,
    unadjustedLevel2B,
    level1Collateral30dOutflows: level1.collateralOutflows,
    level1Collateral30dInflows: level1.collateralInflows,
    securedCash30dOutflows: level1.securedCashOutflows,
    securedCash30dInflows: level1.securedCashInflows,
    adjustedLevel1,
    adjustedLevel2A,
    adjustedLevel2B,
    excessLiquidAssets,
    liquidityBuffer,
    totalOutflows,
    ...net,
    lcr,
    adjustmentsByLevel,
  };

  return {
    liquidAssets: model.liquidAssets,
    outflows: model.outflows,
    inflows: model.inflows,
    hqlaAdjustments,
    c76,
  };
};
