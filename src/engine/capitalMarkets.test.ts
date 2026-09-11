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

  it('makes AT1 access worse when observable issuer fundamentals deteriorate', () => {
    const healthy = cloneBankState(initialState);
    const stressed = cloneBankState(initialState);
    stressed.risk.riskMetrics.cet1Headroom = -0.01;
    stressed.risk.riskMetrics.leverageRatio = baseConfig.riskLimits.minLeverageRatio - 0.005;
    stressed.risk.riskMetrics.lcr = 0.85;
    stressed.risk.riskMetrics.nsfr = 0.90;
    stressed.behaviour.depositFranchiseStrength = 0.35;
    stressed.market.seniorDebtSpread = healthy.market.seniorDebtSpread + 0.015;
    Object.values(stressed.loanCohorts).flatMap(cohorts => cohorts ?? []).forEach((cohort, index) => {
      cohort.stage = index % 3 === 0 ? 'stage3' : 'stage2';
    });

    const good = buildCapitalMarketsBook(healthy, baseConfig, { instrument: 'at1', targetAmount: 100e6, maxSpreadBps: 2500 });
    const bad = buildCapitalMarketsBook(stressed, baseConfig, { instrument: 'at1', targetAmount: 100e6, maxSpreadBps: 2500 });
    expect(bad.clearingSpreadBps).toBeGreaterThan(good.clearingSpreadBps ?? 0);
    expect(bad.demandAmount).toBeLessThan(good.demandAmount);
    expect(bad.fundingMarketAssessment?.drivers.some(driver => driver.key === 'capital' && driver.spreadBps > 0)).toBe(true);
  });

  it('does not use the legacy Funding Confidence state to price debt or determine capacity', () => {
    const a = cloneBankState(initialState);
    const b = cloneBankState(initialState);
    a.behaviour.fundingConfidenceScore = 1;
    a.behaviour.fundingConfidenceState = 'strong';
    a.risk.riskMetrics.fundingConfidenceScore = 1;
    a.risk.riskMetrics.fundingConfidenceState = 'strong';
    b.behaviour.fundingConfidenceScore = 0;
    b.behaviour.fundingConfidenceState = 'stressed';
    b.risk.riskMetrics.fundingConfidenceScore = 0;
    b.risk.riskMetrics.fundingConfidenceState = 'stressed';

    const x = buildCapitalMarketsBook(a, baseConfig, { instrument: 'senior', targetAmount: 100e6, maxSpreadBps: 2000, tenorMonths: 36 });
    const y = buildCapitalMarketsBook(b, baseConfig, { instrument: 'senior', targetAmount: 100e6, maxSpreadBps: 2000, tenorMonths: 36 });
    expect(y.clearingSpreadBps).toBeCloseTo(x.clearingSpreadBps ?? 0, 10);
    expect(y.demandAmount).toBeCloseTo(x.demandAmount, 2);
  });

  it('normalises debt tenors to instrument terms', () => {
    const state = cloneBankState(initialState);
    const tier2 = buildCapitalMarketsBook(state, baseConfig, { instrument: 'tier2', targetAmount: 100e6, maxSpreadBps: 2000, tenorMonths: 73 });
    const senior = buildCapitalMarketsBook(state, baseConfig, { instrument: 'senior', targetAmount: 100e6, maxSpreadBps: 2000, tenorMonths: 50 });
    expect(tier2.tenorMonths).toBe(84);
    expect(senior.tenorMonths).toBe(60);
  });
});
