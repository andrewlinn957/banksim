import { PlayerAction } from '../domain/actions';
import { BankState, FundingMaturityBucket } from '../domain/bankState';
import { AssetProductType } from '../domain/enums';
import { nelsonSiegelYield } from './ukMarketModel';
import type { SimulationEvent } from './simulation';

const MONTHS_IN_YEAR = 12;
const EPS = 1e-9;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const findAsset = (state: BankState, productType: AssetProductType) =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType);

/**
 * BoE reserves are an overnight floating-rate asset. They are not a treasury investment choice:
 * whatever cash is left in the reserve account earns the simulated Bank Rate for that period.
 */
export const syncReserveRemuneration = (state: BankState): void => {
  const reserves = findAsset(state, AssetProductType.CashReserves);
  if (!reserves) return;
  reserves.interestRate = Math.max(0, state.market.baseRate);
};

const giltYieldForMaturity = (state: BankState, maturityYears: number): number => {
  const years = clamp(maturityYears, 0.25, 30);
  return Math.max(0, nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, years));
};

interface GiltTrade {
  side: 'buy' | 'sell';
  amount: number;
  maturityYears?: number;
}

const explicitGiltTrades = (actions: readonly PlayerAction[]): GiltTrade[] =>
  actions.flatMap((action) => {
    if (
      action.type !== 'buySellAsset' ||
      action.productType !== AssetProductType.Gilts ||
      !Number.isFinite(action.amountDelta) ||
      Math.abs(action.amountDelta) <= EPS
    ) return [];
    return [{
      side: action.amountDelta > 0 ? 'buy' as const : 'sell' as const,
      amount: Math.abs(action.amountDelta),
      maturityYears: action.maturityYears,
    }];
  });

const parseGiltTradeEvents = (events: readonly SimulationEvent[]): GiltTrade[] => {
  const trades: GiltTrade[] = [];
  for (const event of events) {
    const buy = event.message.match(/^Bought Gilts: \+([0-9.]+), cash -/i);
    if (buy) {
      trades.push({ side: 'buy', amount: Math.max(0, Number(buy[1])) });
      continue;
    }
    const sell = event.message.match(/^Sold Gilts: -([0-9.]+), cash \+/i);
    if (sell) trades.push({ side: 'sell', amount: Math.max(0, Number(sell[1])) });
  }
  return trades.filter((trade) => Number.isFinite(trade.amount) && trade.amount > 0);
};

const reconcileExecutedTrades = (
  actions: readonly PlayerAction[],
  events: readonly SimulationEvent[]
): GiltTrade[] => {
  const requested = explicitGiltTrades(actions);
  const executed = parseGiltTradeEvents(events);
  if (requested.length === 0) return executed;
  // The core action handler is authoritative for settlement amount because purchases/sales can be
  // capped by available reserves or holdings. Pair each settled trade with the matching management
  // instruction only to recover its chosen maturity.
  let requestIndex = 0;
  return executed.map((trade) => {
    while (requestIndex < requested.length && requested[requestIndex].side !== trade.side) requestIndex += 1;
    const instruction = requested[requestIndex];
    if (instruction) requestIndex += 1;
    return {
      ...trade,
      maturityYears: instruction?.maturityYears,
    };
  });
};

const scaleBuckets = (buckets: FundingMaturityBucket[], factor: number): FundingMaturityBucket[] =>
  buckets
    .map((bucket) => ({ ...bucket, notional: Math.max(0, bucket.notional * factor) }))
    .filter((bucket) => bucket.notional > 1);

const weightedRate = (buckets: readonly FundingMaturityBucket[], fallback: number): number => {
  const total = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
  if (total <= 0) return fallback;
  return buckets.reduce(
    (sum, bucket) => sum + Math.max(0, bucket.notional) * Math.max(0, bucket.rate),
    0
  ) / total;
};

const weightedRemainingYears = (buckets: readonly FundingMaturityBucket[], fallback: number): number => {
  const total = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
  if (total <= 0) return fallback;
  return buckets.reduce(
    (sum, bucket) => sum + Math.max(0, bucket.notional) * Math.max(1, bucket.monthsToMaturity),
    0
  ) / total / MONTHS_IN_YEAR;
};

const makeLifecycleEvent = (message: string, step: number): SimulationEvent => ({
  id: `gilt-maturity-${step}-${Date.now()}`,
  severity: 'info',
  message,
  timestamp: Date.now(),
  tags: ['market', 'liquidity'],
});

/**
 * Advances contractual gilt vintages after the core monthly close.
 *
 * Important behavioural distinction:
 * - explicit buy/sell actions supply management's chosen maturity, while settled transaction events
 *   supply the amount that actually executed;
 * - legacy policy-driven rebalance events remain supported for old saves/tests;
 * - contractual maturity is a passive balance-sheet flow: gilts run off into BoE reserves;
 * - nothing automatically reinvests those proceeds.
 *
 * The existing aggregate gilt line remains the accounting carrying-value line. Maturity therefore
 * transfers the proportional carrying value of the maturing notional into reserves, avoiding a
 * fictitious realised gain/loss while the securities engine is still aggregate rather than lot-based.
 */
export const advancePassiveGiltLifecycle = (args: {
  openingState: BankState;
  closingState: BankState;
  actions: readonly PlayerAction[];
  events: SimulationEvent[];
  dtMonths: number;
}): { maturedNotional: number; maturedCarryingValue: number } => {
  const { openingState, closingState, actions, events } = args;
  const dtMonths = Math.max(1, Math.round(args.dtMonths));
  const openingGilt = findAsset(openingState, AssetProductType.Gilts);
  const closingGilt = findAsset(closingState, AssetProductType.Gilts);
  const reserves = findAsset(closingState, AssetProductType.CashReserves);
  if (!openingGilt || !closingGilt || !reserves) {
    return { maturedNotional: 0, maturedCarryingValue: 0 };
  }

  let buckets = (openingState.fundingLadders?.[AssetProductType.Gilts] ?? []).map((bucket) => ({ ...bucket }));
  const trades = reconcileExecutedTrades(actions, events);
  const netTrade = trades.reduce(
    (sum, trade) => sum + (trade.side === 'buy' ? trade.amount : -trade.amount),
    0
  );
  // The core securities valuation happens before player actions, so reversing the net settled cash
  // trade from the pre-maturity closing balance estimates the carrying value when trading began.
  let carryingCursor = Math.max(0, closingGilt.balance - netTrade);

  const fallbackMaturityYears = clamp(
    closingState.behaviour.treasuryPolicy?.giltDurationYears ??
      openingState.behaviour.treasuryPolicy?.giltDurationYears ??
      5,
    0.25,
    30
  );

  for (const trade of trades) {
    if (trade.side === 'buy') {
      const maturityYears = clamp(trade.maturityYears ?? fallbackMaturityYears, 0.25, 30);
      const purchaseTenorMonths = Math.max(3, Math.round(maturityYears * MONTHS_IN_YEAR));
      const purchaseYield = giltYieldForMaturity(openingState, maturityYears);
      buckets.push({
        tenorMonths: purchaseTenorMonths,
        monthsToMaturity: purchaseTenorMonths,
        notional: trade.amount,
        rate: purchaseYield,
      });
      carryingCursor += trade.amount;
      continue;
    }

    if (carryingCursor <= EPS) {
      buckets = [];
      continue;
    }
    const saleFraction = clamp(trade.amount / carryingCursor, 0, 1);
    buckets = scaleBuckets(buckets, 1 - saleFraction);
    carryingCursor = Math.max(0, carryingCursor - trade.amount);
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
  const maturedCarryingValue = Math.min(
    Math.max(0, closingGilt.balance),
    Math.max(0, closingGilt.balance) * maturityFraction
  );

  closingState.fundingLadders ??= {};
  closingState.fundingLadders[AssetProductType.Gilts] = survivors;

  if (maturedCarryingValue > 0) {
    const beforeGiltBalance = Math.max(0, closingGilt.balance);
    closingGilt.balance = Math.max(0, beforeGiltBalance - maturedCarryingValue);
    reserves.balance += maturedCarryingValue;

    if (closingGilt.security) {
      closingGilt.security.amortisedCost = Math.max(
        0,
        (closingGilt.security.amortisedCost ?? beforeGiltBalance) * (1 - maturityFraction)
      );
      closingGilt.security.lossAllowance = Math.max(
        0,
        (closingGilt.security.lossAllowance ?? 0) * (1 - maturityFraction)
      );
      closingGilt.security.pendingRecycling = Math.max(
        0,
        (closingGilt.security.pendingRecycling ?? 0) * (1 - maturityFraction)
      );
    }
    if (closingGilt.encumbrance?.encumberedAmount) {
      closingGilt.encumbrance.encumberedAmount = Math.max(
        0,
        closingGilt.encumbrance.encumberedAmount * (1 - maturityFraction)
      );
    }

    const cashFlow = closingState.financial.cashFlowStatement;
    cashFlow.cashEnd += maturedCarryingValue;
    cashFlow.netChange += maturedCarryingValue;
    cashFlow.investingCashFlow += maturedCarryingValue;

    events.push(
      makeLifecycleEvent(
        `Gilt principal matured into BoE reserves: £${(maturedCarryingValue / 1e6).toFixed(1)}m; proceeds left uninvested`,
        closingState.time.step
      )
    );
  }

  if (survivors.length > 0) {
    closingGilt.interestRate = weightedRate(survivors, closingGilt.interestRate);
    if (closingGilt.security) {
      closingGilt.security.effectiveDurationYears = weightedRemainingYears(
        survivors,
        closingGilt.security.effectiveDurationYears ?? fallbackMaturityYears
      );
    }
  } else if (closingGilt.balance <= EPS) {
    closingGilt.interestRate = 0;
    if (closingGilt.security) closingGilt.security.effectiveDurationYears = 0.25;
  }

  return { maturedNotional, maturedCarryingValue };
};
