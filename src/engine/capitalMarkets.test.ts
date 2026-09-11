import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from './clone';
import { buildCapitalMarketsBook } from './capitalMarkets';

describe('capital-markets bookbuild', () => {
  it('prices equity more aggressively as transaction size grows and can partially fill a large deal', () => {
    const state = cloneBankState(initialState);
    const small = buildCapitalMarketsBook(state, baseConfig, { instrument: 'cet1', targetAmount: 50e6, maxDiscount: 0.5 });
    const large = buildCapitalMarketsBook(state, baseConfig, { instrument: 'cet1', targetAmount: 1e9, maxDiscount: 0.5 });
    expect(small.clearingDiscount).toBeDefined();
    expect(large.clearingDiscount).toBeGreaterThan(small.clearingDiscount ?? 0);
    expect(large.coverageRatio).toBeLessThan(small.coverageRatio);
    expect(large.executedAmount).toBeLessThan(large.targetAmount);
  });

  it('does not execute when management price discipline is tighter than the clearing book', () => {
    const state = cloneBankState(initialState);
    const quote = buildCapitalMarketsBook(state, baseConfig, { instrument: 'cet1', targetAmount: 250e6, maxDiscount: 0.01 });
    expect(quote.status).toBe('failed-price');
    expect(quote.executedAmount).toBe(0);
  });

  it('makes repeated issuance more expensive and reduces market capacity', () => {
    const state = cloneBankState(initialState);
    const first = buildCapitalMarketsBook(state, baseConfig, { instrument: 'tier2', targetAmount: 150e6, maxSpreadBps: 2000, tenorMonths: 60 });
    state.capitalMarkets = { transactions: [{ ...first, step: state.time.step, date: state.time.date.toISOString() }] };
    const repeat = buildCapitalMarketsBook(state, baseConfig, { instrument: 'tier2', targetAmount: 150e6, maxSpreadBps: 2000, tenorMonths: 60 });
    expect(repeat.clearingSpreadBps).toBeGreaterThan(first.clearingSpreadBps ?? 0);
    expect(repeat.demandAmount).toBeLessThan(first.demandAmount);
  });

  it('makes AT1 access worse when market confidence deteriorates', () => {
    const stable = cloneBankState(initialState);
    const stressed = cloneBankState(initialState);
    stressed.behaviour.fundingConfidenceState = 'stressed';
    stressed.risk.riskMetrics.fundingConfidenceState = 'stressed';
    stressed.risk.riskMetrics.fundingConfidenceScore = 0.3;
    const good = buildCapitalMarketsBook(stable, baseConfig, { instrument: 'at1', targetAmount: 100e6, maxSpreadBps: 2500 });
    const bad = buildCapitalMarketsBook(stressed, baseConfig, { instrument: 'at1', targetAmount: 100e6, maxSpreadBps: 2500 });
    expect(bad.clearingSpreadBps).toBeGreaterThan(good.clearingSpreadBps ?? 0);
    expect(bad.demandAmount).toBeLessThan(good.demandAmount);
  });

  it('normalises debt tenors to instrument terms', () => {
    const state = cloneBankState(initialState);
    const tier2 = buildCapitalMarketsBook(state, baseConfig, { instrument: 'tier2', targetAmount: 100e6, maxSpreadBps: 2000, tenorMonths: 73 });
    const senior = buildCapitalMarketsBook(state, baseConfig, { instrument: 'senior', targetAmount: 100e6, maxSpreadBps: 2000, tenorMonths: 50 });
    expect(tier2.tenorMonths).toBe(84);
    expect(senior.tenorMonths).toBe(60);
  });
});
