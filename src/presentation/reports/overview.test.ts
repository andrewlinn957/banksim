import { describe, expect, it } from 'vitest';
import { initialState } from '../../config/initialState';
import { baseConfig } from '../../config/baseConfig';
import { buildBoardroomOverviewData } from './overview';

describe('bank overview presentation', () => {
  it('returns formatted player metrics, period annotations, attention and trend data', () => {
    const opening = structuredClone(initialState);
    const monthOne = structuredClone(initialState);
    const monthTwo = structuredClone(initialState);
    monthOne.time.step = 1;
    monthOne.time.date = new Date(Date.UTC(2026, 0, 31));
    monthOne.financial.incomeStatement.netIncome = 12_000_000;
    monthTwo.time.step = 2;
    monthTwo.time.date = new Date(Date.UTC(2026, 1, 28));
    monthTwo.financial.incomeStatement.netIncome = 15_000_000;
    const history = [opening, monthOne, monthTwo];

    const report = buildBoardroomOverviewData(monthTwo, history, ['Gilt buy · £50m'], null, baseConfig);

    expect(report.hasClosed).toBe(true);
    expect(report.financialPerformance[0].label).toBe('Quarter profit');
    expect(report.departments.map((item) => item.department)).toEqual(['Customers', 'Lending', 'Treasury', 'Capital']);
    expect(report.ratios.map((item) => item.label)).toEqual(['CET1', 'Leverage', 'LCR', 'NSFR']);
    expect(report.trends.find((trend) => trend.label === 'CET1')?.waiting).toBe(false);
    expect(report.trends.find((trend) => trend.label === 'CET1')?.ariaLabel).toContain('Dec 25 to Feb 26');
    expect(report.pendingActions).toEqual(['Gilt buy · £50m']);
  });
});
