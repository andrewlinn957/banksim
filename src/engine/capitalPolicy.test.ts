import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { buildCapitalMarketsBook } from './capitalMarkets';
import { applyCapitalPolicyDistributions, createSimulationEngine } from './simulation';

describe('Capital policy and buffer stack', () => {
  it('clips dividend payout when MDA is triggered', () => {
    const state = cloneBankState(initialState);
    const cash = state.financial.balanceSheet.items.find((line) => line.productType === AssetProductType.CashReserves);
    if (!cash) throw new Error('Missing cash line for MDA test');
    const targetCet1 = state.risk.riskMetrics.rwa * 0.075;
    const cet1Delta = targetCet1 - state.financial.capital.cet1;
    state.financial.capital.cet1 = targetCet1;
    cash.balance += cet1Delta;
    state.behaviour.capitalPolicy = { dividendPayoutRatio: 0.9, at1CouponMode: 'auto' };

    const engine = createSimulationEngine();
    const next = engine.step({ state, config: baseConfig, actions: [], shocks: [] }).nextState;

    const maxRatio = 0; // Conservative bank policy suspends distributions inside buffers.
    const positiveIncome = Math.max(0, next.financial.incomeStatement.netIncome);
    const allowed = positiveIncome * maxRatio;

    expect(next.risk.compliance.mdaTriggered).toBe(true);
    expect(next.financial.incomeStatement.dividendsPaid).toBeLessThanOrEqual(allowed + 1);
  });

  it('applies AT1 coupon flexibility from policy mode', () => {
    const engine = createSimulationEngine();

    const payState = cloneBankState(initialState);
    const payCash = payState.financial.balanceSheet.items.find((line) => line.productType === AssetProductType.CashReserves);
    if (!payCash) throw new Error('Missing cash line for pay state');
    const targetCet1 = initialState.financial.capital.cet1 * 1.4;
    const payCet1Delta = targetCet1 - payState.financial.capital.cet1;
    payState.financial.capital.cet1 = targetCet1;
    payCash.balance += payCet1Delta;
    payState.behaviour.capitalPolicy = { dividendPayoutRatio: 0, at1CouponMode: 'pay' };
    payState.capitalMarkets = { transactions: [], at1CouponRateAnnual: 0.04, at1CouponIssuanceLockoutMonthsRemaining: 12 };
    const payResult = engine.step({ state: payState, config: baseConfig, actions: [], shocks: [] }).nextState;

    const skipState = cloneBankState(initialState);
    const skipCash = skipState.financial.balanceSheet.items.find((line) => line.productType === AssetProductType.CashReserves);
    if (!skipCash) throw new Error('Missing cash line for skip state');
    const skipCet1Delta = targetCet1 - skipState.financial.capital.cet1;
    skipState.financial.capital.cet1 = targetCet1;
    skipCash.balance += skipCet1Delta;
    skipState.behaviour.capitalPolicy = { dividendPayoutRatio: 0, at1CouponMode: 'skip' };
    skipState.capitalMarkets = { transactions: [], at1CouponRateAnnual: 0.04, at1CouponIssuanceLockoutMonthsRemaining: 3 };
    const skipResult = engine.step({ state: skipState, config: baseConfig, actions: [], shocks: [] }).nextState;

    expect(payResult.financial.incomeStatement.at1CouponExpense).toBeGreaterThan(0);
    expect(skipResult.financial.incomeStatement.at1CouponExpense).toBe(0);
    expect(payResult.financial.capital.cet1).toBeLessThan(skipResult.financial.capital.cet1);
    expect(payResult.capitalMarkets?.at1CouponSkipStreakMonths).toBe(0);
    expect(payResult.capitalMarkets?.at1CouponIssuanceLockoutMonthsRemaining).toBe(11);
    expect(skipResult.capitalMarkets?.at1CouponSkipStreakMonths).toBeGreaterThan(0);
    expect(skipResult.capitalMarkets?.at1CouponIssuanceLockoutMonthsRemaining).toBe(12);
  });
  it('restarts the clean-payment period after an underpaid coupon', () => {
    const state = cloneBankState(initialState);
    const cash = state.financial.balanceSheet.items.find(line => line.productType === AssetProductType.CashReserves);
    if (!cash) throw new Error('Missing cash line for AT1 underpayment test');
    cash.balance = 0;
    state.behaviour.capitalPolicy = { dividendPayoutRatio: 0, at1CouponMode: 'pay' };
    state.capitalMarkets = {
      transactions: [],
      at1CouponRateAnnual: 0.04,
      at1CouponIssuanceLockoutMonthsRemaining: 2,
    };

    const result = applyCapitalPolicyDistributions(state, baseConfig, 1 / 12, []);

    expect(result.at1CouponsPaid).toBe(0);
    expect(state.capitalMarkets.at1CouponSkipStreakMonths).toBeGreaterThan(0);
    expect(state.capitalMarkets.at1CouponIssuanceLockoutMonthsRemaining).toBe(12);
  });

  it('reopens AT1 market access only after twelve consecutive fully paid months', () => {
    const state = cloneBankState(initialState);
    const cash = state.financial.balanceSheet.items.find(line => line.productType === AssetProductType.CashReserves);
    if (!cash) throw new Error('Missing cash line for AT1 recovery test');
    const targetCet1 = initialState.financial.capital.cet1 * 1.4;
    cash.balance += targetCet1 - state.financial.capital.cet1;
    state.financial.capital.cet1 = targetCet1;
    state.behaviour.capitalPolicy = { dividendPayoutRatio: 0, at1CouponMode: 'pay' };
    state.capitalMarkets = {
      transactions: [],
      at1CouponRateAnnual: 0.04,
      at1CouponIssuanceLockoutMonthsRemaining: 12,
    };

    for (let month = 0; month < 12; month += 1) {
      const result = applyCapitalPolicyDistributions(state, baseConfig, 1 / 12, []);
      expect(result.at1CouponsPaid).toBeGreaterThan(0);
      expect(state.capitalMarkets.at1CouponIssuanceLockoutMonthsRemaining).toBe(11 - month);
    }

    const quote = buildCapitalMarketsBook(state, baseConfig, {
      instrument: 'at1', targetAmount: 100e6, maxSpreadBps: 10_000,
    });
    expect(quote.executedAmount).toBeGreaterThan(0);
  });

  it('blocks AT1 issue if a coupon skip is queued later in the same turn', () => {
    const result = createSimulationEngine().step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [
        { type: 'launchCapitalMarketsTransaction', instrument: 'at1', targetAmount: 100e6, maxSpreadBps: 10_000 },
        { type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'skip' },
      ],
      shocks: [],
    });

    expect(result.executions.capitalMarkets[0].executedAmount).toBe(0);
    expect(result.nextState.capitalMarkets?.at1CouponIssuanceLockoutMonthsRemaining).toBe(12);
  });

});
