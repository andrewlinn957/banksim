import type { BankState, ContractualMaturityBucket } from '../domain/bankState';
import type { ProductType } from '../domain/enums';
import type { AssetTradeExecution } from '../domain/execution';
import { PRODUCTS } from '../products/catalogue';
import { getCapability, productsWithCapability } from '../products/capabilities';
import { nelsonSiegelYield } from './ukMarketModel';
import type { SimulationEvent } from './simulation';

const EPS = 1e-9;
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const findPosition = (state: BankState, productType: ProductType) =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType);

const settlementAssetType = (): ProductType | undefined =>
  productsWithCapability('treasuryAsset').find(
    (product) => product.capabilities.treasuryAsset?.settlementAsset
  )?.productType;

export const syncFloatingTreasuryAssetRates = (state: BankState): void => {
  productsWithCapability('treasuryAsset').forEach((product) => {
    const capability = product.capabilities.treasuryAsset;
    if (capability?.rateSource !== 'bankRate') return;
    const position = findPosition(state, product.productType);
    if (position) position.interestRate = Math.max(0, state.market.baseRate);
  });
};

const quotedRate = (state: BankState, productType: ProductType, tenorMonths: number): number => {
  const capability = getCapability(productType, 'treasuryAsset');
  if (capability?.rateSource === 'bankRate') return Math.max(0, state.market.baseRate);
  if (capability?.rateSource === 'giltCurve') {
    return Math.max(0, nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, clamp(tenorMonths / 12, 0.25, 30)));
  }
  return Math.max(0, findPosition(state, productType)?.interestRate ?? 0);
};

const openingBuckets = (state: BankState, productType: ProductType): ContractualMaturityBucket[] => {
  const modern = state.assetMaturityLadders?.[productType];
  if (modern) return modern.map((bucket) => ({ ...bucket }));
  // Existing Phase-1 saves briefly stored asset maturities in fundingLadders.
  return (state.fundingLadders?.[productType] ?? []).map((bucket) => ({ ...bucket }));
};

const scaleBuckets = (buckets: ContractualMaturityBucket[], factor: number): ContractualMaturityBucket[] =>
  buckets
    .map((bucket) => ({ ...bucket, notional: Math.max(0, bucket.notional * factor) }))
    .filter((bucket) => bucket.notional > 1);

const weightedRate = (buckets: readonly ContractualMaturityBucket[], fallback: number): number => {
  const total = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
  return total > 0
    ? buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional) * Math.max(0, bucket.rate), 0) / total
    : fallback;
};

const weightedRemainingYears = (buckets: readonly ContractualMaturityBucket[], fallback: number): number => {
  const total = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
  return total > 0
    ? buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional) * Math.max(1, bucket.monthsToMaturity), 0) / total / 12
    : fallback;
};

const lifecycleEvent = (productType: ProductType, message: string, step: number): SimulationEvent => ({
  id: `asset-maturity-${productType}-${step}-${Date.now()}`,
  severity: 'info',
  message,
  timestamp: Date.now(),
  tags: ['market', 'liquidity'],
});

export interface ContractualAssetLifecycleResult {
  maturedNotional: number;
  maturedCarryingValue: number;
}

/**
 * Month-end contractual asset stage in the authoritative engine pipeline.
 * Product capabilities decide which assets participate. Structured action executions provide the
 * actual settlement amount and tenor; human-readable events are output only and are never parsed.
 */
export const advanceContractualAssetLifecycle = (args: {
  openingState: BankState;
  closingState: BankState;
  executions: readonly AssetTradeExecution[];
  events: SimulationEvent[];
  dtMonths: number;
}): ContractualAssetLifecycleResult => {
  const { openingState, closingState, executions, events } = args;
  const dtMonths = Math.max(1, Math.round(args.dtMonths));
  const settlementType = settlementAssetType();
  const settlementPosition = settlementType ? findPosition(closingState, settlementType) : undefined;
  let maturedNotionalTotal = 0;
  let maturedCarryingValueTotal = 0;

  for (const product of productsWithCapability('treasuryAsset')) {
    const capability = product.capabilities.treasuryAsset;
    if (!capability?.contractualMaturity) continue;
    const productType = product.productType;
    const openingPosition = findPosition(openingState, productType);
    const closingPosition = findPosition(closingState, productType);
    if (!openingPosition || !closingPosition || !settlementPosition || !settlementType) continue;

    let buckets = openingBuckets(openingState, productType);
    const trades = executions.filter(
      (execution) => execution.productType === productType && execution.executedAmount > EPS
    );
    const netTrade = trades.reduce(
      (sum, trade) => sum + (trade.side === 'buy' ? trade.executedAmount : -trade.executedAmount),
      0
    );
    let carryingCursor = Math.max(0, closingPosition.balance - netTrade);
    const fallbackTenor = Math.max(3, Math.round(capability.permittedTenorMonths?.[0] ?? 60));

    for (const trade of trades) {
      if (trade.side === 'buy') {
        const requestedTenor = Math.max(3, Math.round(trade.tenorMonths ?? fallbackTenor));
        const permitted = capability.permittedTenorMonths;
        const tenorMonths = permitted?.length && !permitted.includes(requestedTenor)
          ? permitted.reduce(
              (best, tenor) => Math.abs(tenor - requestedTenor) < Math.abs(best - requestedTenor) ? tenor : best,
              permitted[0]
            )
          : requestedTenor;
        buckets.push({
          tenorMonths,
          monthsToMaturity: tenorMonths,
          notional: trade.executedAmount,
          rate: trade.executionRate ?? quotedRate(openingState, productType, tenorMonths),
        });
        carryingCursor += trade.executedAmount;
      } else {
        const saleFraction = carryingCursor > EPS ? clamp(trade.executedAmount / carryingCursor, 0, 1) : 1;
        buckets = scaleBuckets(buckets, 1 - saleFraction);
        carryingCursor = Math.max(0, carryingCursor - trade.executedAmount);
      }
    }

    const aged = buckets.map((bucket) => ({
      ...bucket,
      monthsToMaturity: bucket.monthsToMaturity - dtMonths,
    }));
    const matured = aged.filter((bucket) => bucket.monthsToMaturity <= 0);
    const survivors = aged.filter((bucket) => bucket.monthsToMaturity > 0);
    const maturedNotional = matured.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
    const totalNotionalBeforeMaturity = aged.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
    const maturityFraction = totalNotionalBeforeMaturity > EPS
      ? clamp(maturedNotional / totalNotionalBeforeMaturity, 0, 1)
      : 0;
    const beforeBalance = Math.max(0, closingPosition.balance);
    const maturedCarryingValue = Math.min(beforeBalance, beforeBalance * maturityFraction);

    closingState.assetMaturityLadders ??= {};
    closingState.assetMaturityLadders[productType] = survivors;
    if (closingState.fundingLadders?.[productType]) delete closingState.fundingLadders[productType];

    if (maturedCarryingValue > 0) {
      closingPosition.balance = Math.max(0, beforeBalance - maturedCarryingValue);
      settlementPosition.balance += maturedCarryingValue;
      if (closingPosition.security) {
        closingPosition.security.amortisedCost = Math.max(
          0,
          (closingPosition.security.amortisedCost ?? beforeBalance) * (1 - maturityFraction)
        );
        closingPosition.security.lossAllowance = Math.max(
          0,
          (closingPosition.security.lossAllowance ?? 0) * (1 - maturityFraction)
        );
        closingPosition.security.pendingRecycling = Math.max(
          0,
          (closingPosition.security.pendingRecycling ?? 0) * (1 - maturityFraction)
        );
      }
      if (closingPosition.encumbrance?.encumberedAmount) {
        closingPosition.encumbrance.encumberedAmount = Math.max(
          0,
          closingPosition.encumbrance.encumberedAmount * (1 - maturityFraction)
        );
      }
      events.push(lifecycleEvent(
        productType,
        `${PRODUCTS[productType].label} principal matured into ${PRODUCTS[settlementType].label}: £${(maturedCarryingValue / 1e6).toFixed(1)}m; proceeds left uninvested`,
        closingState.time.step
      ));
    }

    if (survivors.length > 0) {
      closingPosition.interestRate = weightedRate(survivors, closingPosition.interestRate);
      if (closingPosition.security) {
        closingPosition.security.effectiveDurationYears = weightedRemainingYears(
          survivors,
          closingPosition.security.effectiveDurationYears ?? fallbackTenor / 12
        );
      }
    } else if (closingPosition.balance <= EPS) {
      closingPosition.interestRate = 0;
      if (closingPosition.security) closingPosition.security.effectiveDurationYears = 0.25;
    }

    maturedNotionalTotal += maturedNotional;
    maturedCarryingValueTotal += maturedCarryingValue;
  }

  return { maturedNotional: maturedNotionalTotal, maturedCarryingValue: maturedCarryingValueTotal };
};
