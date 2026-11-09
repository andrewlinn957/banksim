import { describe, expect, it } from 'vitest';
import { initialState } from '../../config/initialState';
import { creditStageDiagnostics } from '../../engine/creditStageDiagnostics';
import { loanCarryingAmounts } from '../../products/loanBalances';
import { buildCreditLossesReportData } from './creditLosses';

describe('credit losses report builder', () => {
  it('matches the GUI stage, carrying amount and month-history definitions', () => {
    const history = [structuredClone(initialState)];
    const report = buildCreditLossesReportData(history)!;
    const diagnostics = creditStageDiagnostics(history[0]);

    expect(report.carrying).toEqual(loanCarryingAmounts(history[0]).total);
    expect(report.stages.map((row) => row.exposure)).toEqual([
      diagnostics.stageGross.stage1,
      diagnostics.stageGross.stage2,
      diagnostics.stageGross.stage3,
    ]);
    expect(report.months).toEqual([]);
    expect(report.latestMonth).toBeNull();
  });

  it('returns no report data when no opening state exists', () => {
    expect(buildCreditLossesReportData([])).toBeNull();
  });
});
