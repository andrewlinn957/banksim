import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const balance = (state: typeof initialState, productType: string): number =>
  state.financial.balanceSheet.items.find(item => item.productType === productType)?.balance ?? 0;

const step = (action: Parameters<ReturnType<typeof createSimulationEngine>['step']>[0]['actions'][number]) =>
  createSimulationEngine().step({ state: cloneBankState(initialState), config: baseConfig, actions: [action], shocks: [] });

describe('capital-markets settlement integration', () => {
  it('settles a CET1 bookbuild with dilution, net proceeds and structured execution', () => {
    const baseline = createSimulationEngine().step({ state: cloneBankState(initialState), config: baseConfig, actions: [], shocks: [] }).nextState;
    const openingShares = initialState.equityMarket.sharesOutstanding;
    const result = step({ type: 'launchCapitalMarketsTransaction', instrument: 'cet1', targetAmount: 100e6, maxDiscount: 0.5 });
    const execution = result.executions.capitalMarkets[0];

    expect(execution.instrument).toBe('cet1');
    expect(execution.executedAmount).toBeGreaterThan(0);
    expect(execution.issuePrice).toBeGreaterThan(0);
    expect(result.nextState.equityMarket.sharesOutstanding).toBeGreaterThan(openingShares);
    expect(result.nextState.financial.capital.cet1).toBeGreaterThan(baseline.financial.capital.cet1);
    expect(balance(result.nextState, AssetProductType.CashReserves)).toBeGreaterThan(balance(baseline, AssetProductType.CashReserves));
    expect(result.nextState.capitalMarkets?.transactions.at(-1)?.instrument).toBe('cet1');
  });

  it('does not settle a book when management refuses the clearing discount', () => {
    const baseline = createSimulationEngine().step({ state: cloneBankState(initialState), config: baseConfig, actions: [], shocks: [] }).nextState;
    const result = step({ type: 'launchCapitalMarketsTransaction', instrument: 'cet1', targetAmount: 250e6, maxDiscount: 0.001 });
    const execution = result.executions.capitalMarkets[0];

    expect(execution.status).toBe('failed-price');
    expect(execution.executedAmount).toBe(0);
    expect(result.nextState.equityMarket.sharesOutstanding).toBeCloseTo(baseline.equityMarket.sharesOutstanding, 6);
    expect(result.nextState.financial.capital.cet1).toBeCloseTo(baseline.financial.capital.cet1, 2);
    expect(balance(result.nextState, AssetProductType.CashReserves)).toBeCloseTo(balance(baseline, AssetProductType.CashReserves), 2);
    expect(result.nextState.capitalMarkets?.transactions.at(-1)?.status).toBe('failed-price');
  });

  it('issues genuine AT1 and locks the clearing coupon into subsequent coupon economics', () => {
    const baseline = createSimulationEngine().step({ state: cloneBankState(initialState), config: baseConfig, actions: [], shocks: [] }).nextState;
    const result = step({ type: 'launchCapitalMarketsTransaction', instrument: 'at1', targetAmount: 80e6, maxSpreadBps: 2500 });
    const execution = result.executions.capitalMarkets[0];
    const coupon = result.nextState.capitalMarkets?.at1CouponRateAnnual;

    expect(execution.instrument).toBe('at1');
    expect(execution.executedAmount).toBeGreaterThan(0);
    expect(result.nextState.financial.capital.at1).toBeGreaterThan(baseline.financial.capital.at1);
    expect(coupon).toBeGreaterThan(0);
    expect(coupon).not.toBeCloseTo(baseConfig.riskLimits.capitalPolicy.at1CouponRateAnnual, 6);
    expect(result.nextState.financial.incomeStatement.at1CouponExpense).toBeGreaterThan(baseline.financial.incomeStatement.at1CouponExpense);
  });

  it('settles Tier 2 into both own funds and a contractual subordinated-debt vintage', () => {
    const result = step({ type: 'launchCapitalMarketsTransaction', instrument: 'tier2', targetAmount: 100e6, maxSpreadBps: 2500, tenorMonths: 84 });
    const execution = result.executions.capitalMarkets[0];
    const buckets = result.nextState.fundingLadders[LiabilityProductType.Tier2Debt] ?? [];

    expect(execution.executedAmount).toBeGreaterThan(0);
    expect(result.nextState.financial.capital.tier2).toBeGreaterThan(0);
    expect(balance(result.nextState, LiabilityProductType.Tier2Debt)).toBeGreaterThan(0);
    expect(buckets.some(bucket => bucket.tenorMonths === 84 && bucket.monthsToMaturity === 83)).toBe(true);
  });

  it('settles senior debt into the ordinary long-term funding ladder', () => {
    const opening = balance(initialState, LiabilityProductType.WholesaleFundingLT);
    const result = step({ type: 'launchCapitalMarketsTransaction', instrument: 'senior', targetAmount: 150e6, maxSpreadBps: 1500, tenorMonths: 36 });
    const execution = result.executions.capitalMarkets[0];
    const buckets = result.nextState.fundingLadders[LiabilityProductType.WholesaleFundingLT] ?? [];

    expect(execution.executedAmount).toBeGreaterThan(0);
    expect(balance(result.nextState, LiabilityProductType.WholesaleFundingLT)).toBeGreaterThan(opening - 50e6);
    expect(buckets.some(bucket => bucket.tenorMonths === 36 && bucket.monthsToMaturity === 35)).toBe(true);
  });

  it('uses executed issuance history to make a second market visit harder', () => {
    const engine = createSimulationEngine();
    const first = engine.step({
      state: cloneBankState(initialState), config: baseConfig,
      actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'tier2', targetAmount: 120e6, maxSpreadBps: 2500, tenorMonths: 60 }], shocks: [],
    });
    const second = engine.step({
      state: first.nextState, config: baseConfig,
      actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'tier2', targetAmount: 120e6, maxSpreadBps: 2500, tenorMonths: 60 }], shocks: [],
    });
    const a = first.executions.capitalMarkets[0];
    const b = second.executions.capitalMarkets[0];

    expect(b.recentIssuanceRatio).toBeGreaterThan(a.recentIssuanceRatio);
    expect(b.clearingSpreadBps).toBeGreaterThan(a.clearingSpreadBps ?? 0);
    expect(b.demandAmount).toBeLessThan(a.demandAmount);
  });
});
