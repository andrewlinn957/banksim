import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { createSimulationEngine } from './simulation';

const getBalance = (state: typeof initialState, productType: AssetProductType | LiabilityProductType): number => {
  return state.financial.balanceSheet.items.find((i) => i.productType === productType)?.balance ?? 0;
};

const pctChange = (before: number, after: number): number => {
  if (Math.abs(before) < 1e-9) return after === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (after - before) / before;
};

describe('Initial t0->t1 sanity', () => {
  it('does not produce implausibly large one-step balance jumps', () => {
    const engine = createSimulationEngine();
    const { nextState } = engine.step({ state: initialState, config: baseConfig, actions: [], shocks: [] });

    const cash0 = getBalance(initialState, AssetProductType.CashReserves);
    const cash1 = getBalance(nextState, AssetProductType.CashReserves);

    const mortgages0 = getBalance(initialState, AssetProductType.Mortgages);
    const mortgages1 = getBalance(nextState, AssetProductType.Mortgages);

    const corpLoans0 = getBalance(initialState, AssetProductType.CorporateLoans);
    const corpLoans1 = getBalance(nextState, AssetProductType.CorporateLoans);

    const retailDeps0 = getBalance(initialState, LiabilityProductType.RetailDeposits);
    const retailDeps1 = getBalance(nextState, LiabilityProductType.RetailDeposits);

    const corpDeps0 = getBalance(initialState, LiabilityProductType.CorporateDeposits);
    const corpDeps1 = getBalance(nextState, LiabilityProductType.CorporateDeposits);

    const cashPct = pctChange(cash0, cash1);
    const mortgagesPct = pctChange(mortgages0, mortgages1);
    const corpLoansPct = pctChange(corpLoans0, corpLoans1);
    const retailDepsPct = pctChange(retailDeps0, retailDeps1);
    const corpDepsPct = pctChange(corpDeps0, corpDeps1);

    expect.soft(cashPct, `cash delta ${(cashPct * 100).toFixed(2)}%`).toBeLessThan(0.5);
    expect.soft(mortgagesPct, `mortgages delta ${(mortgagesPct * 100).toFixed(2)}%`).toBeGreaterThan(-0.02);
    expect.soft(corpLoansPct, `corp loans delta ${(corpLoansPct * 100).toFixed(2)}%`).toBeGreaterThan(-0.1);
    expect.soft(retailDepsPct, `retail deps delta ${(retailDepsPct * 100).toFixed(2)}%`).toBeLessThan(0.02);
    expect.soft(corpDepsPct, `corp deps delta ${(corpDepsPct * 100).toFixed(2)}%`).toBeLessThan(0.02);
  });
});
