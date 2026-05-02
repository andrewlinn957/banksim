import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { stepLoanCohorts } from './loanCohorts';

const cohortById = (state: typeof initialState, id: number) =>
  (state.loanCohorts[AssetProductType.Mortgages] ?? []).find((cohort) => cohort.cohortId === id);

describe('Affordability and PD dynamics', () => {
  it('same base-PD cohorts diverge as affordability stress diverges', () => {
    const state = cloneBankState(initialState);
    const mortgageItem = state.financial.balanceSheet.items.find(
      (item) => item.productType === AssetProductType.Mortgages
    );
    const cashItem = state.financial.balanceSheet.items.find(
      (item) => item.productType === AssetProductType.CashReserves
    );
    if (!mortgageItem || !cashItem) throw new Error('Missing required balance sheet lines');

    cashItem.balance = 50e9;
    mortgageItem.balance = 20e9;
    state.loanCohorts[AssetProductType.Mortgages] = [
      {
        productType: AssetProductType.Mortgages,
        cohortId: 1,
        originalPrincipal: 10e9,
        outstandingPrincipal: 10e9,
        annualInterestRate: 0.09,
        termMonths: 360,
        ageMonths: 36,
        annualPd: 0.01,
        lgd: 0.25,
        affordabilityIndex: 1,
        renewalCount: 0,
        stage: 'stage1',
        sector: 'retailMortgage',
        geography: 'north',
      },
      {
        productType: AssetProductType.Mortgages,
        cohortId: 2,
        originalPrincipal: 10e9,
        outstandingPrincipal: 10e9,
        annualInterestRate: 0.045,
        termMonths: 360,
        ageMonths: 36,
        annualPd: 0.01,
        lgd: 0.25,
        affordabilityIndex: 1,
        renewalCount: 0,
        stage: 'stage1',
        sector: 'retailMortgage',
        geography: 'south',
      },
    ];

    const config = {
      ...baseConfig,
      behaviour: {
        ...baseConfig.behaviour,
        creditRiskDynamics: {
          ...baseConfig.behaviour.creditRiskDynamics,
          adverseSelection: {
            ...baseConfig.behaviour.creditRiskDynamics?.adverseSelection,
            renewalShareMonthly: 0,
          },
          refinanceByProduct: {
            ...baseConfig.behaviour.creditRiskDynamics?.refinanceByProduct,
            [AssetProductType.Mortgages]: {
              ...baseConfig.behaviour.creditRiskDynamics?.refinanceByProduct?.[AssetProductType.Mortgages],
              basePrepayRateMonthly: 0,
              minPrepayRateMonthly: 0,
              maxPrepayRateMonthly: 0,
            },
          },
        },
      },
    };

    for (let month = 0; month < 12; month++) {
      stepLoanCohorts({
        state,
        config,
        dtMonths: 1,
        pdMultiplier: 1.6,
        lgdMultiplier: 1.1,
      });
    }

    const stressed = cohortById(state, 1);
    const resilient = cohortById(state, 2);
    expect(stressed).toBeTruthy();
    expect(resilient).toBeTruthy();
    expect((stressed?.affordabilityIndex ?? 1)).toBeGreaterThan(resilient?.affordabilityIndex ?? 1);
    expect((stressed?.outstandingPrincipal ?? 0)).toBeLessThan(resilient?.outstandingPrincipal ?? 0);
    const stageRank = (stage: string | undefined) => (stage === 'stage3' ? 3 : stage === 'stage2' ? 2 : 1);
    expect(stageRank(stressed?.stage)).toBeGreaterThanOrEqual(stageRank(resilient?.stage));
  });
});
