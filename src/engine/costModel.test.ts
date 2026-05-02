import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, BalanceSheetSide } from '../domain/enums';
import { cloneBankState } from './clone';
import { CapitalCloseResult, LossRecognitionResult, PnLAccrualResult, closeCapital } from './simulation';

const makeStateWithMix = (mortgages: number, corporates: number) => {
  const state = cloneBankState(initialState);
  const mortgageItem = state.financial.balanceSheet.items.find((item) => item.productType === AssetProductType.Mortgages);
  const corporateItem = state.financial.balanceSheet.items.find((item) => item.productType === AssetProductType.CorporateLoans);
  const cashItem = state.financial.balanceSheet.items.find((item) => item.productType === AssetProductType.CashReserves);
  if (!mortgageItem || !corporateItem || !cashItem) {
    throw new Error('Missing balance-sheet lines for cost model test');
  }
  mortgageItem.balance = mortgages;
  corporateItem.balance = corporates;
  cashItem.balance = 50e9;
  return state;
};

const makeAccruals = (state: typeof initialState): PnLAccrualResult => ({
  assets: state.financial.balanceSheet.items.filter((item) => item.side === BalanceSheetSide.Asset),
  liabilities: state.financial.balanceSheet.items.filter((item) => item.side === BalanceSheetSide.Liability),
  interestIncome: 0,
  interestExpense: 0,
});

const makeLosses = (state: typeof initialState, creditLosses = 0): LossRecognitionResult => ({
  loanItems: state.financial.balanceSheet.items.filter(
    (item) =>
      item.productType === AssetProductType.Mortgages || item.productType === AssetProductType.CorporateLoans
  ),
  recognizedLoanLosses: {},
  recognizedNonLoanLosses: {},
  realizedLoanLosses: 0,
  realizedNonLoanLosses: 0,
  openingProvisionStock: 0,
  provisionCharge: creditLosses,
  creditLosses,
});

const runClose = (
  state: typeof initialState,
  {
    originations = 0,
    defaultedPrincipal = 0,
    creditLosses = 0,
  }: { originations?: number; defaultedPrincipal?: number; creditLosses?: number }
): CapitalCloseResult =>
  closeCapital(
    state,
    baseConfig,
    1,
    1 / 12,
    makeAccruals(state),
    makeLosses(state, creditLosses),
    0,
    0,
    { fvtplValuationImpact: 0, fvociOciMovement: 0, nonCashAdjustmentsByProduct: {} },
    originations,
    defaultedPrincipal,
    0,
    []
  );

describe('Cost model decomposition', () => {
  it('corporate-heavy mix has higher servicing costs than mortgage-heavy mix', () => {
    const mortgageHeavy = makeStateWithMix(320e9, 90e9);
    const corporateHeavy = makeStateWithMix(170e9, 240e9);

    const mortgageHeavyClose = runClose(mortgageHeavy, {});
    const corporateHeavyClose = runClose(corporateHeavy, {});

    expect(corporateHeavyClose.servicingCosts).toBeGreaterThan(mortgageHeavyClose.servicingCosts);
  });

  it('workout costs increase when defaults increase', () => {
    const lowDefaultState = makeStateWithMix(250e9, 160e9);
    const highDefaultState = makeStateWithMix(250e9, 160e9);

    const lowDefaultClose = runClose(lowDefaultState, { defaultedPrincipal: 0, creditLosses: 0 });
    const highDefaultClose = runClose(highDefaultState, {
      defaultedPrincipal: 8e9,
      creditLosses: 2e9,
    });

    expect(highDefaultClose.workoutCosts).toBeGreaterThan(lowDefaultClose.workoutCosts);
    expect(highDefaultClose.netIncome).toBeLessThan(lowDefaultClose.netIncome);
  });
});
