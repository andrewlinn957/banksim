import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from './clone';
import { buildRecommendations } from './recommendations';
import { createSimulationEngine } from './simulation';

describe('Contextual recommendations', () => {
  it('returns explainable recommendations with rationale and confidence', () => {
    const stressed = cloneBankState(initialState);
    stressed.behaviour.fundingConfidenceState = 'watch';
    stressed.behaviour.capitalPolicy = { dividendPayoutRatio: 0.35, at1CouponMode: 'auto' };

    const recommendations = buildRecommendations(stressed, baseConfig);
    expect(recommendations.length).toBeGreaterThan(0);
    recommendations.forEach((rec) => {
      expect(rec.rationale.length).toBeGreaterThan(10);
      expect(rec.caveat.length).toBeGreaterThan(10);
      expect(['high', 'medium', 'low']).toContain(rec.confidence);
      expect(rec.actions.length).toBeGreaterThan(0);
    });
  });

  it('never emits recommendations that violate hard constraints on projected step', () => {
    const engine = createSimulationEngine();
    const recommendations = buildRecommendations(cloneBankState(initialState), baseConfig);

    recommendations.forEach((rec) => {
      const projected = engine.step({
        state: cloneBankState(initialState),
        config: baseConfig,
        actions: rec.actions,
        shocks: [],
      }).nextState;
      expect(projected.status.hasFailed).toBe(false);
      expect(projected.risk.compliance.cet1Breached).toBe(false);
      expect(projected.risk.compliance.leverageBreached).toBe(false);
      expect(projected.risk.compliance.lcrBreached).toBe(false);
      expect(projected.risk.compliance.nsfrBreached).toBe(false);
    });
  });
});
