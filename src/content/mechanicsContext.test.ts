import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { buildMechanicsDynamicContext } from './mechanicsContext';

describe('buildMechanicsDynamicContext', () => {
  it('extracts and formats regulatory thresholds from config', () => {
    const context = buildMechanicsDynamicContext({ config: baseConfig, state: initialState });
    const stack = baseConfig.riskLimits.capitalBufferStack;
    const combinedRequirement = initialState.risk.riskMetrics.cet1Requirement;

    expect(context.values.minCet1Ratio).toBe(baseConfig.riskLimits.minCet1Ratio);
    expect(context.values.minLeverageRatio).toBe(baseConfig.riskLimits.minLeverageRatio);
    expect(context.values.minLcr).toBe(baseConfig.riskLimits.minLcr);
    expect(context.values.minNsfr).toBe(baseConfig.riskLimits.minNsfr);
    expect(context.values.combinedCet1Requirement).toBe(combinedRequirement);

    expect(context.formatted.minCet1Ratio).toBe(`${(baseConfig.riskLimits.minCet1Ratio * 100).toFixed(1)}%`);
    expect(context.formatted.minLeverageRatio).toBe(`${(baseConfig.riskLimits.minLeverageRatio * 100).toFixed(1)}%`);
    expect(context.formatted.minLcr).toBe(`${baseConfig.riskLimits.minLcr.toFixed(2)}x`);
    expect(context.formatted.minNsfr).toBe(`${baseConfig.riskLimits.minNsfr.toFixed(2)}x`);
    expect(context.formatted.combinedCet1Requirement).toBe(`${(combinedRequirement * 100).toFixed(1)}%`);
  });

  it('includes current metric values only when state is provided', () => {
    const withState = buildMechanicsDynamicContext({ config: baseConfig, state: initialState });
    expect(withState.values.currentCet1Ratio).toBeCloseTo(initialState.risk.riskMetrics.cet1Ratio, 10);
    expect(withState.values.currentLeverageRatio).toBeCloseTo(initialState.risk.riskMetrics.leverageRatio, 10);
    expect(withState.values.currentLcr).toBeCloseTo(initialState.risk.riskMetrics.lcr, 10);
    expect(withState.values.currentNsfr).toBeCloseTo(initialState.risk.riskMetrics.nsfr, 10);
    expect(withState.formatted.currentCet1Ratio).toBeDefined();
    expect(withState.formatted.currentLcr).toBeDefined();

    const withoutState = buildMechanicsDynamicContext({ config: baseConfig });
    expect(withoutState.values.currentCet1Ratio).toBeUndefined();
    expect(withoutState.values.currentLeverageRatio).toBeUndefined();
    expect(withoutState.values.currentLcr).toBeUndefined();
    expect(withoutState.values.currentNsfr).toBeUndefined();
    expect(withoutState.formatted.currentCet1Ratio).toBeUndefined();
    expect(withoutState.formatted.currentLcr).toBeUndefined();
  });
});
