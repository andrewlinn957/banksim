import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from './clone';
import { createSimulationEngine, updateSharePrice } from './simulation';

const makeBaselineState = () => {
  const state = cloneBankState(initialState);
  state.equityMarket = {
    sharesOutstanding: 1e9,
    sharePrice: 1,
    marketCap: 1e9,
    epsTtm: 0.1,
    peMultiple: 10,
  };
  state.risk.riskMetrics.cet1Ratio = 0.13;
  state.risk.riskMetrics.cet1Requirement = 0.12;
  state.risk.riskMetrics.leverageRatio = 0.05;
  state.behaviour.depositFranchiseStrength = 0.7;
  state.market.gdpGrowthMoM = 0.001;
  state.market.unemploymentRate = 0.045;
  state.market.creditSpread = 0.012;
  return state;
};

describe('Share price model', () => {
  it('increases with stronger profitability (EPS signal)', () => {
    const stronger = makeBaselineState();
    stronger.financial.incomeStatement.netIncome = 150e6;

    const weaker = makeBaselineState();
    weaker.financial.incomeStatement.netIncome = -80e6;

    updateSharePrice(stronger, baseConfig, 1);
    updateSharePrice(weaker, baseConfig, 1);

    expect(stronger.equityMarket.sharePrice).toBeGreaterThan(weaker.equityMarket.sharePrice);
    expect(stronger.equityMarket.epsTtm).toBeGreaterThan(weaker.equityMarket.epsTtm);
  });

  it('increases with stronger capital strength', () => {
    const stronger = makeBaselineState();
    stronger.financial.incomeStatement.netIncome = 0;
    stronger.risk.riskMetrics.cet1Ratio = 0.17;
    stronger.risk.riskMetrics.cet1Requirement = 0.12;
    stronger.risk.riskMetrics.leverageRatio = 0.065;

    const weaker = makeBaselineState();
    weaker.financial.incomeStatement.netIncome = 0;
    weaker.risk.riskMetrics.cet1Ratio = 0.11;
    weaker.risk.riskMetrics.cet1Requirement = 0.12;
    weaker.risk.riskMetrics.leverageRatio = 0.038;

    updateSharePrice(stronger, baseConfig, 1);
    updateSharePrice(weaker, baseConfig, 1);

    expect(stronger.equityMarket.sharePrice).toBeGreaterThan(weaker.equityMarket.sharePrice);
  });

  it('uses common book value as a bank valuation anchor', () => {
    const largerBook = makeBaselineState();
    largerBook.financial.incomeStatement.netIncome = 0;
    largerBook.financial.capital.cet1 = 1.4e9;
    largerBook.financial.capital.at1 = 2e9;
    largerBook.financial.capital.accumulatedOCI = 0.1e9;

    const smallerBook = makeBaselineState();
    smallerBook.financial.incomeStatement.netIncome = 0;
    smallerBook.financial.capital.cet1 = 0.7e9;
    smallerBook.financial.capital.at1 = 2e9;
    smallerBook.financial.capital.accumulatedOCI = 0;

    updateSharePrice(largerBook, baseConfig, 1);
    updateSharePrice(smallerBook, baseConfig, 1);

    expect(largerBook.equityMarket.bookValuePerShare).toBeCloseTo(1.5, 10);
    expect(smallerBook.equityMarket.bookValuePerShare).toBeCloseTo(0.7, 10);
    expect(largerBook.equityMarket.sharePrice).toBeGreaterThan(smallerBook.equityMarket.sharePrice);
  });

  it('increases with better macro and franchise signals', () => {
    const stronger = makeBaselineState();
    stronger.financial.incomeStatement.netIncome = 0;
    stronger.market.gdpGrowthMoM = 0.003;
    stronger.market.unemploymentRate = 0.04;
    stronger.market.creditSpread = 0.009;
    stronger.behaviour.depositFranchiseStrength = 0.85;

    const weaker = makeBaselineState();
    weaker.financial.incomeStatement.netIncome = 0;
    weaker.market.gdpGrowthMoM = -0.002;
    weaker.market.unemploymentRate = 0.08;
    weaker.market.creditSpread = 0.02;
    weaker.behaviour.depositFranchiseStrength = 0.45;

    updateSharePrice(stronger, baseConfig, 1);
    updateSharePrice(weaker, baseConfig, 1);

    expect(stronger.equityMarket.sharePrice).toBeGreaterThan(weaker.equityMarket.sharePrice);
  });

  it('keeps monthly share-price moves bounded for playable feedback', () => {
    const state = makeBaselineState();
    state.equityMarket.sharePrice = 1;
    state.financial.incomeStatement.netIncome = 2e9;
    state.financial.capital.cet1 = 5e9;
    state.financial.capital.accumulatedOCI = 0;
    state.risk.riskMetrics.cet1Ratio = 0.4;
    state.risk.riskMetrics.leverageRatio = 0.2;

    updateSharePrice(state, baseConfig, 1);

    expect(state.equityMarket.sharePrice).toBeLessThanOrEqual(1 + baseConfig.behaviour.sharePriceModel.maxMonthlyMove);
  });

  it('applies a valuation discount when hard capital gates are breached', () => {
    const healthy = makeBaselineState();
    healthy.financial.incomeStatement.netIncome = 80e6;

    const breached = makeBaselineState();
    breached.financial.incomeStatement.netIncome = 80e6;
    breached.risk.compliance.cet1Breached = true;
    breached.risk.riskMetrics.cet1Ratio = 0.07;
    breached.risk.riskMetrics.leverageRatio = 0.025;

    updateSharePrice(healthy, baseConfig, 1);
    updateSharePrice(breached, baseConfig, 1);

    expect(healthy.equityMarket.fairValuePerShare).toBeGreaterThan(breached.equityMarket.fairValuePerShare ?? 0);
    expect(healthy.equityMarket.sharePrice).toBeGreaterThan(breached.equityMarket.sharePrice);
  });

  it('equity issuance increases shares outstanding (dilution path)', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);
    const sharesBefore = state.equityMarket.sharesOutstanding;

    const next = engine.step({
      state,
      config: baseConfig,
      actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'cet1', targetAmount: 0.2e9, maxDiscount: 0.5 }],
      shocks: [],
    }).nextState;

    expect(next.equityMarket.sharesOutstanding).toBeGreaterThan(sharesBefore);
    expect(next.equityMarket.sharePrice).toBeGreaterThan(0);
    expect(next.equityMarket.marketCap).toBeCloseTo(
      next.equityMarket.sharePrice * next.equityMarket.sharesOutstanding,
      6
    );
  });
});

describe('Earnings measurement and valuation sensitivity', () => {
  it('keeps actual trailing EPS unavailable until twelve observed months, then rolls earnings and shares', () => {
    const state = makeBaselineState();
    for (let month = 1; month <= 12; month += 1) {
      state.equityMarket.sharesOutstanding = month <= 6 ? 1e9 : 2e9;
      state.financial.incomeStatement.netIncome = 10e6;
      state.financial.incomeStatement.at1CouponExpense = 1e6;
      updateSharePrice(state, baseConfig, 1);
      if (month < 12) expect(state.equityMarket.trailingEps).toBeNull();
    }
    expect(state.equityMarket.trailingNetIncome).toBe(120e6);
    expect(state.equityMarket.trailingCommonIncome).toBe(108e6);
    expect(state.equityMarket.trailingWeightedAverageShares).toBe(1.5e9);
    expect(state.equityMarket.trailingEps).toBeCloseTo(108e6 / 1.5e9, 12);
    const cloned = cloneBankState(state);
    state.financial.incomeStatement.netIncome = -20e6;
    const diagnostics = updateSharePrice(state, baseConfig, 1)!;
    expect(state.equityMarket.trailingNetIncome).toBe(90e6);
    expect(state.equityMarket.trailingWeightedAverageShares).toBeCloseTo(19e9 / 12, 5);
    expect(cloned.equityMarket.earningsHistory).toHaveLength(12);
    expect(cloned.equityMarket.trailingNetIncome).toBe(120e6);
    expect(diagnostics.quotedPeTtm).toBeCloseTo(state.equityMarket.sharePrice / state.equityMarket.trailingEps!, 12);
  });

  it('annualises multi-month earnings by period length and weights partial trailing periods', () => {
    const state = makeBaselineState();
    state.financial.incomeStatement.netIncome = 30e6;
    state.financial.incomeStatement.at1CouponExpense = 0;
    const quarter = updateSharePrice(state, baseConfig, 3)!;
    expect(quarter.annualisedEps).toBeCloseTo(0.12, 12);
    expect(state.equityMarket.smoothedAnnualisedEps).toBeCloseTo(0.1 * 0.75 ** 3 + 0.12 * (1 - 0.75 ** 3), 12);
    state.financial.incomeStatement.netIncome = 100e6;
    updateSharePrice(state, baseConfig, 10);
    expect(state.equityMarket.trailingEarningsMonths).toBe(12);
    expect(state.equityMarket.trailingNetIncome).toBe(120e6);
    expect(state.equityMarket.trailingEps).toBeCloseTo(0.12, 12);
  });

  it('preserves score differentiation and continuity across the former saturation boundary', () => {
    const atSignal = (signal: number) => {
      const state = makeBaselineState();
      state.market.unemploymentRate = baseConfig.behaviour.sharePriceModel.macroUnemploymentNeutral;
      state.market.creditSpread = baseConfig.behaviour.sharePriceModel.macroCreditSpreadNeutral;
      state.market.gdpGrowthMoM = signal * 2 * baseConfig.behaviour.sharePriceModel.macroGdpScale;
      state.risk.riskMetrics.cet1Ratio = state.risk.riskMetrics.cet1Requirement + signal * baseConfig.behaviour.sharePriceModel.capitalCet1Scale / 0.7;
      state.risk.riskMetrics.leverageRatio = baseConfig.riskLimits.minLeverageRatio;
      state.financial.incomeStatement.netIncome = 10e6;
      return updateSharePrice(state, baseConfig, 1)!;
    };
    const left = atSignal(1 - 1e-6), right = atSignal(1 + 1e-6), stronger = atSignal(2);
    expect(right.macroScore).toBeGreaterThan(left.macroScore);
    expect(right.macroScore - left.macroScore).toBeLessThan(1e-6);
    expect(stronger.macroScore).toBeGreaterThan(right.macroScore);
    expect(stronger.capitalScore).toBeGreaterThan(right.capitalScore);
    expect(stronger.modelPe).toBeGreaterThan(right.modelPe);
    expect(stronger.fairValue).toBeGreaterThan(right.fairValue);
    const worse = atSignal(-2), bad = atSignal(-1);
    expect(worse.macroScore).toBeLessThan(bad.macroScore);
    expect(worse.capitalScore).toBeLessThan(bad.capitalScore);
  });

  it('raises the required return with spreads and reduces earnings reliability after a profit collapse', () => {
    const state = makeBaselineState();
    state.financial.incomeStatement.at1CouponExpense = 0;
    state.financial.incomeStatement.netIncome = 10e6;
    for (let month = 0; month < 12; month += 1) updateSharePrice(state, baseConfig, 1);
    const stable = cloneBankState(state), collapse = cloneBankState(state);
    stable.market.creditSpread = 0.008469;
    collapse.market.creditSpread = 0.024646;
    collapse.financial.incomeStatement.netIncome = 0.06e6;
    const healthy = updateSharePrice(stable, baseConfig, 1)!;
    const stressed = updateSharePrice(collapse, baseConfig, 1)!;
    expect(stressed.costOfEquity).toBeGreaterThan(healthy.costOfEquity);
    expect(stressed.earningsReliability).toBeLessThan(healthy.earningsReliability);
    expect(stressed.earningsWeight).toBeLessThan(healthy.earningsWeight);
    expect(stressed.earningsPersistence).toBeLessThan(healthy.earningsPersistence);
    expect(stressed.earningsVolatility).toBeGreaterThan(0);
    expect(stressed.fairValue).toBeLessThan(healthy.fairValue);
    expect(stressed.quotedPe).toBeCloseTo(stressed.sharePrice / stressed.epsTtm, 12);
    expect(stressed.quotedPe).not.toBe(stressed.modelPe);
  });

  it('values only capital above both management targets as excess capital', () => {
    const state = makeBaselineState();
    state.financial.incomeStatement.netIncome = 10e6;
    state.risk.riskMetrics.cet1Ratio = 0.18;
    state.risk.riskMetrics.internalCet1TargetRatio = 0.14;
    state.risk.riskMetrics.rwa = 7e9;
    state.risk.riskMetrics.leverageRatio = 0.06;
    state.risk.riskMetrics.internalLeverageTargetRatio = 0.05;
    state.risk.riskMetrics.leverageExposure = 12e9;
    const diagnostic = updateSharePrice(state, baseConfig, 1)!;
    expect(diagnostic.distributableCapitalProxy).toBeCloseTo(120e6, 5);
    expect(diagnostic.bookValue).toBeCloseTo(0.12 + diagnostic.modelPb * (diagnostic.bvps - 0.12), 12);
    state.risk.riskMetrics.leverageRatio = 0.049;
    expect(updateSharePrice(state, baseConfig, 1)!.distributableCapitalProxy).toBe(0);
  });
});
