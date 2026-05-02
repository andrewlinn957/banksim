import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from '../engine/clone';
import { SimulationController } from './simulationController';

describe('Simulation preview', () => {
  it('runs deterministic preview paths without mutating current state', () => {
    const controller = new SimulationController(baseConfig);
    const state = cloneBankState(initialState);
    const beforeStep = state.time.step;
    const beforeMortgageBalance = state.financial.balanceSheet.items.find(
      (item) => item.productType === AssetProductType.Mortgages
    )?.balance;

    const preview = controller.preview(
      state,
      [
        {
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: 0.049,
        },
      ],
      []
    );

    expect(preview.pathCount).toBeGreaterThan(1);
    expect(preview.breachProbability).toBeGreaterThanOrEqual(0);
    expect(preview.breachProbability).toBeLessThanOrEqual(1);
    expect(state.time.step).toBe(beforeStep);
    expect(
      state.financial.balanceSheet.items.find((item) => item.productType === AssetProductType.Mortgages)?.balance
    ).toBe(beforeMortgageBalance);
  });
});
