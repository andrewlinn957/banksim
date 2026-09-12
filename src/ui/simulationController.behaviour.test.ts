import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { SimulationController } from './simulationController';

describe('simulation controller behaviour', () => {
  it('applies a recurring policy decision while advancing the simulation clock', () => {
    const controller = new SimulationController(baseConfig);
    const { nextState } = controller.step(
      initialState,
      [{ type: 'setMortgagePolicy', maxLtv: 0.75, fixedPeriodMonths: 36 }],
      []
    );
    expect(nextState.time.step).toBe(initialState.time.step + 1);
    expect(nextState.behaviour.mortgagePolicy).toEqual({ maxLtv: 0.75, fixedPeriodMonths: 36 });
  });
});
