import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { buildFundingMarketFundamentals } from './fundingMarketAdapter';

describe('funding-market BankState adapter', () => {
  it('derives wholesale reliance and the near-term market-funding wall from current state', () => {
    const state = cloneBankState(initialState);
    state.fundingLadders[LiabilityProductType.WholesaleFundingLT] = [
      { tenorMonths: 36, monthsToMaturity: 6, notional: 300e6, rate: 0.05 },
      { tenorMonths: 36, monthsToMaturity: 24, notional: 420e6, rate: 0.05 },
    ];
    const result = buildFundingMarketFundamentals(state, baseConfig);
    expect(result.wholesaleFundingRatio).toBeGreaterThan(0);
    expect(result.wholesaleFundingMaturing12mRatio).toBeGreaterThan(0);
    expect(result.depositFranchiseStrength).toBeCloseTo(state.behaviour.depositFranchiseStrength, 10);
  });

  it('does not invent an earnings signal before a period has closed', () => {
    const result = buildFundingMarketFundamentals(cloneBankState(initialState), baseConfig);
    expect(result.annualisedRoa).toBeUndefined();
  });
});
