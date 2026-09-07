import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { stepLoanCohorts } from './loanCohorts';

describe('Loan cohort state compaction', () => {
  it('groups economically equivalent renewals and defaults created in the same month', () => {
    const state = cloneBankState(initialState);
    const mortgageItem = state.financial.balanceSheet.items.find(
      (item) => item.productType === AssetProductType.Mortgages
    );
    if (!mortgageItem) throw new Error('Missing mortgage line');

    const basePd = baseConfig.productParameters[AssetProductType.Mortgages].baseDefaultRate;
    const lgd = baseConfig.productParameters[AssetProductType.Mortgages].lossGivenDefault;
    const openingPrincipal = 20e9;
    mortgageItem.balance = openingPrincipal;
    state.loanCohorts[AssetProductType.Mortgages] = Array.from({ length: 20 }, (_, index) => ({
      productType: AssetProductType.Mortgages,
      cohortId: index + 1,
      originalPrincipal: 1e9,
      outstandingPrincipal: 1e9,
      annualInterestRate: state.market.competitorMortgageRate + 0.005,
      termMonths: 360,
      ageMonths: 350,
      annualPd: basePd,
      lgd,
      affordabilityIndex: 1,
      renewalCount: 0,
      stage: 'stage1' as const,
      sector: 'retailMortgage' as const,
      geography: 'south' as const,
    }));
    state.workoutPipelines[AssetProductType.Mortgages] = [];

    const result = stepLoanCohorts({
      state,
      config: baseConfig,
      dtMonths: 1,
      pdMultiplier: 1,
      lgdMultiplier: 1,
    });

    const renewed = (state.loanCohorts[AssetProductType.Mortgages] ?? []).filter(
      (cohort) => (cohort.renewalCount ?? 0) > 0 && cohort.ageMonths === 0
    );
    const workouts = state.workoutPipelines[AssetProductType.Mortgages] ?? [];

    expect(result.renewedPrincipal).toBeGreaterThan(0);
    expect(renewed).toHaveLength(1);
    expect(renewed[0].outstandingPrincipal).toBeGreaterThan(1e9);
    expect(workouts).toHaveLength(1);
    expect(workouts[0].defaultedPrincipal).toBeGreaterThan(0);
  });
});
