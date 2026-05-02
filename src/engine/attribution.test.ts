import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

describe('Step attribution diagnostics', () => {
  it('reconciles metric movements and links driver lines to events', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);

    const result = engine.step({
      state,
      config: baseConfig,
      actions: [
        {
          type: 'adjustRate',
          productType: LiabilityProductType.RetailSavingsDeposits,
          newRate: 0.03,
        },
        {
          type: 'issueDebt',
          productType: LiabilityProductType.WholesaleFundingLT,
          amount: 8e9,
        },
      ],
      shocks: [
        { type: 'macroDownturn', pdMultiplier: 1.45, lgdMultiplier: 1.25 },
        { type: 'marketSpreadShock', wholesaleSpreadBps: 80, loanSpreadBps: 30, repoHaircutIncreasePct: 0.01 },
      ],
    });

    const attribution = result.diagnostics.attribution;
    expect(attribution).toBeDefined();

    const eventIdSet = new Set(result.events.map((event) => event.id));
    (['cet1Ratio', 'lcr', 'nsfr', 'nim'] as const).forEach((metricKey) => {
      const metric = attribution.metrics[metricKey];
      expect(metric.lines.length).toBeGreaterThan(0);
      const reconciled = metric.lines.reduce((sum, line) => sum + line.effect, 0);
      expect(reconciled).toBeCloseTo(metric.delta, 12);

      metric.lines.forEach((line) => {
        line.eventIds.forEach((id) => expect(eventIdSet.has(id)).toBe(true));
      });
    });
  });
});
