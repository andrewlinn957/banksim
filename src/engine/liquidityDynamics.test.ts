import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { calculateRiskMetrics } from './metrics';
import { cloneBankState } from './clone';

describe('Dynamic liquidity factors', () => {
  it('behavioural stress worsens management measures without changing prescribed ratios', () => {
    const benign = cloneBankState(initialState);
    benign.market.macroModel.gdpRegime = 'normal';
    benign.market.gdpGrowthMoM = 0.002;
    benign.market.unemploymentRate = 0.045;
    benign.behaviour.depositFranchiseStrength = 0.9;
    benign.behaviour.reputation = 0.9;

    const stressed = cloneBankState(initialState);
    stressed.market.macroModel.gdpRegime = 'recession';
    stressed.market.gdpGrowthMoM = -0.004;
    stressed.market.unemploymentRate = 0.09;
    stressed.behaviour.depositFranchiseStrength = 0.35;
    stressed.behaviour.reputation = 0.25;

    const benignMetrics = calculateRiskMetrics({ state: benign, config: baseConfig, lcrOutflowMultiplier: 1 });
    const stressedMetrics = calculateRiskMetrics({ state: stressed, config: baseConfig, lcrOutflowMultiplier: 1 });

    expect(stressedMetrics.lcr).toBe(benignMetrics.lcr);
    expect(stressedMetrics.nsfr).toBe(benignMetrics.nsfr);
    expect(stressedMetrics.managementLcr).toBeLessThan(benignMetrics.managementLcr!);
    expect(stressedMetrics.managementNsfr).toBeLessThan(benignMetrics.managementNsfr!);
  });
});
