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
      actions: [{ type: 'issueEquity', amount: 0.2e9 }],
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
