import { BalanceSheetSide, Currency, MaturityBucket, ProductType } from './enums';
import { Encumbrance, LiquidityTag } from './liquidity';

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
}

export interface BalanceSheet {
  items: BalanceSheetItem[];
}
