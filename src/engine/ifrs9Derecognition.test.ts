import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';
import { checkInvariants } from './invariants';
import { loanCarryingAmounts } from '../products/loanBalances';
import { derecognizeLoanCohort } from './loanModification';

describe('IFRS 9 derecognition and modification fee accounting', () => {
  it('requires legal rights expiry or qualifying transfer and removes gross loan carrying amount', () => {
    const product = AssetProductType.CorporateLoans;
    const state = cloneBankState(initialState);
    const original = state.loanCohorts[product]![0];
    expect(() => derecognizeLoanCohort(state, product, original.cohortId,
      'nonQualifyingTransfer' as 'rightsExpired', 1)).toThrow();
    const oldGross = original.outstandingPrincipal + (original.modificationAdjustment ?? 0);
    const closing = derecognizeLoanCohort(state, product, original.cohortId,
      'rightsExpired', oldGross * .95, 1200, 500);
    expect(closing.oldGross).toBeCloseTo(oldGross);
    expect(closing.gainLossBeforeAllowanceRelease).toBeCloseTo(oldGross * (-.05) + 700);
    expect(state.loanCohorts[product]!.some(c => c.cohortId === original.cohortId)).toBe(false);
  });

  it('reconciles a derecognition through monthly profit, CET1 and the loan ledger', () => {
    const product = AssetProductType.ConsumerLoans;
    const seed = initialState.loanCohorts[product]![0];
    const gross = seed.outstandingPrincipal + (seed.modificationAdjustment ?? 0);
    const next = createSimulationEngine().step({
      state: initialState, config: baseConfig, shocks: [],
      actions: [{
        type: 'derecognizeLoanCohort', productType: product,
        cohortId: seed.cohortId, qualifyingEvent: 'rightsExpired',
        cashConsideration: gross * .9, feeReceived: 1000, transactionCostPaid: 600,
      }],
    }).nextState;
    expect(next.financial.incomeStatement.loanDerecognitionGainLoss).toBeCloseTo(gross * (-.1) + 400, 4);
    expect(next.loanCohorts[product]!.some(c => c.cohortId === seed.cohortId)).toBe(false);
    expect(Math.abs(loanCarryingAmounts(next).total.reconciliationDifference)).toBeLessThan(1);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('capitalises continuing loan modification fees into the revised prospective EIR', () => {
    const product = AssetProductType.Mortgages;
    const seed = initialState.loanCohorts[product]![0];
    const months = seed.termMonths - seed.ageMonths;
    const next = createSimulationEngine().step({
      state: initialState, config: baseConfig, shocks: [],
      actions: [{
        type: 'modifyLoanCohort', productType: product, cohortId: seed.cohortId,
        newCouponAnnual: .035, newRemainingMonths: months, nonDerecognition: true,
        feeReceived: 2000, modificationCostPaid: 500,
      }],
    }).nextState;
    const modified = next.loanCohorts[product]!.find(c => c.cohortId === seed.cohortId)!;
    expect(modified.originalEffectiveInterestRate).toBe(seed.annualInterestRate);
    expect(modified.postModificationEffectiveRate).toBeGreaterThan(0);
    expect(modified.postModificationEffectiveRate).not.toBe(modified.originalEffectiveInterestRate);
    expect(next.financial.incomeStatement.loanModificationGainLoss).toBeDefined();
    expect(checkInvariants(next)).toEqual([]);
  });
});
