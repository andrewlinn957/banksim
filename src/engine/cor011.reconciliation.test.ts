import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { calculateCor011 } from './cor011';
import { calculateRiskMetrics } from './metrics';

describe('COR011 reconciliation', () => {
  it('matches the regulatory LCR metric for the current BankSim product set', () => {
    const cor011 = calculateCor011(initialState, baseConfig);
    const metrics = calculateRiskMetrics({ state: initialState, config: baseConfig });
    expect(cor011.inflows.every(inflow => inflow.capClass === '75')).toBe(true);
    expect(cor011.c76.liquidityBuffer).toBeCloseTo(metrics.hqla, 4);
    expect(cor011.c76.netLiquidityOutflow).toBeCloseTo(metrics.netOutflow, 4);
    expect(cor011.c76.lcr).toBeCloseTo(metrics.lcr, 10);
  });
});
