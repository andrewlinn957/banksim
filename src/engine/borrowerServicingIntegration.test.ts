import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { AssetProductType } from '../domain/enums';
import { createSimulationEngine } from './simulation';
import { checkInvariants } from './invariants';

const borrower = {
  type: 'originateBorrowerLoan' as const, borrowerId: 'test-individual',
  productType: AssetProductType.ConsumerLoans, principal: 120000,
  annualInterestRate: .06, annualPd: .015, lgd: .5, termMonths: 24,
};
const missed = {
  type: 'setBorrowerPayment' as const,
  borrowerId: borrower.borrowerId, nextPaymentAmount: 0,
};

describe('Individual borrower monthly payment history', () => {
  it('records missed instalments, Stage 2 SICR, and a 90-day workout transfer', () => {
    const engine = createSimulationEngine();
    let state = engine.step({ state: initialState, config: baseConfig,
      actions: [borrower, missed], shocks: [] }).nextState;
    const loan = () => state.loanCohorts[borrower.productType]!
      .find(c => c.borrowerId === borrower.borrowerId);
    expect(loan()!.daysPastDue).toBe(30);
    state = engine.step({ state, config: baseConfig, actions: [missed], shocks: [] }).nextState;
    expect(loan()!.daysPastDue).toBe(60);
    expect(loan()!.stage).toBe('stage2');
    state = engine.step({ state, config: baseConfig, actions: [missed], shocks: [] }).nextState;
    expect(loan()).toBeUndefined();
    expect(state.borrowerPaymentHistory![borrower.borrowerId]).toHaveLength(3);
    expect(state.borrowerPaymentHistory![borrower.borrowerId][2].daysPastDueAtClose).toBe(90);
    expect(checkInvariants(state)).toEqual([]);
  });
  it('cures after paying arrears and leaves an immutable history snapshot', () => {
    const engine = createSimulationEngine();
    const first = engine.step({ state: initialState, config: baseConfig,
      actions: [borrower, missed], shocks: [] }).nextState;
    const second = engine.step({ state: first, config: baseConfig,
      actions: [{ ...missed, nextPaymentAmount: 15000 }], shocks: [] }).nextState;
    const loan = second.loanCohorts[borrower.productType]!
      .find(c => c.borrowerId === borrower.borrowerId)!;
    expect(loan.daysPastDue).toBe(0);
    expect(loan.paymentHistory![1].received).toBe(15000);
    expect(first.borrowerPaymentHistory![borrower.borrowerId]).toHaveLength(1);
    expect(checkInvariants(second)).toEqual([]);
  });
});