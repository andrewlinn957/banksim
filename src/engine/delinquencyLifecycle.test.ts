import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import type { LoanCohort } from '../domain/loanCohorts';
import { cloneBankState } from './clone';
import { advanceCohortArrears, cohortArrearsGross, cohortArrearsStage2Gross } from './delinquency';
import { calculateProvisionTargetFromCohorts, stepLoanCohorts, syncLoanBalancesFromCohorts } from './loanCohorts';
import { creditStageDiagnostics } from './creditStageDiagnostics';

const product = AssetProductType.CorporateLoans;
const cohort = (): LoanCohort => ({
  productType: product, cohortId: 501, originalPrincipal: 10_000_000,
  outstandingPrincipal: 10_000_000, annualInterestRate: .06,
  termMonths: 120, ageMonths: 0, annualPd: .06, effectiveAnnualPd: .06,
  sicrReferenceAnnualPd: .06, lgd: .35, stage: 'stage1',
  affordabilityIndex: 1, sector: 'largeCorporate', geography: 'north',
});

describe('Fractional cohort arrears lifecycle', () => {
  it('migrates monthly arrears, cures non-rolling buckets, and defaults 90+ days overdue', () => {
    const config = structuredClone(baseConfig);
    config.behaviour.ifrs9!.delinquency = {
      enabled: true, monthlyEntryPdMultiplier: 1, days1to30RollRate: 1,
      days31to60RollRate: 1, days61to89DefaultRate: 1,
      directDefaultShare: 0, affordabilityRollSensitivity: 0,
    };
    const c = cohort();
    const first = advanceCohortArrears(c, .12, config);
    expect(first.newArrears).toBeGreaterThan(0);
    expect(cohortArrearsStage2Gross(c)).toBe(0);
    const second = advanceCohortArrears(c, .12, config);
    expect(second.arrearsDefault).toBe(0);
    expect(cohortArrearsStage2Gross(c)).toBeGreaterThan(0);
    const third = advanceCohortArrears(c, .12, config);
    expect(third.arrearsDefault).toBe(0);
    const fourth = advanceCohortArrears(c, .12, config);
    expect(fourth.arrearsDefault).toBeCloseTo(first.newArrears, 7);

    const cureConfig = structuredClone(config);
    cureConfig.behaviour.ifrs9!.delinquency!.days1to30RollRate = 0;
    const curing = cohort();
    advanceCohortArrears(curing, .12, cureConfig);
    const prior = cohortArrearsGross(curing);
    advanceCohortArrears(curing, 0, cureConfig);
    expect(cohortArrearsGross(curing)).toBe(0);
    expect(prior).toBeGreaterThan(0);
  });

  it('reconciles gross/net loan amounts and recognises Stage 2 ECL for overdue fractions', () => {
    const state = cloneBankState(initialState), c = cohort();
    c.arrears = { days1to30: 200_000, days31to60: 600_000, days61to89: 400_000 };
    state.loanCohorts = { [product]: [c] };
    state.workoutPipelines = {};
    const gross0 = c.outstandingPrincipal;
    const capital0 = creditStageDiagnostics(state);
    expect(capital0.stageGross.stage2).toBeCloseTo(1_000_000, 4);
    expect(capital0.stageGross.stage1).toBeCloseTo(9_000_000, 4);
    const stage = calculateProvisionTargetFromCohorts({ state, config: baseConfig, productType: product });
    expect(stage.stage2).toBeGreaterThan(0);
    const flow = stepLoanCohorts({ state, config: baseConfig, dtMonths: 1, pdMultiplier: 1, lgdMultiplier: 1 });
    const liveGross = state.loanCohorts[product]!.reduce((sum, x) => sum + x.outstandingPrincipal, 0);
    const workoutGross = (state.workoutPipelines[product] ?? []).reduce((sum, x) => sum + x.defaultedPrincipal, 0);
    syncLoanBalancesFromCohorts(state);
    const item = state.financial.balanceSheet.items.find(x => x.productType === product)!;
    expect(item.balance + (item.lossAllowance ?? 0)).toBeCloseTo(liveGross + workoutGross, 4);
    expect(flow.defaultedPrincipal).toBeGreaterThan(0);
    expect(liveGross + workoutGross).toBeLessThan(gross0 + .06/12 * 1_200_000);
  });

  it('cloning does not share mutable arrears balances', () => {
    const state = cloneBankState(initialState);
    state.loanCohorts = { [product]: [{ ...cohort(), arrears: { days1to30: 2, days31to60: 3, days61to89: 4 } }] };
    const copy = cloneBankState(state);
    copy.loanCohorts[product]![0].arrears!.days1to30 = 500;
    expect(state.loanCohorts[product]![0].arrears!.days1to30).toBe(2);
  });
});
