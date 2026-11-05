import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { cloneBankState } from '../engine/clone';
import { createSimulationEngine } from '../engine/simulation';
import { AssetProductType as A } from '../domain/enums';
import { loanCarryingAmounts } from './loanBalances';

describe('loan accounting bases', () => {
  it('reconciles gross, allowance and net across opening and successive closes', () => {
    let state = cloneBankState(initialState);
    const engine = createSimulationEngine();
    for (let month = 0; month < 4; month++) {
      const book = loanCarryingAmounts(state);
      expect(book.total.fundedAllowance).toBeGreaterThan(0);
      expect(book.total.gross).toBeGreaterThan(book.total.net);
      for (const row of Object.values(book.byProduct)) {
        expect(Math.abs(row.reconciliationDifference)).toBeLessThan(0.01);
      }
      const next = engine.step({ state, config: baseConfig, actions: [], shocks: [] }).nextState;
      for (const [product, row] of Object.entries(book.byProduct)) {
        expect(next.periodFlows?.openingLoanExposureByProduct[product as A]).toBe(row.gross);
      }
      state = next;
    }
  });

  it('includes workout-only exposure and exposes ledger inconsistencies', () => {
    const state = cloneBankState(initialState);
    delete state.loanCohorts[A.ConsumerLoans];
    state.workoutPipelines[A.ConsumerLoans] = [{ productType: A.ConsumerLoans, sourceCohortId: 1, stageAtDefault: 'stage3', defaultedPrincipal: 100, expectedRecoveryRate: 0.6, monthsToResolution: 6 }];
    const item = state.financial.balanceSheet.items.find(item => item.productType === A.ConsumerLoans)!;
    item.balance = 60;
    item.lossAllowance = 40;
    expect(loanCarryingAmounts(state).byProduct[A.ConsumerLoans]).toEqual({ gross: 100, fundedAllowance: 40, net: 60, reconciliationDifference: 0 });
    const next = createSimulationEngine().step({ state, config: baseConfig, actions: [], shocks: [] }).nextState;
    expect(next.periodFlows?.openingLoanExposureByProduct[A.ConsumerLoans]).toBe(100);
    item.balance = 61;
    expect(loanCarryingAmounts(state).byProduct[A.ConsumerLoans]?.reconciliationDifference).toBe(-1);
  });

  it('uses accounting gross when detailed ledgers are unavailable', () => {
    const state = cloneBankState(initialState);
    delete state.loanCohorts[A.ConsumerLoans];
    delete state.workoutPipelines[A.ConsumerLoans];
    const item = state.financial.balanceSheet.items.find(item => item.productType === A.ConsumerLoans)!;
    item.balance = 60;
    item.lossAllowance = 40;
    expect(loanCarryingAmounts(state).byProduct[A.ConsumerLoans]?.gross).toBe(100);
  });
});
