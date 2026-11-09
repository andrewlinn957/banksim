import { describe, expect, it } from 'vitest';
import { initialState } from '../../config/initialState';
import { buildCapitalHistoryData } from './capitalHistory';

describe('capital history presentation', () => {
  it('retains the selectable series, date window, values and chart display settings', () => {
    const history = [structuredClone(initialState), structuredClone(initialState), structuredClone(initialState)];
    history[1].time.step = 1;
    history[2].time.step = 2;
    history[1].time.date = new Date(Date.UTC(2026, 0, 31));
    history[2].time.date = new Date(Date.UTC(2026, 1, 28));
    history[2].risk.riskMetrics.cet1Ratio += 0.01;

    const report = buildCapitalHistoryData(history, 'ratio', ['CET1', 'CET1 requirement'], 'all');
    expect(report.measures.map((item) => item.label)).toContain('NSFR target');
    expect(report.datasets.map((item) => item.label)).toEqual(['CET1', 'CET1 requirement']);
    expect(report.datasets[0].points).toHaveLength(3);
    expect(report.datasets[0].points[2].y).toBe(history[2].risk.riskMetrics.cet1Ratio);
    expect(report.datasets[1].dash).toEqual([6, 4]);
    expect(report.axisTitle).toBe('%');
  });
});
