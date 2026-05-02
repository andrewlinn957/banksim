import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { cloneBankState } from './clone';
import { evaluateScenarioGoals } from './scoring';

describe('Scenario scoring', () => {
  it('returns transparent metric-level detail with metric keys', () => {
    const score = evaluateScenarioGoals(initialState, {
      horizonMonths: 12,
      objectives: [
        { label: 'CET1 floor', metric: 'cet1Ratio', direction: 'min', target: 0.1, weight: 50 },
        { label: 'NSFR floor', metric: 'nsfr', direction: 'min', target: 1, weight: 50 },
      ],
    });

    expect(score.details.length).toBe(2);
    expect(score.details[0].metric).toBe('cet1Ratio');
    expect(score.details[1].metric).toBe('nsfr');
    expect(score.maxScore).toBe(100);
    expect(score.score).toBeGreaterThan(0);
  });

  it('applies horizon quality penalty for fragile long-run states', () => {
    const robust = cloneBankState(initialState);
    const fragile = cloneBankState(initialState);
    fragile.behaviour.depositFranchiseStrength = 0.35;
    fragile.risk.riskMetrics.lcr = 0.9;
    fragile.risk.riskMetrics.nsfr = 0.92;
    fragile.risk.riskMetrics.fundingStressIndex = 0.9;

    const goals = {
      horizonMonths: 60,
      objectives: [{ label: 'CET1 floor', metric: 'cet1Ratio' as const, direction: 'min' as const, target: 0.1, weight: 100 }],
    };

    const robustScore = evaluateScenarioGoals(robust, goals);
    const fragileScore = evaluateScenarioGoals(fragile, goals);

    expect(fragileScore.qualityPenalty).toBeGreaterThan(robustScore.qualityPenalty);
    expect(fragileScore.completionPct).toBeLessThan(robustScore.completionPct);
  });
});
