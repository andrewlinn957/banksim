import { describe, expect, it } from 'vitest';
import { baseConfig } from './baseConfig';
import { applyScenarioConfig, scenarios } from './scenarios';
import { AssetProductType } from '../domain/enums';

describe('Scenario config overrides', () => {
  it('merges overrides without dropping non-overridden config branches', () => {
    const scenarioId = 'unit-test-config-merge';
    scenarios.push({
      id: scenarioId,
      name: 'Unit test scenario',
      description: 'Used only for merge verification.',
      scheduledShocks: [],
      configOverrides: {
        behaviour: {
          loanBaselineGrowthMonthly: 0.01,
        },
        shockParameters: {
          idiosyncraticRun: {
            maxRunOffRate: 0.7,
          },
        },
        tolerances: {
          cashFlowBreachThreshold: 5,
        },
        productParameters: {
          [AssetProductType.Mortgages]: {
            volumeElasticityToRate: -0.9,
          } as any,
        } as any,
      },
    });

    try {
      const merged = applyScenarioConfig(baseConfig, scenarioId);

      expect(merged.behaviour.loanBaselineGrowthMonthly).toBe(0.01);
      expect(merged.behaviour.depositBaselineGrowthMonthly).toBe(baseConfig.behaviour.depositBaselineGrowthMonthly);

      expect(merged.shockParameters.idiosyncraticRun.maxRunOffRate).toBe(0.7);
      expect(merged.shockParameters.idiosyncraticRun.baseRunOffRate).toBe(
        baseConfig.shockParameters.idiosyncraticRun.baseRunOffRate
      );

      expect(merged.tolerances.cashFlowBreachThreshold).toBe(5);
      expect(merged.tolerances.cashFlowRoundingTolerance).toBe(baseConfig.tolerances.cashFlowRoundingTolerance);

      expect(merged.productParameters[AssetProductType.Mortgages].volumeElasticityToRate).toBe(-0.9);
      expect(merged.productParameters[AssetProductType.Mortgages].riskWeight).toBe(
        baseConfig.productParameters[AssetProductType.Mortgages].riskWeight
      );
    } finally {
      scenarios.pop();
    }
  });
});
