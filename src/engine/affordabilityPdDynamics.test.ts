import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { nextAffordabilityIndex, stepLoanCohorts } from './loanCohorts';

const cohortById = (state: typeof initialState, id: number) =>
  (state.loanCohorts[AssetProductType.Mortgages] ?? []).find((cohort) => cohort.cohortId === id);

describe('Affordability and PD dynamics', () => {
  it('converges to a bounded stress target and recovers when conditions normalise', () => {
    const parameters = baseConfig.behaviour.creditRiskDynamics?.affordabilityByProduct?.[AssetProductType.Mortgages];
    if (!parameters) throw new Error('Missing mortgage affordability configuration');

    let stressed = 1;
    for (let month = 0; month < 240; month++) {
      stressed = nextAffordabilityIndex({
        currentIndex: stressed, annualInterestRate: .09, benchmarkRate: .04,
        baseRate: .04, unemploymentRate: .05, gdpGrowthMoM: 0, parameters,
      });
    }
    const expectedStress = 1 + parameters.baselineDriftMonthly +
      parameters.couponGapSensitivity * .05 + parameters.policyRateSensitivity * .02;
    expect(stressed).toBeCloseTo(expectedStress, 4);
    expect(stressed).toBeLessThan(parameters.maxIndex);

    let recovering = parameters.maxIndex;
    for (let month = 0; month < 120; month++) {
      recovering = nextAffordabilityIndex({
        currentIndex: recovering, annualInterestRate: .04, benchmarkRate: .04,
        baseRate: .02, unemploymentRate: .05, gdpGrowthMoM: 0, parameters,
      });
    }
    expect(recovering).toBeLessThan(1.01);
    expect(recovering).toBeGreaterThan(1);
  });

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
    expect((stressed?.effectiveAnnualPd ?? 0)).toBeGreaterThan(resilient?.effectiveAnnualPd ?? 0);
    const stageRank = (stage: string | undefined) => (stage === 'stage3' ? 3 : stage === 'stage2' ? 2 : 1);
    expect(stageRank(stressed?.stage)).toBeGreaterThanOrEqual(stageRank(resilient?.stage));
  });
});
