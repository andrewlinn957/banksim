import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';

describe('Opening capital calibration', () => {
  it('starts a new sandbox with a modest cushion above the internal CET1 target', () => {
    const metrics = initialState.risk.riskMetrics;

    expect(metrics.cet1Ratio).toBeGreaterThan(metrics.internalCet1TargetRatio);
    expect(metrics.internalCet1Headroom).toBeGreaterThan(0.004);
    expect(metrics.internalCet1Headroom).toBeLessThan(0.01);
  });
});
