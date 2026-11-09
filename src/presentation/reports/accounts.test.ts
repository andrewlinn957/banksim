import { describe, expect, it } from 'vitest';
import { initialState } from '../../config/initialState';
import { buildAccountsReportData } from './accounts';

describe('accounts report builder', () => {
  it('returns the same statement categories and full history series used by the UI', () => {
    const opening = structuredClone(initialState);
    const next = structuredClone(initialState);
    next.time.step += 1;
    next.time.date = new Date(Date.UTC(2026, 0, 31));
    next.financial.balanceSheet.items[0].balance += 25_000_000;

    const report = buildAccountsReportData(next, [opening, next]);
    const totalAssets = report.assets.find((row) => row.id === 'total-assets');

    expect(report.assets.length).toBeGreaterThan(1);
    expect(report.income.map((row) => row.id)).toContain('netInterestIncome');
    expect(report.cashflow.map((row) => row.id)).toContain('operatingCashFlow');
    expect(totalAssets?.series).toHaveLength(2);
    expect(totalAssets?.series[1].step).toBe(next.time.step);
  });
});
