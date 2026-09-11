import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import {
  DEFAULT_THREE_YEAR_PLAN_SETTINGS,
  THREE_YEAR_PLAN_HORIZON_MONTHS,
  createThreeYearPlanState,
  type ThreeYearPlanTarget,
} from '../domain/threeYearPlan';
import { resolveFeatureFlags } from './featureFlags';
import {
  ThreeYearPlanMetricRegistry,
  evaluateThreeYearPlan,
  updateBoardConfidenceFromPlan,
} from './threeYearPlan';

interface TestBank {
  eps: number;
  cash: number;
  lcr: number;
  franchise: number;
  regulatoryBreach: boolean;
}

const epsTarget: ThreeYearPlanTarget = {
  metricId: 'eps',
  weight: 1,
  kind: 'minimum',
  baseline: 8,
  milestones: [
    { month: 12, lower: 9 },
    { month: 24, lower: 10 },
    { month: 36, lower: 11 },
  ],
};

const registry = new ThreeYearPlanMetricRegistry<TestBank>()
  .register({ id: 'eps', label: 'EPS', format: 'moneyPerShare', read: (state) => state.eps });

describe('Three-Year Plan', () => {
  it('is exactly 36 months and disabled by default', () => {
    expect(THREE_YEAR_PLAN_HORIZON_MONTHS).toBe(36);
    expect(DEFAULT_THREE_YEAR_PLAN_SETTINGS.enabled).toBe(false);
    expect(resolveFeatureFlags(baseConfig).threeYearPlan).toBe(false);
    const plan = createThreeYearPlanState({ startStep: 0, targets: [epsTarget] });
    expect(plan.enabled).toBe(false);
    expect(plan.horizonMonths).toBe(36);
    expect(plan.boardConfidence).toBeUndefined();
  });

  it('tracks a quarterly trajectory between annual milestones', () => {
    const result = evaluateThreeYearPlan({
      state: { eps: 8.5, cash: 1, lcr: 1, franchise: 1, regulatoryBreach: false },
      month: 6,
      targets: [epsTarget],
      registry,
    });
    expect(result.metrics[0].targetLower).toBeCloseTo(8.5, 12);
    expect(result.score).toBeCloseTo(100, 12);
  });

  it('gives identical plan scores and Board Confidence when non-plan conditions differ', () => {
    const efficient: TestBank = {
      eps: 9.5,
      cash: 0.5e9,
      lcr: 1.2,
      franchise: 0.9,
      regulatoryBreach: false,
    };
    const cashHeavyAndStressed: TestBank = {
      eps: 9.5,
      cash: 10e9,
      lcr: 8,
      franchise: 0.2,
      regulatoryBreach: true,
    };

    const a = evaluateThreeYearPlan({ state: efficient, month: 12, targets: [epsTarget], registry });
    const b = evaluateThreeYearPlan({ state: cashHeavyAndStressed, month: 12, targets: [epsTarget], registry });

    expect(a.score).toBe(b.score);
    expect(updateBoardConfidenceFromPlan(70, a.score)).toBe(updateBoardConfidenceFromPlan(70, b.score));
  });

  it('allows cash-heavy strategy to affect confidence only through a plan metric it worsens', () => {
    const onPlan = evaluateThreeYearPlan({
      state: { eps: 9, cash: 0.5e9, lcr: 1.2, franchise: 0.8, regulatoryBreach: false },
      month: 12,
      targets: [epsTarget],
      registry,
    });
    const missesPlan = evaluateThreeYearPlan({
      state: { eps: 7.2, cash: 10e9, lcr: 8, franchise: 0.8, regulatoryBreach: false },
      month: 12,
      targets: [epsTarget],
      registry,
    });

    expect(missesPlan.score).toBeLessThan(onPlan.score);
    expect(updateBoardConfidenceFromPlan(70, missesPlan.score)).toBeLessThan(
      updateBoardConfidenceFromPlan(70, onPlan.score)
    );
  });
});
