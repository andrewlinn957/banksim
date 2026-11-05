import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';
import { checkInvariants } from './invariants';
import { loanCarryingAmounts } from '../products/loanBalances';
import { purchasePociAsset, revisePociAsset } from './poci';

const product = AssetProductType.CorporateLoans;
const receipts = Array.from({ length: 24 }, () => 50_000);

describe('POCI purchases integrated with BankSim balance sheet', () => {
  it('funds purchase from cash at price, books no initial loss, and recognises credit-adjusted net interest', () => {
    const engine = createSimulationEngine();
    const initial = cloneBankState(initialState);
    const purchase = engine.step({
      state: initial, config: baseConfig, shocks: [], actions: [{
        type: 'purchasePociLoan', assetId: 'poci-a', productType: product,
        contractualFaceValue: 1_200_000, purchasePrice: 950_000,
        expectedMonthlyCashFlows: receipts,
      }],
    });
    const state = purchase.nextState;
    const asset = state.pociAssets?.find(x => x.assetId === 'poci-a');
    expect(asset).toBeDefined();
    expect(asset!.cumulativeLossAllowance).toBe(0);
    expect(asset!.monthsElapsed).toBe(1);
    expect(asset!.netCarryingAmount).toBeCloseTo(
      950_000 * (1 + asset!.creditAdjustedEir / 12) - 50_000, 5,
    );
    expect(Math.abs(loanCarryingAmounts(state).total.reconciliationDifference)).toBeLessThan(1);
    expect(checkInvariants(state)).toEqual([]);
  });

  it('recognises only revised expected recoveries, allows recoveries above initial forecasts, and replays', () => {
    const engine = createSimulationEngine();
    const first = engine.step({
      state: initialState, config: baseConfig, shocks: [], actions: [{
        type: 'purchasePociLoan', assetId: 'poci-b', productType: product,
        contractualFaceValue: 1_200_000, purchasePrice: 950_000,
        expectedMonthlyCashFlows: receipts,
      }],
    }).nextState;
    const asset = first.pociAssets![0];
    const revised = asset.currentExpectedCashFlows.map(x => x * 0.8);
    const second = engine.step({ state: first, config: baseConfig, shocks: [], actions: [{
      type: 'revisePociLoan', assetId: 'poci-b', revisedMonthlyCashFlows: revised,
    }] }).nextState;
    expect(second.financial.incomeStatement.pociImpairmentGainLoss).toBeLessThan(0);
    expect(second.pociAssets![0].cumulativeLossAllowance).toBeGreaterThan(0);
    expect(checkInvariants(second)).toEqual([]);

    const improved = second.pociAssets![0].currentExpectedCashFlows.map(x => x * 1.5);
    const third = engine.step({ state: second, config: baseConfig, shocks: [], actions: [{
      type: 'revisePociLoan', assetId: 'poci-b', revisedMonthlyCashFlows: improved,
    }] }).nextState;
    expect(third.financial.incomeStatement.pociImpairmentGainLoss).toBeGreaterThan(0);
    expect(third.pociAssets![0].cumulativeLossAllowance).toBeLessThan(0);
    expect(Math.abs(loanCarryingAmounts(third).total.reconciliationDifference)).toBeLessThan(1);
    expect(checkInvariants(third)).toEqual([]);
  });

  it('rejects unfunded purchases and protects cloned POCI cash-flow schedules', () => {
    const state = cloneBankState(initialState);
    expect(() => purchasePociAsset(state, {
      assetId: 'unfunded', productType: product, contractualFaceValue: 1e12,
      purchasePrice: 1e12, expectedMonthlyCashFlows: [1e12],
    })).toThrow('Insufficient cash');
    purchasePociAsset(state, {
      assetId: 'copied', productType: product, contractualFaceValue: 1_200_000,
      purchasePrice: 950_000, expectedMonthlyCashFlows: receipts,
    });
    const cloned = cloneBankState(state);
    revisePociAsset(cloned, 'copied', receipts.map(x => x * 0.9));
    expect(state.pociAssets![0].currentExpectedCashFlows[0]).toBe(50_000);
    expect(cloned.pociAssets![0].currentExpectedCashFlows[0]).toBe(45_000);
  });
});
