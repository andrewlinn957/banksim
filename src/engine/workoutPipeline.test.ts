import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { stepLoanCohorts } from './loanCohorts';

const workoutStock = (state: typeof initialState, productType: AssetProductType): number =>
  (state.workoutPipelines?.[productType] ?? []).reduce(
    (sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal ?? 0),
    0
  );

const firstWorkoutLag = (state: typeof initialState, productType: AssetProductType): number =>
  (state.workoutPipelines?.[productType] ?? [])[0]?.monthsToResolution ?? 0;

const makeState = () => {
  const state = cloneBankState(initialState);
  const corpItem = state.financial.balanceSheet.items.find(
    (item) => item.productType === AssetProductType.CorporateLoans
  );
  const cashItem = state.financial.balanceSheet.items.find(
    (item) => item.productType === AssetProductType.CashReserves
  );
  if (!corpItem || !cashItem) throw new Error('Missing required line items');
  cashItem.balance = 40e9;
  corpItem.balance = 40e9;
  state.loanCohorts[AssetProductType.CorporateLoans] = [
    {
      productType: AssetProductType.CorporateLoans,
      cohortId: 7,
      originalPrincipal: 40e9,
      outstandingPrincipal: 40e9,
      annualInterestRate: 0.09,
      termMonths: 84,
      ageMonths: 18,
      annualPd: 0.18,
      lgd: 0.55,
      affordabilityIndex: 1.1,
      renewalCount: 0,
      stage: 'stage2',
      sector: 'commercialRealEstate',
      geography: 'north',
    },
  ];
  state.workoutPipelines[AssetProductType.CorporateLoans] = [];
  return state;
};

const configNoRenewal = {
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
        [AssetProductType.CorporateLoans]: {
          ...baseConfig.behaviour.creditRiskDynamics?.refinanceByProduct?.[AssetProductType.CorporateLoans],
          basePrepayRateMonthly: 0,
          minPrepayRateMonthly: 0,
          maxPrepayRateMonthly: 0,
        },
      },
    },
  },
};

describe('Workout pipeline', () => {
  it('separates default recognition from recoveries and degrades recoveries under stress', () => {
    let benign = makeState();
    let stressed = makeState();
    stressed.market.unemploymentRate = 0.11;
    stressed.market.gdpGrowthMoM = -0.01;

    const firstBenign = stepLoanCohorts({
      state: benign,
      config: configNoRenewal,
      dtMonths: 1,
      pdMultiplier: 1.4,
      lgdMultiplier: 1.15,
    });
    const firstStressed = stepLoanCohorts({
      state: stressed,
      config: configNoRenewal,
      dtMonths: 1,
      pdMultiplier: 1.4,
      lgdMultiplier: 1.15,
    });

    expect(firstBenign.defaultedPrincipal).toBeGreaterThan(0);
    expect(firstBenign.recoveryCash).toBe(0);
    expect(workoutStock(benign, AssetProductType.CorporateLoans)).toBeGreaterThan(0);
    expect(firstWorkoutLag(stressed, AssetProductType.CorporateLoans)).toBeGreaterThan(
      firstWorkoutLag(benign, AssetProductType.CorporateLoans)
    );

    let benignRecovery = firstBenign.recoveryCash;
    let stressedRecovery = firstStressed.recoveryCash;
    for (let month = 0; month < 24; month++) {
      const benignStep = stepLoanCohorts({
        state: benign,
        config: configNoRenewal,
        dtMonths: 1,
        pdMultiplier: 1.0,
        lgdMultiplier: 1.0,
      });
      const stressedStep = stepLoanCohorts({
        state: stressed,
        config: configNoRenewal,
        dtMonths: 1,
        pdMultiplier: 1.0,
        lgdMultiplier: 1.0,
      });
      benignRecovery += benignStep.recoveryCash;
      stressedRecovery += stressedStep.recoveryCash;
    }

    expect(benignRecovery).toBeGreaterThan(0);
    expect(stressedRecovery).toBeLessThan(benignRecovery);
  });
});
