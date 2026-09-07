import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { applyDepositBehaviour, createSimulationEngine } from './simulation';
import { stepLoanCohorts } from './loanCohorts';

describe('Career pacing and economic sensitivity', () => {
  it('gives the player several years to intervene while an unmanaged bank deteriorates', () => {
    const engine = createSimulationEngine();
    let state = cloneBankState(initialState);
    let firstYearIncome = 0;
    let failureMonth: number | null = null;

    for (let month = 1; month <= 60; month++) {
      const result = engine.step({ state, config: baseConfig, actions: [], shocks: [] });
      state = result.nextState;
      if (month <= 12) firstYearIncome += state.financial.incomeStatement.netIncome;
      if (state.status.hasFailed) {
        failureMonth = month;
        break;
      }
    }

    // The opening franchise should be viable and profitable enough to give the player time to learn it.
    expect(firstYearIncome).toBeGreaterThan(0);
    expect(failureMonth === null || failureMonth >= 36).toBe(true);
    // Doing nothing indefinitely should still carry a cost: retained capital deteriorates as the balance sheet evolves.
    expect(state.financial.capital.cet1).toBeLessThan(initialState.financial.capital.cet1);
  });

  it('does not multiply franchise damage when the same deposit book is split into lines', () => {
    const state = cloneBankState(initialState);
    const product = LiabilityProductType.RetailSavingsDeposits;
    const deposit = state.financial.balanceSheet.items.find(item => item.productType === product)!;
    state.financial.balanceSheet.items = state.financial.balanceSheet.items.filter(item =>
      item.side !== 'Liability' || item.productType === product);
    deposit.interestRate = .01;
    state.market.competitorRetailDepositRate = .03;
    // Freeze lag and migration here to isolate the bank-wide aggregation.
    const config = structuredClone(baseConfig);
    config.behaviour.depositByProduct![product]!.passThroughLag = 1;
    config.behaviour.depositByProduct![product]!.underpricingDurationSensitivity = 0;
    const split = cloneBankState(state);
    const splitDeposit = split.financial.balanceSheet.items.find(item => item.productType === product)!;
    splitDeposit.balance /= 2;
    split.financial.balanceSheet.items.push({ ...splitDeposit, id: 'second-savings-line' });
    applyDepositBehaviour(state, config, 1, []);
    applyDepositBehaviour(split, config, 1, []);
    expect(state.behaviour.depositFranchiseStrength).toBeLessThan(initialState.behaviour.depositFranchiseStrength);
    expect(split.behaviour.depositFranchiseStrength).toBeCloseTo(state.behaviour.depositFranchiseStrength, 12);
  });

  it('stages borrowers with deteriorated credit, without a blanket monthly GDP switch', () => {
    const state = cloneBankState(initialState);
    const product = AssetProductType.Mortgages;
    const seed = state.loanCohorts[product]![0];
    state.loanCohorts = { [product]: [
      { ...seed, cohortId: 1, ageMonths: 0, termMonths: 360, stage: 'stage1', affordabilityIndex: 1 },
      { ...seed, cohortId: 2, ageMonths: 0, termMonths: 360, stage: 'stage1', affordabilityIndex: 2.5 },
    ] };
    state.market.gdpGrowthMoM = -.003;
    stepLoanCohorts({ state, config: baseConfig, dtMonths: 1, pdMultiplier: 1, lgdMultiplier: 1 });
    expect(state.loanCohorts[product]!.find(c => c.cohortId === 1)!.stage).toBe('stage1');
    expect(state.loanCohorts[product]!.find(c => c.cohortId === 2)!.stage).toBe('stage2');

    const positiveGdp = cloneBankState(initialState);
    positiveGdp.market.gdpGrowthMoM = .001;
    positiveGdp.loanCohorts = { [product]: [
      { ...seed, cohortId: 3, ageMonths: 0, termMonths: 360, stage: 'stage1', affordabilityIndex: 2.5 },
    ] };
    stepLoanCohorts({ state: positiveGdp, config: baseConfig, dtMonths: 1, pdMultiplier: 1, lgdMultiplier: 1 });
    expect(positiveGdp.loanCohorts[product]![0].stage).toBe('stage2');
  });

  it('still recognises severe macro deterioration immediately', () => {
    const engine = createSimulationEngine();
    const baseline = engine.step({ state: initialState, config: baseConfig, actions: [], shocks: [] }).nextState;
    const stressed = engine.step({ state: initialState, config: baseConfig, actions: [],
      shocks: [{ type: 'macroDownturn', pdMultiplier: 3.5, lgdMultiplier: 2 }] }).nextState;
    expect(stressed.financial.incomeStatement.provisionCharge).toBeGreaterThan(baseline.financial.incomeStatement.provisionCharge + 50e6);
    expect(stressed.financial.capital.cet1).toBeLessThan(baseline.financial.capital.cet1 - 50e6);
  });
});