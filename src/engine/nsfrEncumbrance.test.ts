import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { AssetProductType as A } from '../domain/enums';
import { cloneBankState } from './clone';
import { prudentialLiquidityLines } from './prudential';

describe('NSFR C80 encumbrance classification', () => {
  it('moves encumbered Level 1 amounts into the applicable C80 subrow without double-counting gross assets', () => {
    const state = cloneBankState(initialState);
    const gilt = state.financial.balanceSheet.items.find(item => item.productType === A.Gilts)!;
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
});
