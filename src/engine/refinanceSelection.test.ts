import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { stepLoanCohorts } from './loanCohorts';

const getCohort = (state: typeof initialState, id: number) =>
  (state.loanCohorts[AssetProductType.Mortgages] ?? []).find((cohort) => cohort.cohortId === id);

const weightedPd = (state: typeof initialState): number => {
  const cohorts = state.loanCohorts[AssetProductType.Mortgages] ?? [];
  const total = cohorts.reduce((sum, cohort) => sum + Math.max(0, cohort.outstandingPrincipal), 0);
  if (total <= 0) return 0;
  return cohorts.reduce(
    (sum, cohort) =>
      sum + Math.max(0, cohort.outstandingPrincipal) * Math.max(0, cohort.annualPd),
    0
  ) / total;
};

describe('Refinance selection', () => {
  it('high-coupon low-risk borrowers prepay faster, leaving a riskier residual book', () => {
    const state = cloneBankState(initialState);
    const mortgageItem = state.financial.balanceSheet.items.find(
      (item) => item.productType === AssetProductType.Mortgages
    );
    if (!mortgageItem) throw new Error('Missing mortgages line item');

    state.market.competitorMortgageRate = 0.069;
    mortgageItem.balance = 20e9;
    state.loanCohorts[AssetProductType.Mortgages] = [
      {
        productType: AssetProductType.Mortgages,
        cohortId: 11,
        originalPrincipal: 10e9,
        outstandingPrincipal: 10e9,
        annualInterestRate: 0.07,
        termMonths: 360,
        ageMonths: 36,
        annualPd: 0.003,
        lgd: 0.25,
        affordabilityIndex: 1,
        renewalCount: 0,
        stage: 'stage1',
        sector: 'retailMortgage',
        geography: 'london',
      },
      {
        productType: AssetProductType.Mortgages,
        cohortId: 12,
        originalPrincipal: 10e9,
        outstandingPrincipal: 10e9,
        annualInterestRate: 0.07,
        termMonths: 360,
        ageMonths: 36,
        annualPd: 0.009,
        lgd: 0.25,
        affordabilityIndex: 1,
        renewalCount: 0,
        stage: 'stage1',
        sector: 'retailMortgage',
        geography: 'north',
      },
    ];

    const beforePd = weightedPd(state);
    const beforeLow = getCohort(state, 11)?.outstandingPrincipal ?? 0;
    const beforeHigh = getCohort(state, 12)?.outstandingPrincipal ?? 0;

    stepLoanCohorts({
      state,
      config: {
        ...baseConfig,
        behaviour: {
          ...baseConfig.behaviour,
          creditRiskDynamics: {
            ...baseConfig.behaviour.creditRiskDynamics,
            adverseSelection: {
              ...baseConfig.behaviour.creditRiskDynamics?.adverseSelection,
              renewalShareMonthly: 0,
            },
          },
        },
      },
      dtMonths: 1,
      pdMultiplier: 0,
      lgdMultiplier: 1,
    });

    const afterLow = getCohort(state, 11)?.outstandingPrincipal ?? 0;
    const afterHigh = getCohort(state, 12)?.outstandingPrincipal ?? 0;
    const runoffLow = beforeLow > 0 ? (beforeLow - afterLow) / beforeLow : 0;
    const runoffHigh = beforeHigh > 0 ? (beforeHigh - afterHigh) / beforeHigh : 0;

    expect(runoffLow).toBeGreaterThan(runoffHigh);
    expect(weightedPd(state)).toBeGreaterThan(beforePd);
  });
});
