import type { ProductType } from './enums';

/** Individually accounted purchased or originated credit-impaired loan. */
export interface PociAsset {
  assetId: string;
  productType: ProductType;
  contractualFaceValue: number;
  purchasePrice: number;
  creditAdjustedEir: number;
  /** Net amortised cost; the closing balance of the recognised asset. */
  netCarryingAmount: number;
  /** Signed cumulative change in lifetime ECL from acquisition, disclosed separately. */
  cumulativeLossAllowance: number;
  /** Original expected receipts discounted into the credit-adjusted EIR. */
  originalExpectedCashFlows: number[];
  /** Most recent expected receipts; also serve as cash receipts in this model. */
  currentExpectedCashFlows: number[];
  monthsElapsed: number;
}
