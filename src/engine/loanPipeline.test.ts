import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const getBalance = (state: typeof initialState, productType: AssetProductType): number =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType)?.balance ?? 0;

describe('Loan origination pipeline', () => {
  it('cheaper mortgage pricing increases pipeline demand and approvals', () => {
    const engine = createSimulationEngine();

    const baseline = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [],
      shocks: [],
    }).nextState;

    const priced = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [
        {
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: initialState.market.competitorMortgageRate - 0.01,
        },
      ],
      shocks: [],
    }).nextState;

    const baselinePipeline = baseline.loanPipelines[AssetProductType.Mortgages];
    const pricedPipeline = priced.loanPipelines[AssetProductType.Mortgages];
    expect(pricedPipeline).toBeTruthy();
    expect(baselinePipeline).toBeTruthy();

    expect((pricedPipeline?.demandNotional ?? 0)).toBeGreaterThan(baselinePipeline?.demandNotional ?? 0);
    expect((pricedPipeline?.approvedNotional ?? 0)).toBeGreaterThan(baselinePipeline?.approvedNotional ?? 0);
  });

  it('underwriting tightening reduces approvals before balances fully react', () => {
    const engine = createSimulationEngine();

    const queuedStateLoose = cloneBankState(initialState);
    queuedStateLoose.loanPipelines[AssetProductType.Mortgages] = {
      demandNotional: 0,
      approvedNotional: 0,
      committedNotional: 20e9,
    };
    const loose = engine.step({
      state: queuedStateLoose,
      config: baseConfig,
      actions: [],
      shocks: [],
    }).nextState;

    const queuedStateTight = cloneBankState(initialState);
    queuedStateTight.loanPipelines[AssetProductType.Mortgages] = {
      demandNotional: 0,
      approvedNotional: 0,
      committedNotional: 20e9,
    };
    const tight = engine.step({
      state: queuedStateTight,
      config: baseConfig,
      actions: [
        {
          type: 'setUnderwriting',
          productType: AssetProductType.Mortgages,
          tightness: 1,
        },
      ],
      shocks: [],
    }).nextState;

    const loosePipeline = loose.loanPipelines[AssetProductType.Mortgages];
    const tightPipeline = tight.loanPipelines[AssetProductType.Mortgages];
    expect((tightPipeline?.approvedNotional ?? 0)).toBeLessThan(loosePipeline?.approvedNotional ?? 0);

    const beforeBalance = getBalance(initialState, AssetProductType.Mortgages);
    const looseBalance = getBalance(loose, AssetProductType.Mortgages);
    const tightBalance = getBalance(tight, AssetProductType.Mortgages);
    expect(looseBalance).toBeGreaterThan(beforeBalance);
    expect(tightBalance).toBeLessThanOrEqual(looseBalance);
  });

  it('applies adverse selection PD uplift when origination pricing is far above benchmark', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);
    state.loanCohorts[AssetProductType.Mortgages] = [
      {
        productType: AssetProductType.Mortgages,
        cohortId: 99,
        originalPrincipal: 100e9,
        outstandingPrincipal: 100e9,
        annualInterestRate: state.market.competitorMortgageRate,
        termMonths: 360,
        ageMonths: 12,
        annualPd: baseConfig.productParameters[AssetProductType.Mortgages].baseDefaultRate,
        lgd: baseConfig.productParameters[AssetProductType.Mortgages].lossGivenDefault,
        stage: 'stage1',
      },
    ];

    const nearBenchmark = engine.step({
      state: cloneBankState(state),
      config: baseConfig,
      actions: [
        {
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: state.market.competitorMortgageRate + 0.001,
        },
      ],
      shocks: [],
    }).nextState;

    const highPremium = engine.step({
      state: cloneBankState(state),
      config: baseConfig,
      actions: [
        {
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: state.market.competitorMortgageRate + 0.03,
        },
      ],
      shocks: [],
    }).nextState;

    const nearCohort = nearBenchmark.loanCohorts[AssetProductType.Mortgages]?.find(
      (cohort) => cohort.cohortId === state.time.step
    );
    const highCohort = highPremium.loanCohorts[AssetProductType.Mortgages]?.find(
      (cohort) => cohort.cohortId === state.time.step
    );

    expect(nearCohort).toBeTruthy();
    expect(highCohort).toBeTruthy();
    expect((highCohort?.annualPd ?? 0)).toBeGreaterThan(nearCohort?.annualPd ?? 0);
    expect((highCohort?.annualPd ?? 0)).toBeGreaterThan(
      baseConfig.productParameters[AssetProductType.Mortgages].baseDefaultRate
    );
  });
});
