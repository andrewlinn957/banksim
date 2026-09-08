import { BalanceSheet, BalanceSheetItem } from '../domain/balanceSheet';
import { BalanceSheetSide, ProductType } from '../domain/enums';

export const findProductPosition = <T extends ProductType>(
  balanceSheet: BalanceSheet,
  productType: T
): BalanceSheetItem | undefined =>
  balanceSheet.items.find((item) => item.productType === productType);

export const requireProductPosition = <T extends ProductType>(
  balanceSheet: BalanceSheet,
  productType: T,
  errorMessage = `Missing balance-sheet line for ${productType}`
): BalanceSheetItem => {
  const item = findProductPosition(balanceSheet, productType);
  if (!item) throw new Error(errorMessage);
  return item;
};

export const assetPositions = (balanceSheet: BalanceSheet): BalanceSheetItem[] =>
  balanceSheet.items.filter((item) => item.side === BalanceSheetSide.Asset);

export const liabilityPositions = (balanceSheet: BalanceSheet): BalanceSheetItem[] =>
  balanceSheet.items.filter((item) => item.side === BalanceSheetSide.Liability);
