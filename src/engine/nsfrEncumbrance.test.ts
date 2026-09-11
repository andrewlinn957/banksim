import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { AssetProductType as A } from '../domain/enums';
import { cloneBankState } from './clone';
import { prudentialLiquidityLines } from './prudential';

const position = (state: typeof initialState, productType: A) =>
  state.financial.balanceSheet.items.find(item => item.productType === productType)!;

describe('NSFR C80 encumbrance classification', () => {
  it('moves encumbered Level 1 amounts into the applicable C80 1.2.1 subrow without double-counting gross assets', () => {
    const state = cloneBankState(initialState);
    const gilt = position(state, A.Gilts);
    gilt.balance = 100;
    gilt.encumbrance = { encumberedAmount: 40, remainingMonths: 9 };

    let line = prudentialLiquidityLines(state, baseConfig).find(item => item.productType === A.Gilts)!;
    expect(line.rsf).toBeCloseTo(20);
    expect(line.rsfContributions.reduce((sum, contribution) => sum + contribution.amount, 0)).toBeCloseTo(100);
    expect(line.rsfContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ corep: 'C80 1.2.1.1', amount: 60, factor: 0, weighted: 0 }),
      expect.objectContaining({ corep: 'C80 1.2.1.2', amount: 40, factor: 0.5, weighted: 20 }),
    ]));

    gilt.encumbrance = { encumberedAmount: 40, remainingMonths: 12 };
    line = prudentialLiquidityLines(state, baseConfig).find(item => item.productType === A.Gilts)!;
    expect(line.rsf).toBeCloseTo(40);
    expect(line.rsfContributions.reduce((sum, contribution) => sum + contribution.amount, 0)).toBeCloseTo(100);
    expect(line.rsfContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ corep: 'C80 1.2.1.1', amount: 60, factor: 0, weighted: 0 }),
      expect.objectContaining({ corep: 'C80 1.2.1.3', amount: 40, factor: 1, weighted: 40 }),
    ]));
  });

  it('uses C80 1.4.5.2 for mortgages encumbered 6–12m and preserves the exposure-maturity factor column', () => {
    const state = cloneBankState(initialState);
    const mortgage = position(state, A.Mortgages);
    const cohort = state.loanCohorts[A.Mortgages]![0];
    mortgage.balance = 100;
    mortgage.encumbrance = { encumberedAmount: 100, remainingMonths: 9 };
    state.loanCohorts[A.Mortgages] = [{ ...cohort, outstandingPrincipal: 100, annualInterestRate: 0, termMonths: 24, ageMonths: 0, stage: 'stage1' }];
    state.workoutPipelines[A.Mortgages] = [];

    let line = prudentialLiquidityLines(state, baseConfig).find(item => item.productType === A.Mortgages)!;
    expect(line.rsfContributions.map(contribution => contribution.corep)).toEqual([
      'C80 1.4.5.2', 'C80 1.4.5.2', 'C80 1.4.5.2',
    ]);
    expect(line.rsfContributions.map(contribution => contribution.maturityBand)).toEqual([
      'under6m', 'sixTo12m', 'oneYearPlus',
    ]);
    expect(line.rsfContributions.map(contribution => contribution.factor)).toEqual([0.5, 0.5, 0.65]);
    expect(line.rsfContributions.reduce((sum, contribution) => sum + contribution.amount, 0)).toBeCloseTo(100);

    mortgage.encumbrance = { encumberedAmount: 100, remainingMonths: 12 };
    line = prudentialLiquidityLines(state, baseConfig).find(item => item.productType === A.Mortgages)!;
    expect(line.rsf).toBeCloseTo(100);
    expect(line.rsfContributions.every(contribution => contribution.corep === 'C80 1.4.5.3')).toBe(true);
    expect(line.rsfContributions.every(contribution => contribution.factor === 1)).toBe(true);
  });

  it('keeps 6–12m encumbered other loans in C80 1.4.6.1 because that row covers all encumbrance below one year', () => {
    const state = cloneBankState(initialState);
    const consumer = position(state, A.ConsumerLoans);
    const cohort = state.loanCohorts[A.ConsumerLoans]![0];
    consumer.balance = 100;
    consumer.encumbrance = { encumberedAmount: 100, remainingMonths: 9 };
    state.loanCohorts[A.ConsumerLoans] = [{ ...cohort, outstandingPrincipal: 100, annualInterestRate: 0, termMonths: 24, ageMonths: 0, stage: 'stage1' }];
    state.workoutPipelines[A.ConsumerLoans] = [];

    let line = prudentialLiquidityLines(state, baseConfig).find(item => item.productType === A.ConsumerLoans)!;
    expect(line.rsfContributions.every(contribution => contribution.corep === 'C80 1.4.6.1')).toBe(true);
    expect(line.rsfContributions.map(contribution => contribution.factor)).toEqual([0.5, 0.5, 0.85]);

    consumer.encumbrance = { encumberedAmount: 100, remainingMonths: 12 };
    line = prudentialLiquidityLines(state, baseConfig).find(item => item.productType === A.ConsumerLoans)!;
    expect(line.rsf).toBeCloseTo(100);
    expect(line.rsfContributions.every(contribution => contribution.corep === 'C80 1.4.6.2')).toBe(true);
    expect(line.rsfContributions.every(contribution => contribution.factor === 1)).toBe(true);
  });
});
