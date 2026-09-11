import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { nsfrDashboardData } from './NsfrDashboard';

describe('NSFR dashboard PRA taxonomy', () => {
  it('reconciles C80/C81 contribution tables to the regulatory engine totals', () => {
    const data = nsfrDashboardData(initialState, baseConfig);
    expect(data.asf).toBeCloseTo(initialState.risk.riskMetrics.asf, 4);
    expect(data.rsf).toBeCloseTo(initialState.risk.riskMetrics.rsf, 4);
    expect(data.ratio).toBeCloseTo(initialState.risk.riskMetrics.nsfr, 10);
  });

  it('surfaces the PRA categories instead of product-name buckets', () => {
    const data = nsfrDashboardData(initialState, baseConfig);
    expect(data.asfRows.some(row => row.label.includes('C81 2.2.1') && row.label.includes('Stable retail deposits'))).toBe(true);
    expect(data.asfRows.some(row => row.label.includes('C81 2.2.2') && row.label.includes('Other retail deposits'))).toBe(true);
    expect(data.asfRows.some(row => row.label.includes('C81 2.3.5'))).toBe(true);
    expect(data.rsfRows.some(row => row.label.includes('C80 1.4.5'))).toBe(true);
    expect(data.rsfRows.some(row => row.label.includes('C80 1.4.6'))).toBe(true);
    expect(data.asfParts.some(part => part.label === 'Stable retail deposits')).toBe(true);
    expect(data.rsfParts.some(part => part.label === 'Residential mortgages')).toBe(true);
  });
});
