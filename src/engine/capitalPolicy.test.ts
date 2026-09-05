import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

describe('Capital policy and buffer stack', () => {
  it('clips dividend payout when MDA is triggered', () => {
    const state = cloneBankState(initialState);
    const cash = state.financial.balanceSheet.items.find((line) => line.productType === AssetProductType.CashReserves);
    if (!cash) throw new Error('Missing cash line for MDA test');
    const targetCet1 = initialState.financial.capital.cet1 * 0.75;
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
    const payResult = engine.step({ state: payState, config: baseConfig, actions: [], shocks: [] }).nextState;

    const skipState = cloneBankState(initialState);
    const skipCash = skipState.financial.balanceSheet.items.find((line) => line.productType === AssetProductType.CashReserves);
    if (!skipCash) throw new Error('Missing cash line for skip state');
    const skipCet1Delta = targetCet1 - skipState.financial.capital.cet1;
    skipState.financial.capital.cet1 = targetCet1;
    skipCash.balance += skipCet1Delta;
    skipState.behaviour.capitalPolicy = { dividendPayoutRatio: 0, at1CouponMode: 'skip' };
    const skipResult = engine.step({ state: skipState, config: baseConfig, actions: [], shocks: [] }).nextState;

    expect(payResult.financial.incomeStatement.at1CouponExpense).toBeGreaterThan(0);
    expect(skipResult.financial.incomeStatement.at1CouponExpense).toBe(0);
    expect(payResult.financial.capital.cet1).toBeLessThan(skipResult.financial.capital.cet1);
  });
});
