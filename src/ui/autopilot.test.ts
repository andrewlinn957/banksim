import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from '../engine/clone';
import { SimulationController } from './simulationController';

describe('Autopilot controls', () => {
  it('multi-month run matches repeated single-month stepping', () => {
    const controller = new SimulationController(baseConfig);
    const start = cloneBankState(initialState);

    let manual = cloneBankState(start);
    for (let i = 0; i < 6; i++) {
      manual = controller.step(manual, [], []).nextState;
    }

    const auto = controller.runMonths({
      state: start,
      months: 6,
      actions: [],
      shocks: [],
    });

    expect(auto.records.length).toBe(6);
    expect(auto.finalState.risk.riskMetrics.cet1Ratio).toBeCloseTo(manual.risk.riskMetrics.cet1Ratio, 10);
    expect(auto.finalState.risk.riskMetrics.lcr).toBeCloseTo(manual.risk.riskMetrics.lcr, 10);
    expect(auto.finalState.risk.riskMetrics.nsfr).toBeCloseTo(manual.risk.riskMetrics.nsfr, 10);
  });

  it('breach stop condition halts autopilot on threshold crossing', () => {
    const controller = new SimulationController(baseConfig);

    const auto = controller.runMonths({
      state: cloneBankState(initialState),
      months: 12,
      actions: [],
      shocks: () => [
        { type: 'macroDownturn', pdMultiplier: 4, lgdMultiplier: 2.25 },
        { type: 'idiosyncraticRun', outflowRateMultiplier: 1.8 },
      ],
      stopCondition: { kind: 'breach' },
    });

    expect(auto.records.length).toBeLessThan(12);
    expect(auto.stoppedReason).toBe('breach');
  });
});
