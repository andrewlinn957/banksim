import { describe, expect, it } from 'vitest';
import { baseConfig } from './baseConfig';
import { applyScenarioConfig, scenarios } from './scenarios';
import { AssetProductType } from '../domain/enums';

describe('Scenario config overrides', () => {
  it('merges deeply without dropping non-overridden config branches', () => {
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
        riskLimits: {
          pillar2A: { totalRatio: 0.02 },
        },
        productParameters: {
          [AssetProductType.Mortgages]: {
            volumeElasticityToRate: -0.9,
          },
        },
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

      expect(merged.riskLimits.pillar2A?.totalRatio).toBe(0.02);
      expect(merged.riskLimits.minCet1Ratio).toBe(baseConfig.riskLimits.minCet1Ratio);

      expect(merged.productParameters[AssetProductType.Mortgages].volumeElasticityToRate).toBe(-0.9);
      expect(merged.productParameters[AssetProductType.Mortgages].baseDefaultRate).toBe(
        baseConfig.productParameters[AssetProductType.Mortgages].baseDefaultRate
      );
    } finally {
      scenarios.pop();
    }
  });
});
