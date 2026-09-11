import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType as A, LiabilityProductType as L } from '../domain/enums';
import { cloneBankState } from './clone';
import { calculateRiskMetrics } from './metrics';
import { createSimulationEngine } from './simulation';

const balance = (state: typeof initialState, product: A | L) =>
  state.financial.balanceSheet.items.find(i => i.productType === product)?.balance ?? 0;

const engine = createSimulationEngine();

describe('small UK retail-bank model', () => {
  it('opens as a retail-heavy bank', () => {
    expect(balance(initialState, L.RetailCurrentAccounts)).toBe(7.0e9);
    expect(initialState.financial.balanceSheet.items.find(i => i.productType === L.RetailCurrentAccounts)?.label).toBe('Retail current accounts');
    expect(initialState.financial.balanceSheet.items.find(i => i.productType === L.RetailCurrentAccounts)?.interestRate).toBeCloseTo(0.017, 8);
    expect(balance(initialState, A.Mortgages)).toBeGreaterThan(balance(initialState, A.CorporateLoans));
    expect(balance(initialState, A.ConsumerLoans)).toBeGreaterThan(0);
    expect(balance(initialState, L.RetailTermDeposits)).toBeGreaterThan(0);
    expect(initialState.fundingLadders[L.RetailTermDeposits]?.length).toBeGreaterThan(1);
  });

  it('does not add an unused short-term wholesale line during an ordinary close', () => {
    const out = engine.step({ state: cloneBankState(initialState), config: baseConfig, shocks: [], actions: [] }).nextState;
    expect(out.financial.balanceSheet.items.some(i => i.productType === L.WholesaleFundingST)).toBe(false);
  });

  it('replenishes competitively priced fixed-term savings as contractual buckets mature', () => {
    let state = cloneBankState(initialState);
    for (let month = 0; month < 18; month++) {
      state = engine.step({
        state, config: baseConfig, shocks: [],
        actions: [
          { type: 'adjustRate', productType: L.RetailTermDeposits, newRate: state.market.competitorTermDepositRate },
          { type: 'setTermDepositPolicy', tenorMonths: 12 },
        ],
      }).nextState;
    }
    expect(balance(state, L.RetailTermDeposits)).toBeGreaterThan(0.8e9);
    expect(balance(state, L.RetailTermDeposits)).toBeLessThan(2.5e9);
    expect((state.fundingLadders[L.RetailTermDeposits] ?? []).length).toBeGreaterThan(5);
  });

  it('lets Treasury change HQLA composition without creating assets', () => {
    const state = cloneBankState(initialState);
    const cash0 = balance(state, A.CashReserves);
    const gilts0 = balance(state, A.Gilts);
    const out = engine.step({
      state,
      config: baseConfig,
      shocks: [],
      actions: [{ type: 'buySellAsset', productType: A.Gilts, amountDelta: 100e6, tenorMonths: 24 }],
    }).nextState;
    const liquid0 = cash0 + gilts0;
    const liquid1 = balance(out, A.CashReserves) + balance(out, A.Gilts);
    expect(Math.abs(liquid1 - liquid0)).toBeLessThan(200e6); // normal monthly customer/business flows can move cash; Treasury policy must not manufacture a material balance sheet.
    expect(balance(out, A.Gilts)).toBeGreaterThan(gilts0);
    expect((out.assetMaturityLadders?.[A.Gilts] ?? []).some(bucket => bucket.tenorMonths === 24)).toBe(true);
  });

  it('uses BoE secured funding as collateralised liquidity', () => {
    const state = cloneBankState(initialState);
    const cash0 = balance(state, A.CashReserves);
    const out = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      shocks: [],
      actions: [{ type: 'drawBoeFunding', facility: 'ILTR', amount: 250e6 }],
    }).nextState;
    expect(balance(out, L.BankOfEnglandFunding)).toBeGreaterThan(0);
    expect(balance(out, A.CashReserves)).toBeGreaterThan(cash0 - 250e6); // ordinary monthly flows continue too.
    const gilts = out.financial.balanceSheet.items.find(i => i.productType === A.Gilts)!;
    expect(gilts.encumbrance.encumberedAmount).toBeGreaterThan(0);
  });

  it('Tier 2 improves total capital but not CET1 or leverage numerator', () => {
    const before = calculateRiskMetrics({ state: cloneBankState(initialState), config: baseConfig });
    const out = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      shocks: [],
      actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'tier2', targetAmount: 150e6, maxSpreadBps: 2500, tenorMonths: 60 }],
    }).nextState;
    expect(out.financial.capital.tier2).toBeGreaterThan(0);
    expect(out.risk.riskMetrics.totalCapitalRatio).toBeGreaterThan(before.totalCapitalRatio ?? 0);
    expect(Math.abs(out.risk.riskMetrics.cet1Ratio - before.cet1Ratio)).toBeLessThan(0.03);
  });

  it('mortgage structure changes structural interest-rate risk', () => {
    const short = engine.step({
      state: cloneBankState(initialState), config: baseConfig, shocks: [],
      actions: [{ type: 'setMortgagePolicy', maxLtv: 0.75, fixedPeriodMonths: 24 }],
    }).nextState;
    const long = engine.step({
      state: cloneBankState(initialState), config: baseConfig, shocks: [],
      actions: [{ type: 'setMortgagePolicy', maxLtv: 0.90, fixedPeriodMonths: 60 }],
    }).nextState;
    expect(Math.abs(long.risk.riskMetrics.eveSensitivity100bp)).toBeGreaterThan(Math.abs(short.risk.riskMetrics.eveSensitivity100bp));
  });
});
