import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { buildCapitalMarketsBook } from './capitalMarkets';
import { debtFundingHeadroom } from './fundingHeadroom';

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

  it('ties CET1 demand and pricing to post-issue ROE relative to the cost of equity', () => {
    const profitable = cloneBankState(initialState);
    profitable.equityMarket.smoothedAnnualisedEps = 0.15;
    profitable.risk.riskMetrics.internalCet1Headroom = 0.2;
    const weakReturns = cloneBankState(initialState);
    weakReturns.equityMarket.smoothedAnnualisedEps = 0.01;
    weakReturns.risk.riskMetrics.internalCet1Headroom = 0.5;

    const attractiveBook = buildCapitalMarketsBook(profitable, baseConfig, { instrument: 'cet1', targetAmount: 100e6, maxDiscount: 0.5 });
    const weakBook = buildCapitalMarketsBook(weakReturns, baseConfig, { instrument: 'cet1', targetAmount: 100e6, maxDiscount: 0.5 });

    expect(attractiveBook.equityPostIssueRoe).toBeGreaterThan(attractiveBook.equityCostOfEquity ?? 1);
    expect(attractiveBook.equityReturnDemandFactor).toBe(1);
    expect(weakBook.equityPostIssueRoe).toBeLessThan(weakBook.equityCostOfEquity ?? 0);
    expect(weakBook.equityReturnDemandFactor).toBeGreaterThan(0);
    expect(weakBook.demandAmount).toBeGreaterThan(0);
    expect(weakBook.demandAmount).toBeLessThan(attractiveBook.demandAmount);
    expect(weakBook.clearingDiscount).toBeGreaterThan(attractiveBook.clearingDiscount ?? 0);
  });

  it('does not let issued shares inflate future CET1 market capacity after the repeat window', () => {
    const state = cloneBankState(initialState);
    const priorIssue = buildCapitalMarketsBook(state, baseConfig, { instrument: 'cet1', targetAmount: 740e6, maxDiscount: 0.5 });
    state.equityMarket.sharesOutstanding = 2e9;
    state.equityMarket.marketCap = 1.48e9;
    const priorNetProceeds = 732.6e6;
    state.financial.capital.cet1 += priorNetProceeds;
    const reserveRate = state.financial.balanceSheet.items.find(item => item.productType === AssetProductType.CashReserves)?.interestRate ?? 0;
    const existingAnnualEarnings = initialState.equityMarket.epsTtm * initialState.equityMarket.sharesOutstanding;
    const incrementalCashEarnings = priorNetProceeds * reserveRate * (1 - baseConfig.global.taxRate);
    state.equityMarket.smoothedAnnualisedEps = (existingAnnualEarnings + incrementalCashEarnings) / state.equityMarket.sharesOutstanding;
    state.time.step = 12;
    state.capitalMarkets = {
      transactions: [{
        ...priorIssue,
        executedAmount: 740e6,
        grossProceeds: 740e6,
        netProceeds: priorNetProceeds,
        issuePrice: 0.74,
        step: 0,
        date: initialState.time.date.toISOString(),
      }],
    };

    const beforeIssue = buildCapitalMarketsBook(initialState, baseConfig, { instrument: 'cet1', targetAmount: 100e6, maxDiscount: 0.5 });
    const afterIssue = buildCapitalMarketsBook(state, baseConfig, { instrument: 'cet1', targetAmount: 100e6, maxDiscount: 0.5 });

    expect(state.equityMarket.marketCap).toBeGreaterThan(initialState.equityMarket.marketCap);
    expect(afterIssue.demandAmount).toBeLessThan(beforeIssue.demandAmount);
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

  it('limits the AT1 stack to half of CET1 even when coupon payment is skipped', () => {
    const state = cloneBankState(initialState);
    state.behaviour.capitalPolicy = { dividendPayoutRatio: 0, at1CouponMode: 'skip' };
    state.financial.capital.at1 = state.financial.capital.cet1 * 0.5;

    const book = buildCapitalMarketsBook(state, baseConfig, {
      instrument: 'at1', targetAmount: 1e9, maxSpreadBps: 10_000,
    });

    expect(book.executedAmount).toBe(0);
    expect(book.demandAmount).toBe(0);
    expect(book.status).toBe('failed-demand');
  });

  it('prices future AT1 issuance more tightly after a run of skipped coupons', () => {
    const paying = cloneBankState(initialState);
    const skipping = cloneBankState(initialState);
    paying.financial.capital.at1 = 100e6;
    skipping.financial.capital.at1 = 100e6;
    skipping.capitalMarkets = { transactions: [], at1CouponSkipStreakMonths: 12 };
    const order = { instrument: 'at1' as const, targetAmount: 200e6, maxSpreadBps: 10_000 };

    const paidBook = buildCapitalMarketsBook(paying, baseConfig, order);
    const skippedBook = buildCapitalMarketsBook(skipping, baseConfig, order);

    expect(skippedBook.clearingSpreadBps).toBeGreaterThan(paidBook.clearingSpreadBps ?? 0);
    expect(skippedBook.demandAmount).toBeLessThan(paidBook.demandAmount);
    expect(skippedBook.fundingMarketAssessment?.drivers.some(driver => driver.key === 'couponReliability')).toBe(true);
  });

  it('caps Tier 2 and senior debt orders by gross leverage headroom', () => {
    const state = cloneBankState(initialState);
    const headroom = debtFundingHeadroom(state, baseConfig);
    expect(headroom).toBeGreaterThan(0);

    for (const instrument of ['tier2', 'senior'] as const) {
      const book = buildCapitalMarketsBook(state, baseConfig, {
        instrument, targetAmount: 1e12, maxSpreadBps: 10_000, tenorMonths: 60,
      });
      expect(book.demandAmount).toBeLessThanOrEqual(headroom + 1e-6);
      expect(book.fundingMarketAssessment?.hardCapacity).toBeLessThanOrEqual(headroom + 1e-6);
    }
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
