import { describe, expect, it } from 'vitest';
import { initialState } from '../../config/initialState';
import { baseConfig } from '../../config/baseConfig';
import { formatPct } from '../../utils/formatters';
import { buildRiskDashboardData } from './risk';

describe('risk dashboard presentation data', () => {
  it('preserves dashboard signals, macro outputs, curve points and displayed precision', () => {
    const report = buildRiskDashboardData(initialState, baseConfig);

    expect(report.signals.map((signal) => signal.label)).toEqual(['CET1', 'Leverage', 'LCR', 'NSFR']);
    expect(report.signals[0].value).toBe(initialState.risk.riskMetrics.cet1Ratio);
    expect(report.signals[0].barWidthPct).toBeGreaterThanOrEqual(0);
    expect(report.macroObserved.find((item) => item.label === 'Regime')?.value).toBe('Normal');
    expect(report.macroModel.find((item) => item.label === 'R* real')?.value).toBe('1.25%');
    expect(report.curve.series.map((point) => point.label)).toEqual(Object.keys(initialState.market.giltCurve.yields));
    expect(report.curve.diagnostics.find((item) => item.label === '10Y')?.value).toBe(formatPct(initialState.market.giltCurve.yields.y10));
  });
});
