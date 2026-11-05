import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import type { LoanCohort } from '../domain/loanCohorts';
import { cloneBankState } from './clone';
import { cohortEcl, workoutPresentValue } from './impairment';
import {
  remainingLifetimeDefaultRisk, stepLoanCohorts, updateCohortStage,
} from './loanCohorts';

const product = AssetProductType.CorporateLoans;
const cohort = (): LoanCohort => ({
  productType: product,
  cohortId: 7,
  originalPrincipal: 1_000_000,
  outstandingPrincipal: 1_000_000,
  annualInterestRate: 0.06,
  annualPd: 0.01,
  sicrReferenceAnnualPd: 0.01,
  effectiveAnnualPd: 0.01,
  lgd: 0.45,
  termMonths: 120,
  ageMonths: 0,
  stage: 'stage1',
});

describe('IFRS 9 lifecycle improvements', () => {
  it('compares remaining lifetime risk and applies delinquency and qualitative default backstops', () => {
    const c = cohort();
    expect(remainingLifetimeDefaultRisk(.02, 12)).toBeCloseTo(.02, 12);
    expect(remainingLifetimeDefaultRisk(.02, 120)).toBeGreaterThan(.02);
    c.effectiveAnnualPd = .02;
    expect(updateCohortStage(c, baseConfig)).toBe('stage2');

    c.effectiveAnnualPd = .01;
    c.stage = 'stage1';
    c.daysPastDue = 31;
    expect(updateCohortStage(c, baseConfig)).toBe('stage2');
    c.daysPastDue = 90;
    expect(updateCohortStage(c, baseConfig)).toBe('stage3');
    c.daysPastDue = 0;
    c.unlikelyToPay = true;
    expect(updateCohortStage(c, baseConfig)).toBe('stage3');
  });

  it('moves a 90-day overdue cohort to workout before gross interest is collected', () => {
    const state = cloneBankState(initialState);
    state.loanCohorts = { [product]: [{ ...cohort(), daysPastDue: 60, affordabilityIndex: 1.5 }] };
    state.workoutPipelines = {};
    const cash = state.financial.balanceSheet.items.find(item => item.productType === AssetProductType.CashReserves)!;
    const openingCash = cash.balance;
    const flow = stepLoanCohorts({ state, config: baseConfig, dtMonths: 1, pdMultiplier: 1, lgdMultiplier: 1 });
    expect(flow.defaultedPrincipal).toBeGreaterThan(900_000);
    expect(flow.loanInterestIncome).toBe(0);
    expect(cash.balance).toBe(openingCash);
    expect(state.workoutPipelines[product]![0].defaultedPrincipal).toBeGreaterThan(900_000);
  });

  it('economic downside produces higher scenario ECL than upside at a common reporting date', () => {
    const market = cloneBankState(initialState).market;
    const upside = structuredClone(baseConfig), downside = structuredClone(baseConfig);
    upside.behaviour.ifrs9!.eclScenarios = [{
      weight: 1, pdMultiplier: 1, gdpGrowthMoMShock: .003,
      unemploymentRateShock: -.02, creditSpreadShock: -.01, lgdMultiplier: .9,
    }];
    downside.behaviour.ifrs9!.eclScenarios = [{
      weight: 1, pdMultiplier: 1, gdpGrowthMoMShock: -.006,
      unemploymentRateShock: .03, creditSpreadShock: .02, lgdMultiplier: 1.15,
    }];
    const c = { ...cohort(), stage: 'stage2' as const };
    const good = cohortEcl(c, upside, market), bad = cohortEcl(c, downside, market);
    expect(bad).toBeGreaterThan(good);
    expect(cohortEcl(c, downside, market)).toBeCloseTo(bad, 8);
    market.unemploymentRate += .015;
    expect(cohortEcl(c, downside, market)).not.toBe(bad);
  });

  it('writes off clearly irrecoverable gross exposure before workout resolution', () => {
    const state = cloneBankState(initialState);
    state.loanCohorts = {};
    state.workoutPipelines = {
      [product]: [{
        productType: product,
        sourceCohortId: 7,
        originationStep: 1,
        stageAtDefault: 'stage2',
        defaultedPrincipal: 1_000_000,
        expectedRecoveryRate: .10,
        effectiveInterestRate: .06,
        monthsToResolution: 6,
      }],
    };
    const openingPV = workoutPresentValue(state, baseConfig, product, state.workoutPipelines[product]![0]);
    const flow = stepLoanCohorts({ state, config: baseConfig, dtMonths: 1, pdMultiplier: 1, lgdMultiplier: 1 });
    const remaining = state.workoutPipelines[product]!;
    const closingPV = workoutPresentValue(state, baseConfig, product, remaining[0]);
    expect(closingPV).toBeCloseTo(openingPV * (1 + .06 / 12), 5);
    expect(flow.recoveryCash).toBe(0);
    expect(flow.recognizedLoanLosses[product]).toBeGreaterThan(0);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].earlyWriteoffApplied).toBe(true);
    expect(remaining[0].defaultedPrincipal).toBeLessThan(1_000_000);
    expect(flow.realizedLossesByVintage.reduce((sum, v) => sum + v.amount, 0)).toBeCloseTo(
      flow.recognizedLoanLosses[product] ?? 0, 6,
    );
  });
});
