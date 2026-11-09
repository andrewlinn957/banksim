import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from '../engine/clone';
import { AssetProductType } from '../domain/enums';
import { createActionFormState } from '../application/actionFormState';
import { buildTreasuryTransactionLimits } from './treasuryLimits';

describe('shared Treasury transaction limits', () => {
  it('uses unencumbered gilts and subtracts a queued sale before calculating BoE collateral capacity', () => {
    const state = cloneBankState(initialState);
    state.financial.capital.cet1 += 100e9;
    const gilts = state.financial.balanceSheet.items.find((item) => item.productType === AssetProductType.Gilts);
    if (!gilts) throw new Error('Initial state has no gilt balance');
    gilts.encumbrance = { encumberedAmount: 100e6, remainingMonths: 4 };

    const noTicket = createActionFormState(state, baseConfig);
    const limitsBeforeSale = buildTreasuryTransactionLimits(state, baseConfig, noTicket);
    expect(limitsBeforeSale.maxGiltSaleAmount).toBe(gilts.balance - 100e6);

    const queuedSale = { ...noTicket, giltTradeDirection: 'sell' as const, giltTradeAmount: '200m' };
    const limitsAfterSale = buildTreasuryTransactionLimits(state, baseConfig, queuedSale);
    expect(limitsAfterSale.maxGiltSaleAmount).toBe(limitsBeforeSale.maxGiltSaleAmount);
    expect(limitsAfterSale.maxBoeFundingAmount).toBeLessThan(limitsBeforeSale.maxBoeFundingAmount);
    expect(limitsAfterSale.maxBoeFundingAmount).toBeGreaterThanOrEqual(0);
  });
});
