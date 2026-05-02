import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { SimulationController } from '../ui/simulationController';

describe('Replay determinism', () => {
  it('replay reproduces final state metrics from saved timeline', () => {
    const controller = new SimulationController(baseConfig);
    const start = cloneBankState(initialState);

    const run = controller.runMonths({
      state: start,
      months: 5,
      actions: (_, idx) => [
        {
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: 0.05 + idx * 0.0005,
        },
      ],
      shocks: (_, idx) =>
        idx === 2 ? [{ type: 'macroDownturn', pdMultiplier: 1.35, lgdMultiplier: 1.15 }] : [],
    });

    const replay = controller.replay(start, run.timeline);

    expect(replay.finalState.risk.riskMetrics.cet1Ratio).toBeCloseTo(run.finalState.risk.riskMetrics.cet1Ratio, 12);
    expect(replay.finalState.risk.riskMetrics.lcr).toBeCloseTo(run.finalState.risk.riskMetrics.lcr, 12);
    expect(replay.finalState.risk.riskMetrics.nsfr).toBeCloseTo(run.finalState.risk.riskMetrics.nsfr, 12);
    expect(replay.finalState.financial.capital.cet1).toBeCloseTo(run.finalState.financial.capital.cet1, 8);
  });
});
