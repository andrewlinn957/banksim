import { BalanceSheetSide, Currency, MaturityBucket, ProductType } from './enums';
import { Encumbrance, LiquidityTag } from './liquidity';

export type SecuritiesClassification = 'HTM' | 'FVOCI' | 'FVTPL';

export interface SecurityMetadata {
  amortisedCost?: number;
  lossAllowance?: number;
  pendingRecycling?: number;
  classification: SecuritiesClassification;
  effectiveDurationYears: number;
  valuationReferenceYield: number;
}

export interface BalanceSheetItem {
  side: BalanceSheetSide;
  productType: ProductType;
  label: string;
  currency: Currency;
  // Net carrying amount. Contractual loan principal is held in cohorts.
  balance: number;
  lossAllowance?: number;
  interestRate: number;
  maturityBucket: MaturityBucket;
  liquidityTag: LiquidityTag;
  encumbrance: Encumbrance;
  security?: SecurityMetadata;
}

export interface BalanceSheet {
  items: BalanceSheetItem[];
}
