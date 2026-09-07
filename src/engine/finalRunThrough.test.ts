import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { BankState } from '../domain/bankState';
import { PlayerAction } from '../domain/actions';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const balance = (state: BankState, product: AssetProductType | LiabilityProductType): number =>
  state.financial.balanceSheet.items.find((line) => line.productType === product)?.balance ?? 0;

const deposits = (state: BankState): number =>
  balance(state, LiabilityProductType.RetailTransactionalDeposits) +
  balance(state, LiabilityProductType.RetailSavingsDeposits) +
  balance(state, LiabilityProductType.CorporateOperatingDeposits) +
  balance(state, LiabilityProductType.CorporateNonOperatingDeposits);

const buckets = (state: BankState): number =>
  Object.values(state.loanCohorts ?? {}).reduce((sum, cohorts) => sum + (cohorts?.length ?? 0), 0) +
  Object.values(state.workoutPipelines ?? {}).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);

const policy = (state: BankState, monthIndex: number): PlayerAction[] => {
  const actions: PlayerAction[] = [
    {
      type: 'adjustRate',
      productType: AssetProductType.Mortgages,
      newRate: Math.max(0, state.market.competitorMortgageRate - 0.004),
    },
    {
      type: 'adjustRate',
      productType: AssetProductType.CorporateLoans,
      newRate: Math.max(0, state.market.riskFreeLong + state.market.corporateLoanSpread - 0.006),
    },
    { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: 0.15 },
    { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: 0.15 },
    { type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'auto' },
  ];

  if (monthIndex % 12 === 0) {
    const cash = balance(state, AssetProductType.CashReserves);
    const offset = cash < 1.5e9 ? 0.0025 : cash > 3.5e9 ? -0.0025 : 0;
    const retail = Math.max(0, state.market.competitorRetailDepositRate + offset);
    const corporate = Math.max(
      0,
      (state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate) + offset
    );
    actions.push(
      { type: 'adjustRate', productType: LiabilityProductType.RetailTransactionalDeposits, newRate: retail },
      { type: 'adjustRate', productType: LiabilityProductType.RetailSavingsDeposits, newRate: retail },
      { type: 'adjustRate', productType: LiabilityProductType.CorporateOperatingDeposits, newRate: corporate },
      { type: 'adjustRate', productType: LiabilityProductType.CorporateNonOperatingDeposits, newRate: corporate },
    );
  }
  return actions;
};

const snapshot = (state: BankState) => ({
  month: state.time.step,
  mortgagesBn: balance(state, AssetProductType.Mortgages) / 1e9,
  corporateLoansBn: balance(state, AssetProductType.CorporateLoans) / 1e9,
  customerDepositsBn: deposits(state) / 1e9,
  cashBn: balance(state, AssetProductType.CashReserves) / 1e9,
  cet1Ratio: state.risk.riskMetrics.cet1Ratio,
  leverageRatio: state.risk.riskMetrics.leverageRatio,
  lcr: state.risk.riskMetrics.lcr,
  nsfr: state.risk.riskMetrics.nsfr,
  monthlyNetIncomeM: state.financial.incomeStatement.netIncome / 1e6,
  depositFranchise: state.behaviour.depositFranchiseStrength,
  loanStateBuckets: buckets(state),
});

describe('temporary final run-through', () => {
  it('prints the managed ten-year trajectory', () => {
    const engine = createSimulationEngine();
    let state = cloneBankState(initialState);
    const checkpoints = new Set([12, 36, 60, 120]);
    const trace: ReturnType<typeof snapshot>[] = [];

    for (let month = 0; month < 120; month++) {
      state = engine.step({ state, config: baseConfig, actions: policy(state, month), shocks: [] }).nextState;
      if (checkpoints.has(state.time.step)) trace.push(snapshot(state));
      if (state.status.hasFailed) break;
    }

    console.log('FINAL_RUN_THROUGH', JSON.stringify(trace));
    expect(state.status.hasFailed).toBe(false);
    expect(state.time.step).toBeGreaterThanOrEqual(120);
  }, 60000);
});
