import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { PlayerAction } from '../domain/actions';
import { BankState } from '../domain/bankState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const balance = (state: BankState, productType: string): number =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType)?.balance ?? 0;

const snapshot = (state: BankState) => ({
  month: state.time.step,
  failed: state.status.hasFailed,
  assets: Object.fromEntries(
    state.financial.balanceSheet.items
      .filter((item) => ['CashReserves','Gilts','Mortgages','CorporateLoans','ReverseRepo','DerivativeAssets'].includes(item.productType))
      .map((item) => [item.productType, +(item.balance / 1e9).toFixed(3)])
  ),
  liabilities: Object.fromEntries(
    state.financial.balanceSheet.items
      .filter((item) => ['RetailTransactionalDeposits','RetailSavingsDeposits','CorporateOperatingDeposits','CorporateNonOperatingDeposits','WholesaleFundingST','WholesaleFundingLT','RepurchaseAgreements','DerivativeLiabilities','CreditProvisions'].includes(item.productType))
      .map((item) => [item.productType, +(item.balance / 1e9).toFixed(3)])
  ),
  capital: {
    cet1Bn: +(state.financial.capital.cet1 / 1e9).toFixed(3),
    at1Bn: +(state.financial.capital.at1 / 1e9).toFixed(3),
  },
  risk: {
    cet1: +state.risk.riskMetrics.cet1Ratio.toFixed(4),
    leverage: +state.risk.riskMetrics.leverageRatio.toFixed(4),
    lcr: +state.risk.riskMetrics.lcr.toFixed(3),
    nsfr: +state.risk.riskMetrics.nsfr.toFixed(3),
    nii100bp: +(state.risk.riskMetrics.niiSensitivity100bp / 1e6).toFixed(1),
    eve100bp: +(state.risk.riskMetrics.eveSensitivity100bp / 1e6).toFixed(1),
    funding3mBn: +(state.risk.riskMetrics.fundingMaturing3m / 1e9).toFixed(3),
    funding12mBn: +(state.risk.riskMetrics.fundingMaturing12m / 1e9).toFixed(3),
  },
});

const retailPolicy = (state: BankState, monthIndex: number): PlayerAction[] => {
  const actions: PlayerAction[] = [
    { type: 'adjustRate', productType: LiabilityProductType.RetailTransactionalDeposits, newRate: Math.max(0, state.market.competitorRetailDepositRate - 0.002) },
    { type: 'adjustRate', productType: LiabilityProductType.RetailSavingsDeposits, newRate: Math.max(0, state.market.competitorRetailDepositRate + 0.001) },
    { type: 'adjustRate', productType: LiabilityProductType.CorporateOperatingDeposits, newRate: Math.max(0, (state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate) - 0.003) },
    { type: 'adjustRate', productType: LiabilityProductType.CorporateNonOperatingDeposits, newRate: Math.max(0, (state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate) - 0.005) },
    { type: 'adjustRate', productType: AssetProductType.Mortgages, newRate: Math.max(0, state.market.competitorMortgageRate + 0.0025) },
    { type: 'adjustRate', productType: AssetProductType.CorporateLoans, newRate: Math.max(0, state.market.riskFreeLong + state.market.corporateLoanSpread + 0.012) },
    { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: 0.45 },
    { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: 0.85 },
    { type: 'setCapitalPolicy', dividendPayoutRatio: 0.15, at1CouponMode: 'auto' },
  ];

  // A small retail bank might term out funding if stable-funding headroom becomes thin.
  if (monthIndex % 12 === 0 && state.risk.riskMetrics.nsfr < 1.15) {
    actions.push({
      type: 'issueDebt',
      productType: LiabilityProductType.WholesaleFundingLT,
      amount: 250e6,
      maturityMonths: 60,
    });
  }
  return actions;
};

const run = (label: string, months: number, actionsForMonth: (state: BankState, monthIndex: number) => PlayerAction[]) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(initialState);
  const opening = new Map(state.financial.balanceSheet.items.map((item) => [item.productType, item.balance]));
  const stats = new Map<string, { min: number; max: number; changed: boolean; everNonZero: boolean }>();
  state.financial.balanceSheet.items.forEach((item) => stats.set(item.productType, { min: item.balance, max: item.balance, changed: false, everNonZero: item.balance !== 0 }));
  const yearly = [snapshot(state)];
  const actionCounts: Record<string, number> = {};

  for (let i = 0; i < months && !state.status.hasFailed; i++) {
    const actions = actionsForMonth(state, i);
    actions.forEach((action) => actionCounts[action.type] = (actionCounts[action.type] ?? 0) + 1);
    state = engine.step({ state, config: baseConfig, actions, shocks: [] }).nextState;
    for (const item of state.financial.balanceSheet.items) {
      const s = stats.get(item.productType) ?? { min: item.balance, max: item.balance, changed: false, everNonZero: false };
      s.min = Math.min(s.min, item.balance);
      s.max = Math.max(s.max, item.balance);
      s.changed ||= Math.abs(item.balance - (opening.get(item.productType) ?? 0)) > 1e3;
      s.everNonZero ||= Math.abs(item.balance) > 1e3;
      stats.set(item.productType, s);
    }
    if ((i + 1) % 12 === 0 || state.status.hasFailed) yearly.push(snapshot(state));
  }

  const usage = [...stats.entries()].map(([productType, s]) => ({
    productType,
    openingBn: +((opening.get(productType) ?? 0) / 1e9).toFixed(3),
    endingBn: +(balance(state, productType) / 1e9).toFixed(3),
    minBn: +(s.min / 1e9).toFixed(3),
    maxBn: +(s.max / 1e9).toFixed(3),
    changed: s.changed,
    everNonZero: s.everNonZero,
  }));

  console.log(`BALANCE_SHEET_AUDIT_${label}`, JSON.stringify({ actionCounts, usage, yearly }));
  return state;
};

describe('temporary small UK retail-bank balance-sheet audit', () => {
  it('plays passive and retail-focused runs and reports product usage', () => {
    const passive = run('PASSIVE_60M', 60, () => []);
    const retail = run('RETAIL_120M', 120, retailPolicy);
    expect(passive.time.step).toBeGreaterThan(initialState.time.step);
    expect(retail.time.step).toBeGreaterThan(initialState.time.step);
  });
});
