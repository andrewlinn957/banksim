import type { BankState } from '../domain/bankState';
import type { ProductType } from '../domain/enums';
import type { PociAsset } from '../domain/poci';
import { AssetProductType } from '../domain/enums';
import { PRODUCTS } from '../products/catalogue';
import { creditAdjustedEffectiveRate } from './loanModification';

const valid = (x: number): boolean => Number.isFinite(x) && x >= 0;
const value = (flows: readonly number[], annualRate: number): number => {
  const monthlyRate = annualRate / 12;
  if (monthlyRate <= -1) throw new Error('Invalid POCI credit-adjusted EIR');
  return flows.reduce((sum, payment, month) =>
    sum + payment / (1 + monthlyRate) ** (month + 1), 0);
};
const cashBalance = (state: BankState) =>
  state.financial.balanceSheet.items.find(item => item.productType === AssetProductType.CashReserves);

export const pociBalances = (state: BankState, productType: ProductType) =>
  (state.pociAssets ?? []).filter(asset => asset.productType === productType).reduce(
    (sum, asset) => ({
      net: sum.net + asset.netCarryingAmount,
      cumulativeEcl: sum.cumulativeEcl + asset.cumulativeLossAllowance,
    }),
    { net: 0, cumulativeEcl: 0 },
  );

/** Purchased credit-impaired assets are recognised at cost, with no day-one ECL charge. */
export const purchasePociAsset = (
  state: BankState,
  input: { assetId: string; productType: ProductType; contractualFaceValue: number;
    purchasePrice: number; expectedMonthlyCashFlows: number[] },
): PociAsset => {
  if (!input.assetId.trim() || input.assetId.length > 80 ||
    (state.pociAssets ?? []).some(asset => asset.assetId === input.assetId))
    throw new Error('POCI asset ID must be unique and non-empty');
  if (!PRODUCTS[input.productType]?.behaviour?.isLoan)
    throw new Error('POCI purchases require an existing loan product');
  if (![input.purchasePrice, input.contractualFaceValue].every(valid) || input.purchasePrice <= 0 ||
    input.contractualFaceValue < input.purchasePrice)
    throw new Error('Invalid POCI purchase price or contractual face value');
  const cash = cashBalance(state);
  if (!cash || cash.balance < input.purchasePrice) throw new Error('Insufficient cash for POCI purchase');
  const flows = input.expectedMonthlyCashFlows;
  if (!flows?.length || flows.length > 420 || flows.some(x => !valid(x)))
    throw new Error('POCI receipts must be finite monthly cash flows of up to 420 months');
  const annualEir = creditAdjustedEffectiveRate(input.purchasePrice, flows);
  if (annualEir < 0) throw new Error('Negative credit-adjusted EIR unsupported');
  const asset: PociAsset = {
    assetId: input.assetId, productType: input.productType,
    contractualFaceValue: input.contractualFaceValue,
    purchasePrice: input.purchasePrice, creditAdjustedEir: annualEir,
    netCarryingAmount: input.purchasePrice, cumulativeLossAllowance: 0,
    originalExpectedCashFlows: [...flows], currentExpectedCashFlows: [...flows],
    monthsElapsed: 0,
  };
  cash.balance -= input.purchasePrice;
  (state.pociAssets ??= []).push(asset);
  return asset;
};

/** Only subsequent changes to lifetime losses enter POCI impairment P&L. */
export const revisePociAsset = (
  state: BankState, assetId: string, revisedCashFlows: number[],
): number => {
  const asset = state.pociAssets?.find(x => x.assetId === assetId);
  if (!asset) throw new Error('Unknown POCI asset');
  if (revisedCashFlows.length !== asset.currentExpectedCashFlows.length ||
    revisedCashFlows.some(x => !valid(x)))
    throw new Error('Revised cash flows must cover exactly the remaining POCI months');
  const previousNet = asset.netCarryingAmount;
  const newNet = value(revisedCashFlows, asset.creditAdjustedEir);
  const gainLoss = newNet - previousNet;
  asset.netCarryingAmount = newNet;
  asset.currentExpectedCashFlows = [...revisedCashFlows];
  asset.cumulativeLossAllowance = value(asset.originalExpectedCashFlows, asset.creditAdjustedEir) - newNet;
  state.pendingPociImpairmentGainLoss = (state.pendingPociImpairmentGainLoss ?? 0) + gainLoss;
  return gainLoss;
};

/** POCI interest is calculated on net amortised cost from initial recognition. */
export const stepPociAssets = (state: BankState, months: number): {
  cash: number; interest: number; byProduct: Partial<Record<ProductType, { cash: number; interest: number }>>;
} => {
  let cash = 0, interest = 0;
  const byProduct: Partial<Record<ProductType, { cash: number; interest: number }>> = {};
  for (let n = 0; n < months; n++) {
    const survivors: PociAsset[] = [];
    for (const asset of state.pociAssets ?? []) {
      const coupon = asset.creditAdjustedEir / 12 * asset.netCarryingAmount;
      const receipt = asset.currentExpectedCashFlows[0] ?? 0;
      interest += coupon;
      cash += receipt;
      const product = byProduct[asset.productType] ?? { cash: 0, interest: 0 };
      product.cash += receipt;
      product.interest += coupon;
      byProduct[asset.productType] = product;
      asset.netCarryingAmount = Math.max(0, asset.netCarryingAmount + coupon - receipt);
      asset.originalExpectedCashFlows.shift();
      asset.currentExpectedCashFlows.shift();
      asset.cumulativeLossAllowance = value(asset.originalExpectedCashFlows, asset.creditAdjustedEir) -
        value(asset.currentExpectedCashFlows, asset.creditAdjustedEir);
      asset.monthsElapsed++;
      if (asset.currentExpectedCashFlows.length > 0) survivors.push(asset);
    }
    state.pociAssets = survivors;
  }
  const cashItem = cashBalance(state);
  if (cashItem) cashItem.balance += cash;
  return { cash, interest, byProduct };
};
