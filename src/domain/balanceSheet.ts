import { BalanceSheetSide, Currency, MaturityBucket, ProductType } from './enums';
import { Encumbrance, LiquidityTag } from './liquidity';

export type SecuritiesClassification = 'HTM' | 'FVOCI' | 'FVTPL';

export interface SecurityMetadata {
  classification: SecuritiesClassification;
  effectiveDurationYears: number;
  valuationReferenceYield: number;
}

export interface BalanceSheetItem {
  side: BalanceSheetSide;
  productType: ProductType;
  label: string;
  currency: Currency;
  balance: number;
  interestRate: number;
  maturityBucket: MaturityBucket;
  liquidityTag: LiquidityTag;
  encumbrance: Encumbrance;
  security?: SecurityMetadata;
}

export interface BalanceSheet {
  items: BalanceSheetItem[];
}
