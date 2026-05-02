import { describe, expect, it } from 'vitest';
import { cloneBankState } from '../engine/clone';
import { initialState } from './initialState';
import { getScenarioStepPayload } from './scenarios';

describe('Scenario arc engine', () => {
  it('branches shocks deterministically from metric triggers', () => {
    const lowLcr = cloneBankState(initialState);
    lowLcr.risk.riskMetrics.lcr = 1.05;

    const lowPayload = getScenarioStepPayload({
      scenarioId: 'wholesale-funding-reliance',
      stepNumber: 2,
      state: lowLcr,
      actions: [],
    });

    expect(lowPayload.shocks.some((shock) => shock.type === 'rolloverStress')).toBe(true);
    expect(lowPayload.milestones.length).toBeGreaterThan(0);

    const highLcr = cloneBankState(initialState);
    highLcr.risk.riskMetrics.lcr = 1.2;

    const highPayload = getScenarioStepPayload({
      scenarioId: 'wholesale-funding-reliance',
      stepNumber: 2,
      state: highLcr,
      actions: [],
    });

    const lowSpread = lowPayload.shocks.find((shock) => shock.type === 'rolloverStress');
    const highSpread = highPayload.shocks.find((shock) => shock.type === 'rolloverStress');
    expect(lowSpread && highSpread && lowSpread.type === 'rolloverStress' && highSpread.type === 'rolloverStress').toBe(true);
    if (lowSpread?.type === 'rolloverStress' && highSpread?.type === 'rolloverStress') {
      expect(lowSpread.spreadBps).toBeGreaterThan(highSpread.spreadBps);
    }
  });
});
