import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { cloneBankState } from '../engine/clone';
import { AssetProductType as A, LiabilityProductType as L } from '../domain/enums';
import { departmentSummary } from './departments';

const find = (summary: ReturnType<typeof departmentSummary>, label: string) => summary.metrics.find(m => m.label === label)!;

describe('Department operations summaries', () => {
  it('uses the actual quarter opening and excludes past-quarter approvals', () => {
    const history = Array.from({ length: 5 }, (_, i) => {
      const s = cloneBankState(initialState); s.time.step = i;
      s.financial.balanceSheet.items.find(x => x.productType === L.RetailSavingsDeposits)!.balance += i * 1e6;
      s.loanPipelines = { [A.Mortgages]: { demandNotional: 100e6, approvedNotional: i * 1e6, committedNotional: 11e6 } };
      return s;
    });
    expect(find(departmentSummary('Customers', history[3], history), 'Deposit change this quarter').rawValue).toBe(3e6);
    expect(find(departmentSummary('Customers', history[4], history), 'Deposit change this quarter').rawValue).toBe(1e6);
    expect(find(departmentSummary('Lending', history[3], history), 'Approvals this quarter').rawValue).toBe(6e6);
    expect(find(departmentSummary('Lending', history[4], history), 'Approvals this quarter').rawValue).toBe(4e6);
    expect(find(departmentSummary('Lending', history[4], history), 'Undrawn commitments').rawValue).toBe(11e6);
  });

  it('includes defaulted workouts in gross principal and impaired share, without counting approvals as loans', () => {
    const s = cloneBankState(initialState), template = s.loanCohorts[A.Mortgages]![0];
    s.loanCohorts = { [A.Mortgages]: [{ ...template, outstandingPrincipal: 80e6, stage: 'stage1' }, { ...template, outstandingPrincipal: 10e6, stage: 'stage2' }] };
    s.workoutPipelines = { [A.Mortgages]: [{ productType: A.Mortgages, sourceCohortId: 1, stageAtDefault: 'stage3', defaultedPrincipal: 10e6, expectedRecoveryRate: .5, monthsToResolution: 6 }] };
    s.loanPipelines = { [A.Mortgages]: { demandNotional: 1e9, approvedNotional: 1e9, committedNotional: 1e9 } };
    const summary = departmentSummary('Lending', s, [s]);
    expect(find(summary, 'Gross loan principal').rawValue).toBe(100e6);
    expect(find(summary, 'Stage 2 and 3 share').value).toBe('20.00%');
  });

  it('labels capital headroom in percentage points and uses reported capital restrictions', () => {
    const s = cloneBankState(initialState); s.risk.riskMetrics.internalCet1Headroom = -.0125; s.risk.riskMetrics.mdaTriggered = true;
    const summary = departmentSummary('Capital', s, [s]);
    expect(find(summary, 'Headroom above internal target')).toMatchObject({ value: '−1.25 pp', unit: 'percentagePoints' });
    expect(summary.status).toBe('Distributions restricted');
  });

  it('counts only actual wholesale maturities within three months', () => {
    const s = cloneBankState(initialState);
    s.fundingLadders = { [L.WholesaleFundingST]: [{ tenorMonths: 3, monthsToMaturity: 3, notional: 70e6, rate: .05 }, { tenorMonths: 6, monthsToMaturity: 4, notional: 90e6, rate: .05 }], [L.WholesaleFundingLT]: [{ tenorMonths: 24, monthsToMaturity: 1, notional: 30e6, rate: .05 }], [L.RepurchaseAgreements]: [{ tenorMonths: 1, monthsToMaturity: 1, notional: 900e6, rate: .05 }] };
    const summary = departmentSummary('Treasury', s, [s]);
    expect(find(summary, 'Wholesale funding due within 3 months').rawValue).toBe(100e6);
    expect(summary.explanation).toContain('excludes deposits and repos');
    expect(summary.reportLabel).toBe('Read capital and liquidity report');
  });

  it('does not invent period totals when a recorded month is missing', () => {
    const opening = cloneBankState(initialState), current = cloneBankState(initialState); current.time.step = 2;
    expect(find(departmentSummary('Capital', current, [opening, current]), 'Profit this quarter').value).toBe('Unavailable');
    expect(find(departmentSummary('Lending', current, [opening, current]), 'Approvals this quarter').value).toBe('Unavailable');
  });
});
