import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

describe('Board pressure mechanics', () => {
  it('increases under volatile earnings, weaker franchise, and thinner risk headroom', () => {
    const engine = createSimulationEngine();

    const benignState = cloneBankState(initialState);
    const benignCash = benignState.financial.balanceSheet.items.find(
      (line) => line.productType === AssetProductType.CashReserves
    );
    if (!benignCash) throw new Error('Missing cash line for benign board pressure test');
    const benignTargetCet1 = initialState.financial.capital.cet1 * 1.35;
    const benignCet1Delta = benignTargetCet1 - benignState.financial.capital.cet1;
    benignState.financial.capital.cet1 = benignTargetCet1;
    benignCash.balance += benignCet1Delta;
    benignState.behaviour.depositFranchiseStrength = 0.88;
    benignState.behaviour.reputation = 0.9;
    benignState.behaviour.earningsVolatility = 0.05e9;

    const pressuredState = cloneBankState(initialState);
    const pressuredCash = pressuredState.financial.balanceSheet.items.find(
      (line) => line.productType === AssetProductType.CashReserves
    );
    if (!pressuredCash) throw new Error('Missing cash line for pressured board pressure test');
    const pressuredTargetCet1 = initialState.financial.capital.cet1 * 1.2;
    const pressuredCet1Delta = pressuredTargetCet1 - pressuredState.financial.capital.cet1;
    pressuredState.financial.capital.cet1 = pressuredTargetCet1;
    pressuredCash.balance += pressuredCet1Delta;
    pressuredState.behaviour.depositFranchiseStrength = 0.45;
    pressuredState.behaviour.reputation = 0.5;
    pressuredState.behaviour.earningsVolatility = 0.8e9;

    const benign = engine.step({ state: benignState, config: baseConfig, actions: [], shocks: [] }).nextState;
    const pressured = engine.step({
      state: pressuredState,
      config: baseConfig,
      actions: [],
      shocks: [],
    }).nextState;

    expect(pressured.board.score).toBeGreaterThan(benign.board.score);
    expect(pressured.risk.riskMetrics.boardPressureScore).toBe(pressured.board.score);
    expect(pressured.status.hasFailed).toBe(false);
  });
});
