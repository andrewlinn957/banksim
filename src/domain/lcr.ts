export type LcrInflowCapClass = '75' | '90' | 'exempt';
export type LcrHqlaLevel = 'level1' | 'level2a' | 'level2b';
export type LcrHqlaAdjustmentKind = 'collateral' | 'securedCash';
export type LcrHqlaAdjustmentDirection = 'inflow' | 'outflow';

/**
 * A regulatory LCR line. These are deliberately not balance-sheet positions:
 * they are amounts that have already entered the 30-day LCR model and carry
 * the regulatory factor that applies to that amount.
 */
export interface LcrContribution {
  template: 'C72' | 'C73' | 'C74';
  corep: string;
  label: string;
  sourceLabel: string;
  amount: number;
  factor: number;
  weighted: number;
  capClass?: LcrInflowCapClass;
  hqlaLevel?: LcrHqlaLevel;
}

/**
 * C76 adjustment used to model the 30-day unwind of secured transactions and
 * collateral swaps. Amount is the post-haircut HQLA/cash effect on the named
 * HQLA level. The engine is agnostic about which BankSim product produced it.
 */
export interface LcrHqlaAdjustment {
  id: string;
  label: string;
  level: LcrHqlaLevel;
  kind: LcrHqlaAdjustmentKind;
  direction: LcrHqlaAdjustmentDirection;
  amount: number;
}

/**
 * Complete input to the regulatory LCR engine. Callers can build this from
 * BankSim state, a future contractual cash-flow service, a scenario generator,
 * or a test fixture without the engine knowing anything about those sources.
 */
export interface LcrModel {
  liquidAssets: LcrContribution[];
  outflows: LcrContribution[];
  inflows: LcrContribution[];
  hqlaAdjustments?: LcrHqlaAdjustment[];
}

export interface LcrLevelAdjustmentSummary {
  collateralOutflows: number;
  collateralInflows: number;
  securedCashOutflows: number;
  securedCashInflows: number;
}

export interface LcrCalculationSummary {
  unadjustedLevel1: number;
  unadjustedLevel2A: number;
  unadjustedLevel2B: number;
  level1Collateral30dOutflows: number;
  level1Collateral30dInflows: number;
  securedCash30dOutflows: number;
  securedCash30dInflows: number;
  adjustedLevel1: number;
  adjustedLevel2A: number;
  adjustedLevel2B: number;
  excessLiquidAssets: number;
  liquidityBuffer: number;
  totalOutflows: number;
  fullyExemptInflows: number;
  inflows90: number;
  inflows75: number;
  reductionFullyExempt: number;
  reduction90: number;
  reduction75: number;
  netLiquidityOutflow: number;
  lcr: number;
  adjustmentsByLevel: Record<LcrHqlaLevel, LcrLevelAdjustmentSummary>;
}

export interface LcrEngineResult {
  liquidAssets: LcrContribution[];
  outflows: LcrContribution[];
  inflows: LcrContribution[];
  hqlaAdjustments: LcrHqlaAdjustment[];
  c76: LcrCalculationSummary;
}
