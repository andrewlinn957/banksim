import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const weightedPd = (state: typeof initialState, productType: AssetProductType): number => {
  const cohorts = state.loanCohorts[productType] ?? [];
  const total = cohorts.reduce((sum, cohort) => sum + Math.max(0, cohort.outstandingPrincipal), 0);
  if (total <= 0) return 0;
  const weighted = cohorts.reduce(
    (sum, cohort) =>
      sum + Math.max(0, cohort.outstandingPrincipal) * Math.max(0, cohort.annualPd),
    0
  );
  return weighted / total;
};

const renewalExposure = (state: typeof initialState, productType: AssetProductType): number =>
  (state.loanCohorts[productType] ?? [])
    .filter((cohort) => (cohort.renewalCount ?? 0) > 0)
    .reduce((sum, cohort) => sum + Math.max(0, cohort.outstandingPrincipal), 0);

const buildRenewalState = () => {
  const state = cloneBankState(initialState);
  const mortgageItem = state.financial.balanceSheet.items.find(
    (item) => item.productType === AssetProductType.Mortgages
  );
  if (!mortgageItem) throw new Error('Missing mortgages line item');
  mortgageItem.balance = 120e9;
  state.loanCohorts[AssetProductType.Mortgages] = [
    {
      productType: AssetProductType.Mortgages,
      cohortId: 1,
      originalPrincipal: 120e9,
      outstandingPrincipal: 120e9,
      annualInterestRate: state.market.competitorMortgageRate + 0.002,
      termMonths: 360,
      ageMonths: 350,
      annualPd: baseConfig.productParameters[AssetProductType.Mortgages].baseDefaultRate,
      lgd: baseConfig.productParameters[AssetProductType.Mortgages].lossGivenDefault,
      affordabilityIndex: 1,
      renewalCount: 0,
      stage: 'stage1',
      sector: 'retailMortgage',
      geography: 'south',
    },
  ];
  return state;
};

const noDemandConfig = {
  ...baseConfig,
  behaviour: {
    ...baseConfig.behaviour,
    loanPipelineByProduct: {
      ...baseConfig.behaviour.loanPipelineByProduct,
      [AssetProductType.Mortgages]: {
        ...baseConfig.behaviour.loanPipelineByProduct?.[AssetProductType.Mortgages],
        baseDemandRateMonthly: 0,
      },
      [AssetProductType.CorporateLoans]: {
        ...baseConfig.behaviour.loanPipelineByProduct?.[AssetProductType.CorporateLoans],
        baseDemandRateMonthly: 0,
      },
    },
  },
};

describe('Adverse selection lifecycle', () => {
  it('high-rate renewal cohorts accumulate more risk and tight underwriting offsets selection pressure', () => {
    const engine = createSimulationEngine();
    let loose = buildRenewalState();
    let tight = buildRenewalState();

    for (let month = 0; month < 6; month++) {
      const looseRate = loose.market.competitorMortgageRate + 0.03;
      const tightRate = tight.market.competitorMortgageRate + 0.03;

      loose = engine.step({
        state: loose,
        config: noDemandConfig,
        actions: [
          {
            type: 'adjustRate',
            productType: AssetProductType.Mortgages,
            newRate: looseRate,
          },
          {
            type: 'setUnderwriting',
            productType: AssetProductType.Mortgages,
            tightness: 0,
          },
        ],
        shocks: [],
      }).nextState;

      tight = engine.step({
        state: tight,
        config: noDemandConfig,
        actions: [
          {
            type: 'adjustRate',
            productType: AssetProductType.Mortgages,
            newRate: tightRate,
          },
          {
            type: 'setUnderwriting',
            productType: AssetProductType.Mortgages,
            tightness: 1,
          },
        ],
        shocks: [],
      }).nextState;
    }

    const basePd = baseConfig.productParameters[AssetProductType.Mortgages].baseDefaultRate;
    expect(renewalExposure(loose, AssetProductType.Mortgages)).toBeGreaterThan(0);
    expect(renewalExposure(tight, AssetProductType.Mortgages)).toBeGreaterThan(0);
    expect(weightedPd(loose, AssetProductType.Mortgages)).toBeGreaterThan(basePd);
    expect(weightedPd(loose, AssetProductType.Mortgages)).toBeGreaterThan(
      weightedPd(tight, AssetProductType.Mortgages)
    );
  });
});
