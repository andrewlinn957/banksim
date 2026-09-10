import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { nelsonSiegelYield } from './ukMarketModel';
import { createSimulationEngine } from './simulation';

const item = (state: typeof initialState, product: AssetProductType) =>
  state.financial.balanceSheet.items.find((row) => row.productType === product)!;

describe('Contractual treasury asset lifecycle', () => {
  it('reprices the settlement asset to Bank Rate without making an investment decision', () => {
    const state = cloneBankState(initialState);
    state.market.baseRate = 0.031;
    item(state, AssetProductType.CashReserves).interestRate = 0.09;
    const { nextState, events } = createSimulationEngine().step({ state, config: baseConfig, actions: [], shocks: [] });
    expect(item(nextState, AssetProductType.CashReserves).interestRate).toBeCloseTo(nextState.market.baseRate, 12);
    expect(events.some((event) => /^Bought Gilts:|^Sold Gilts:/i.test(event.message))).toBe(false);
  });

  it('matures an opening gilt vintage into reserves inside the authoritative close', () => {
    const state = cloneBankState(initialState);
    const openingGilts = item(state, AssetProductType.Gilts).balance;
    const { nextState, events } = createSimulationEngine().step({ state, config: baseConfig, actions: [], shocks: [] });
    const giltBuckets = nextState.assetMaturityLadders?.[AssetProductType.Gilts] ?? [];
    expect(giltBuckets).toHaveLength(119);
    expect(giltBuckets.every((bucket) => bucket.monthsToMaturity > 0)).toBe(true);
    expect(nextState.fundingLadders[AssetProductType.Gilts]).toBeUndefined();
    expect(item(nextState, AssetProductType.Gilts).balance).toBeLessThan(openingGilts);
    expect(events.some((event) => event.message.includes('principal matured into Cash & Reserves'))).toBe(true);
    expect(nextState.financial.cashFlowStatement.cashEnd).toBeCloseTo(item(nextState, AssetProductType.CashReserves).balance, 2);
  });

  it('records an explicit gilt purchase at its selected curve tenor', () => {
    const state = cloneBankState(initialState);
    const expectedYield = nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, 2);
    const { nextState, executions } = createSimulationEngine().step({
      state,
      config: baseConfig,
      actions: [{ type: 'buySellAsset', productType: AssetProductType.Gilts, amountDelta: 100e6, tenorMonths: 24 }],
      shocks: [],
    });
    const execution = executions.assetTrades.find((trade) => trade.productType === AssetProductType.Gilts);
    const purchased = (nextState.assetMaturityLadders?.[AssetProductType.Gilts] ?? []).find((bucket) => bucket.tenorMonths === 24);
    expect(execution?.executedAmount).toBeCloseTo(100e6, 2);
    expect(purchased).toBeDefined();
    expect(purchased?.notional).toBeCloseTo(execution!.executedAmount, 2);
    expect(purchased?.rate).toBeCloseTo(expectedYield, 10);
  });

  it('uses the structured settlement amount when a purchase is clipped by reserves', () => {
    const state = cloneBankState(initialState);
    const { nextState, executions, events } = createSimulationEngine().step({
      state,
      config: baseConfig,
      actions: [{ type: 'buySellAsset', productType: AssetProductType.Gilts, amountDelta: 10e9, tenorMonths: 60 }],
      shocks: [],
    });
    const execution = executions.assetTrades.find((trade) => trade.productType === AssetProductType.Gilts);
    const purchased = (nextState.assetMaturityLadders?.[AssetProductType.Gilts] ?? []).find((bucket) => bucket.tenorMonths === 60);
    expect(events.some((event) => event.message.includes('Insufficient cash to buy Gilts'))).toBe(true);
    expect(execution?.requestedAmount).toBe(10e9);
    expect(execution?.executedAmount ?? 0).toBeGreaterThan(0);
    expect(execution?.executedAmount ?? 0).toBeLessThan(10e9);
    expect(purchased?.notional).toBeCloseTo(execution!.executedAmount, 2);
  });
});
