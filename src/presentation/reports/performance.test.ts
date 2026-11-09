import { describe, expect, it } from 'vitest';
import { initialState } from '../../config/initialState';
import { buildPerformanceReportData } from './performance';

describe('performance report builder', () => {
  it('keeps the quarterly/yearly selector semantics and visible twelve-period window', () => {
    const history = Array.from({ length: 25 }, (_, index) => {
      const state = structuredClone(initialState);
      state.time.step = index;
      state.time.date = new Date(Date.UTC(2025 + Math.floor(index / 12), index % 12, 28));
      state.financial.incomeStatement.netIncome = index * 1_000_000;
      return state;
    });
    const quarterly = buildPerformanceReportData(history, 3);
    const yearly = buildPerformanceReportData(history, 12);

    expect(quarterly.visiblePeriods).toHaveLength(8);
    expect(yearly.visiblePeriods).toHaveLength(2);
    expect(quarterly.barHeightPx(0)).toBe(4);
    expect(quarterly.periodStatus).toBe('change');
    expect(quarterly.profitChange).toBe(9_000_000);
  });
});
