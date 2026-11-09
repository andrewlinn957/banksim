import { describe, expect, it } from 'vitest';
import { initialState } from '../../config/initialState';
import { AssetProductType } from '../../domain/enums';
import { buildLoanPortfolioReportData, EMPTY_LOAN_COHORT_FILTERS, filterLoanCohorts, filterLoanProducts, sortLoanCohorts, sortLoanProducts } from './loans';

describe('loan portfolio presentation data', () => {
  it('returns the GUI-formatted product, cohort, pipeline and workout details without state references', () => {
    const selectedPortfolio = AssetProductType.Mortgages;
    const cohorts = (initialState.loanCohorts[selectedPortfolio] ?? []).filter((row) => row.productType === selectedPortfolio);
    const report = buildLoanPortfolioReportData({
      items: initialState.financial.balanceSheet.items,
      loanCohorts: initialState.loanCohorts,
      loanPipelines: initialState.loanPipelines,
      workoutPipelines: initialState.workoutPipelines,
      selectedPortfolio,
      visibleCohorts: cohorts,
      portfolioCohortCount: cohorts.length,
    });

    expect(report.productChoices.find((choice) => choice.productType === selectedPortfolio)?.available).toBe(true);
    expect(report.selectedPortfolioLabel).toBe('Residential Mortgages');
    expect(report.products.some((row) => row.productType === selectedPortfolio)).toBe(true);
    expect(report.cohortRows.length).toBe(cohorts.length);
    expect(report.cohortRows[0]?.cells).toHaveProperty('annualPd');
    expect(report.cohortRows[0]).not.toHaveProperty('cohort');
    expect(report.summary.map((row) => row.label)).toContain('WA PD×LGD');
    expect(report.workout.map((row) => row.label)).toContain('Expected recoveries');
  });

  it('shares the GUI numeric/text filters and stable ordering for product and cohort tables', () => {
    const selectedPortfolio = AssetProductType.Mortgages;
    const source = initialState.loanCohorts[selectedPortfolio] ?? [];
    const fixture = source.slice(0, 4).map((row, index) => ({
      ...row,
      cohortId: index + 1,
      stage: index % 2 ? 'stage2' as const : 'stage1' as const,
      effectiveAnnualPd: (index + 1) / 100,
    }));
    const stageTwo = filterLoanCohorts(fixture, { ...EMPTY_LOAN_COHORT_FILTERS, stage: 'Stage 2' });
    expect(stageTwo.map((row) => row.cohortId)).toEqual([2, 4]);

    const highRisk = filterLoanCohorts(fixture, { ...EMPTY_LOAN_COHORT_FILTERS, annualPd: '> 2' });
    expect(highRisk.every((row) => (row.effectiveAnnualPd ?? row.annualPd) > 0.02)).toBe(true);
    expect(sortLoanCohorts(highRisk, { key: 'annualPd', direction: 'desc' }).map((row) => row.cohortId)).toEqual([4, 3]);

    const products = filterLoanProducts(initialState.financial.balanceSheet.items, { product: '', balance: '> 1bn', rate: '', maturity: '' });
    expect(products.every((row) => row.balance > 1e9)).toBe(true);
    expect(sortLoanProducts(products, { key: 'balance', direction: 'desc' })[0].balance)
      .toBe(Math.max(...products.map((row) => row.balance)));
  });
});
