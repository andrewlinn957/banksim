import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { buildCapitalMarketsBook } from '../engine/capitalMarkets';
import { buildPlayerCapitalMarketsQuote } from './quotes';

describe('player capital markets quote', () => {
  it('matches the displayed engine quote fields and omits backend-only assessment data', () => {
    const order = { instrument: 'cet1' as const, targetAmount: 100_000_000, maxDiscount: 0.15 };
    const expected = buildCapitalMarketsBook(initialState, baseConfig, order);
    const quote = buildPlayerCapitalMarketsQuote(initialState, baseConfig, order);
    expect(quote).toMatchObject({
      instrument: expected.instrument,
      label: 'CET1 equity',
      pricingKind: expected.pricingKind,
      status: expected.status,
      targetAmount: '£100.00m',
      demandAmount: '£' + (expected.demandAmount / 1e6).toFixed(2) + 'm',
      executedAmount: '£' + (expected.executedAmount / 1e6).toFixed(2) + 'm',
      netProceeds: '£' + (expected.netProceeds / 1e6).toFixed(2) + 'm',
      coverageRatio: expected.coverageRatio.toFixed(2),
      recentIssuanceNotice: expected.recentIssuanceRatio > 0,
    });
    expect('fundingMarketAssessment' in quote).toBe(false);
    expect('grossProceeds' in quote).toBe(false);
    expect('recentIssuanceRatio' in quote).toBe(false);
    expect('marketReferenceRate' in quote).toBe(false);
  });
});
