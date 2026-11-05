import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';
import { loanCarryingAmounts } from '../products/loanBalances';
import { checkInvariants } from './invariants';
import {
  contractualPresentValue, remeasureModifiedCohort, creditAdjustedEffectiveRate,
  cumulativePociEclChange,
} from './loanModification';

describe('IFRS 9 modification and POCI measurement', () => {
  it('remeasures non-derecognition terms at unchanged original EIR and keeps original SICR reference', () => {
    const cohort = {
      ...initialState.loanCohorts[AssetProductType.Mortgages]![0],
      outstandingPrincipal: 100,
      originalPrincipal: 100,
      annualInterestRate: .05,
      annualPd: .01,
      sicrReferenceAnnualPd: .01,
      termMonths: 60,
      ageMonths: 0,
      stage: 'stage1' as const,
    };
    expect(contractualPresentValue(100, .05, .05, 60)).toBeCloseTo(100, 8);
    const result = remeasureModifiedCohort(cohort, .02, 60);
    expect(result.originalEir).toBe(.05);
    expect(result.modificationGainLoss).toBeLessThan(0);
    expect(result.modifiedGross).toBeCloseTo(100 + result.modificationGainLoss, 8);
    expect(cohort.modificationAdjustment).toBeCloseTo(result.modificationGainLoss, 8);
    expect(cohort.sicrReferenceAnnualPd).toBe(.01);
    expect(cohort.annualInterestRate).toBe(.02);
    expect(remeasureModifiedCohort(cohort, .02, 60).modificationGainLoss).toBeCloseTo(0, 8);
  });

  it('books an actual BankSim modification in income without changing the original EIR', () => {
    const state = cloneBankState(initialState);
    const product = AssetProductType.Mortgages;
    const cohort = state.loanCohorts[product]![0];
    const originationPd = cohort.sicrReferenceAnnualPd ?? cohort.annualPd;
    const cohortId = cohort.cohortId;
    const months = cohort.termMonths - cohort.ageMonths;
    const engine = createSimulationEngine();
    const result = engine.step({
      state, config: baseConfig,
      actions: [{
        type: 'modifyLoanCohort', productType: product, cohortId,
        newCouponAnnual: .005, newRemainingMonths: months, nonDerecognition: true,
      }],
      shocks: [],
    });
    const next = result.nextState;
    expect(next.financial.incomeStatement.loanModificationGainLoss).toBeLessThan(0);
    const modified = next.loanCohorts[product]!.find(x => x.cohortId === cohortId)!;
    expect(modified.originalEffectiveInterestRate).toBe(cohort.annualInterestRate);
    expect(modified.sicrReferenceAnnualPd ?? modified.annualPd).toBeCloseTo(originationPd, 10);
    expect(next.pendingLoanModificationGainLoss).toBe(0);
    expect(Math.abs(loanCarryingAmounts(next).total.reconciliationDifference)).toBeLessThan(1);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('uses a credit-adjusted initial yield and only subsequent POCI loss changes', () => {
    const rate = creditAdjustedEffectiveRate(95, [100]);
    expect(rate).toBeCloseTo(12 * (100 / 95 - 1), 9);
    expect(cumulativePociEclChange([100], [100], rate)).toBe(0);
    expect(cumulativePociEclChange([100], [90], rate)).toBeCloseTo(9.5, 9);
    expect(cumulativePociEclChange([100], [110], rate)).toBeCloseTo(-9.5, 9);
    expect(() => creditAdjustedEffectiveRate(100, [0])).toThrow();
  });
});
