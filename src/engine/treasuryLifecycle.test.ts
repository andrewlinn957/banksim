import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { nelsonSiegelYield } from './ukMarketModel';
import { createSimulationEngineWithTreasuryLifecycle } from './simulationFacade';

const item = (state: typeof initialState, product: AssetProductType) =>
  state.financial.balanceSheet.items.find((row) => row.productType === product)!;

describe('Passive treasury lifecycle', () => {
  it('reprices BoE reserves to the simulated Bank Rate without investing them', () => {
    const state = cloneBankState(initialState);
    state.market.baseRate = 0.031;
    item(state, AssetProductType.CashReserves).interestRate = 0.09;
    const engine = createSimulationEngineWithTreasuryLifecycle();

    const { nextState, events } = engine.step({ state, config: baseConfig, actions: [], shocks: [] });

    expect(item(nextState, AssetProductType.CashReserves).interestRate).toBeCloseTo(nextState.market.baseRate, 12);
    expect(events.some((event) => /^Bought Gilts:|^Sold Gilts:/i.test(event.message))).toBe(false);
  });

  it('lets an opening gilt vintage mature into reserves with no reinvestment action', () => {
    const state = cloneBankState(initialState);
    const openingCash = item(state, AssetProductType.CashReserves).balance;
    const openingGilts = item(state, AssetProductType.Gilts).balance;
    const engine = createSimulationEngineWithTreasuryLifecycle();

    const { nextState, events } = engine.step({ state, config: baseConfig, actions: [], shocks: [] });
    const giltBuckets = nextState.fundingLadders[AssetProductType.Gilts] ?? [];

    expect(giltBuckets).toHaveLength(119);
    expect(giltBuckets.every((bucket) => bucket.monthsToMaturity > 0)).toBe(true);
    expect(item(nextState, AssetProductType.Gilts).balance).toBeLessThan(openingGilts);
    expect(item(nextState, AssetProductType.CashReserves).balance).not.toBe(openingCash);
    expect(events.some((event) => event.message.includes('Gilt principal matured into BoE reserves'))).toBe(true);
    expect(events.some((event) => /^Bought Gilts:|^Sold Gilts:/i.test(event.message))).toBe(false);
  });

  it('records an explicit gilt purchase at its selected maturity point on the simulated curve', () => {
    const state = cloneBankState(initialState);
    const engine = createSimulationEngineWithTreasuryLifecycle();
    const expectedYield = nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, 2);

    const { nextState, events } = engine.step({
      state,
      config: baseConfig,
      actions: [
        {
          type: 'buySellAsset',
          productType: AssetProductType.Gilts,
          amountDelta: 100e6,
          maturityYears: 2,
        },
      ],
      shocks: [],
    });

    const giltBuckets = nextState.fundingLadders[AssetProductType.Gilts] ?? [];
    const purchased = giltBuckets.find((bucket) => bucket.tenorMonths === 24);
    expect(events.some((event) => /^Bought Gilts:/i.test(event.message))).toBe(true);
    expect(purchased).toBeDefined();
    expect(purchased?.rate).toBeCloseTo(expectedYield, 10);
  });

  it('records only the gilt notional that actually settles when a purchase exceeds available reserves', () => {
    const state = cloneBankState(initialState);
    const engine = createSimulationEngineWithTreasuryLifecycle();

    const { nextState, events } = engine.step({
      state,
      config: baseConfig,
      actions: [
        {
          type: 'buySellAsset',
          productType: AssetProductType.Gilts,
          amountDelta: 10e9,
          maturityYears: 5,
        },
      ],
      shocks: [],
    });

    const settlement = events.find((event) => /^Bought Gilts:/i.test(event.message));
    const executed = Number(settlement?.message.match(/^Bought Gilts: \+([0-9.]+)/i)?.[1] ?? 0);
    const purchased = (nextState.fundingLadders[AssetProductType.Gilts] ?? []).find(
      (bucket) => bucket.tenorMonths === 60
    );
    expect(events.some((event) => event.message.includes('Insufficient cash to buy Gilts'))).toBe(true);
    expect(executed).toBeGreaterThan(0);
    expect(executed).toBeLessThan(10e9);
    expect(purchased?.notional).toBeCloseTo(executed, 2);
  });
});
