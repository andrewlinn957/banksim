import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { createActionFormState } from './actionFormState';
import { buildActionsFromParsed, cancelActionFormTransaction, parseActionFormInputs, PLAYER_CONTROL_REGISTRY } from './playerControls';

describe('shared player controls', () => {
  it('applies the single GUI business deposit offer to both corporate deposit books', () => {
    const form = { ...createActionFormState(initialState, baseConfig), corporateDepositRate: '2.4%' };
    const parsed = parseActionFormInputs(form);
    expect(parsed.hasErrors).toBe(false);

    const actions = buildActionsFromParsed(parsed, form, initialState);
    const corporateRates = actions.filter((action) =>
      action.type === 'adjustRate' && [
        LiabilityProductType.CorporateOperatingDeposits,
        LiabilityProductType.CorporateNonOperatingDeposits,
      ].includes(action.productType as LiabilityProductType)
    );

    expect(corporateRates).toEqual([
      { type: 'adjustRate', productType: LiabilityProductType.CorporateOperatingDeposits, newRate: 0.024 },
      { type: 'adjustRate', productType: LiabilityProductType.CorporateNonOperatingDeposits, newRate: 0.024 },
    ]);
    expect(actions.some((action) => action.type === 'setUnderwriting' && action.productType === AssetProductType.Mortgages)).toBe(true);
  });

  it('shares GUI validation and exposes no engine-only servicing controls', () => {
    const form = {
      ...createActionFormState(initialState, baseConfig),
      mortgageUnderwritingTightness: '150%',
      giltTradeDirection: 'buy' as const,
      giltTradeAmount: '-5m',
    };
    const parsed = parseActionFormInputs(form);
    expect(parsed.hasErrors).toBe(true);
    expect(parsed.errors.mortgageUnderwritingTightness).toContain('100%');
    expect(parsed.errors.giltTradeAmount).toContain('Enter an amount for the selected gilt transaction');

    const exposedActions = new Set(PLAYER_CONTROL_REGISTRY.flatMap((control) => control.engineActions));
    expect(exposedActions.has('modifyLoanCohort')).toBe(false);
    expect(exposedActions.has('purchasePociLoan')).toBe(false);
    expect(exposedActions.has('setBorrowerPayment')).toBe(false);
    expect(PLAYER_CONTROL_REGISTRY.some((control) => control.formFields.includes('at1CouponMode'))).toBe(false);
    expect(PLAYER_CONTROL_REGISTRY.some((control) => control.formFields.includes('hedgeFixedRate'))).toBe(false);
  });

  it('enforces capital-market ticket choices for the originating management area', () => {
    const form = { ...createActionFormState(initialState, baseConfig), capitalMarketsInstrument: 'senior' as const, capitalMarketsTargetAmount: '100m' };
    expect(parseActionFormInputs(form, { capitalMarketsArea: 'Capital' }).errors.capitalMarketsInstrument).toContain('permitted');
    expect(parseActionFormInputs(form, { capitalMarketsArea: 'Treasury' }).hasErrors).toBe(false);
  });

  it('keeps a transaction as a draft until the shared month-close builder is called', () => {
    const emptyForm = createActionFormState(initialState, baseConfig);
    const initialActions = buildActionsFromParsed(parseActionFormInputs(emptyForm), emptyForm, initialState);
    expect(initialActions.some((action) => action.type === 'launchCapitalMarketsTransaction')).toBe(false);

    const queuedForm = { ...emptyForm, capitalMarketsInstrument: 'cet1' as const, capitalMarketsTargetAmount: '100m' };
    const queuedActions = buildActionsFromParsed(parseActionFormInputs(queuedForm), queuedForm, initialState);
    expect(queuedActions.some((action) => action.type === 'launchCapitalMarketsTransaction')).toBe(true);
  });

  it('cancels only the selected GUI transaction draft and preserves standing policy', () => {
    const form = {
      ...createActionFormState(initialState, baseConfig),
      retailCurrentAccountRate: '2.75%',
      capitalMarketsInstrument: 'cet1' as const,
      capitalMarketsTargetAmount: '100m',
      giltTradeDirection: 'buy' as const,
      giltTradeAmount: '50m',
    };
    const afterCancel = cancelActionFormTransaction(form, 'capitalMarkets');

    expect(afterCancel.capitalMarketsInstrument).toBe('none');
    expect(afterCancel.capitalMarketsTargetAmount).toBe('');
    expect(afterCancel.giltTradeDirection).toBe('buy');
    expect(afterCancel.giltTradeAmount).toBe('50m');
    expect(afterCancel.retailCurrentAccountRate).toBe('2.75%');
  });
});
