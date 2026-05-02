import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

describe('IRRBB and hedges', () => {
  it('a directional hedge reduces absolute NII sensitivity with carry tradeoff', () => {
    const engine = createSimulationEngine();
    const baseline = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [],
      shocks: [],
    }).nextState;

    const direction =
      baseline.risk.riskMetrics.niiSensitivity100bp > 0
        ? 'receiveFixedPayFloat'
        : 'payFixedReceiveFloat';

    const hedged = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [
        {
          type: 'enterHedge',
          direction,
          notional: 2e9,
          fixedRate: 0.02,
          maturityMonths: 36,
        },
      ],
      shocks: [],
    }).nextState;

    expect(Math.abs(hedged.risk.riskMetrics.niiSensitivity100bp)).toBeLessThan(
      Math.abs(baseline.risk.riskMetrics.niiSensitivity100bp)
    );
    expect(Number.isFinite(hedged.financial.incomeStatement.hedgeCarry)).toBe(true);
  });
});
