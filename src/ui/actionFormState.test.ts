import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { clearOneOffTransactions, createActionFormState } from './actionFormState';

describe('action form state', () => {
  it('constructs policy defaults from bank state and config', () => {
    const form = createActionFormState(initialState, baseConfig);
    expect(form.retailCurrentAccountRate).toMatch(/%$/);
    expect(form.termDepositTenorMonths).toBe(String(initialState.behaviour.termDepositTenorMonths ?? 12));
    expect(form.dividendPayoutRatio).toBe(String(initialState.behaviour.capitalPolicy?.dividendPayoutRatio ?? baseConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio));
    expect(form.capitalMarketsInstrument).toBe('none');
    expect(form.hedgeDirection).toBe('none');
  });

  it('clears one-off transactions without changing recurring policy settings', () => {
    const base = createActionFormState(initialState, baseConfig);
    const queued: typeof base = {
      ...base,
      retailCurrentAccountRate: '2.25%',
      capitalMarketsInstrument: 'cet1',
      capitalMarketsTargetAmount: '250m',
      giltTradeDirection: 'buy',
      giltTradeAmount: '50m',
      boeFacility: 'indexedLtRepo',
      boeFundingAmount: '100m',
      hedgeDirection: 'payFixed',
      hedgeNotional: '75m',
    };
    const cleared = clearOneOffTransactions(queued);
    expect(cleared.retailCurrentAccountRate).toBe('2.25%');
    expect(cleared.capitalMarketsInstrument).toBe('none');
    expect(cleared.capitalMarketsTargetAmount).toBe('');
    expect(cleared.giltTradeDirection).toBe('none');
    expect(cleared.giltTradeAmount).toBe('');
    expect(cleared.boeFacility).toBe('none');
    expect(cleared.boeFundingAmount).toBe('');
    expect(cleared.hedgeDirection).toBe('none');
    expect(cleared.hedgeNotional).toBe('');
  });
});
