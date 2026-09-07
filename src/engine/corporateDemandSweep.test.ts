import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { SimulationConfig } from '../domain/config';
import { BankState } from '../domain/bankState';
import { PlayerAction } from '../domain/actions';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const balance = (state: BankState, product: AssetProductType | LiabilityProductType): number =>
  state.financial.balanceSheet.items.find((line) => line.productType === product)?.balance ?? 0;

const policy = (state: BankState, monthIndex: number): PlayerAction[] => {
  const actions: PlayerAction[] = [
    { type: 'adjustRate', productType: AssetProductType.Mortgages, newRate: Math.max(0, state.market.competitorMortgageRate - 0.004) },
    { type: 'adjustRate', productType: AssetProductType.CorporateLoans, newRate: Math.max(0, state.market.riskFreeLong + state.market.corporateLoanSpread - 0.006) },
    { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: 0.15 },
    { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: 0.15 },
    { type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'auto' },
  ];
  if (monthIndex % 12 === 0) {
    const cash = balance(state, AssetProductType.CashReserves);
    const offset = cash < 1.5e9 ? 0.0025 : cash > 3.5e9 ? -0.0025 : 0;
    const retail = Math.max(0, state.market.competitorRetailDepositRate + offset);
    const corporate = Math.max(0, (state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate) + offset);
    actions.push(
      { type: 'adjustRate', productType: LiabilityProductType.RetailTransactionalDeposits, newRate: retail },
      { type: 'adjustRate', productType: LiabilityProductType.RetailSavingsDeposits, newRate: retail },
      { type: 'adjustRate', productType: LiabilityProductType.CorporateOperatingDeposits, newRate: corporate },
      { type: 'adjustRate', productType: LiabilityProductType.CorporateNonOperatingDeposits, newRate: corporate },
    );
  }
  return actions;
};

const run = (config: SimulationConfig, months: number, managed: boolean) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(initialState);
  let failureMonth: number | null = null;
  for (let month = 0; month < months; month++) {
    state = engine.step({ state, config, actions: managed ? policy(state, month) : [], shocks: [] }).nextState;
    if (state.status.hasFailed) {
      failureMonth = month + 1;
      break;
    }
  }
  return {
    failureMonth,
    mortgagesBn: balance(state, AssetProductType.Mortgages) / 1e9,
    corporateBn: balance(state, AssetProductType.CorporateLoans) / 1e9,
    depositsBn: [
      LiabilityProductType.RetailTransactionalDeposits,
      LiabilityProductType.RetailSavingsDeposits,
      LiabilityProductType.CorporateOperatingDeposits,
      LiabilityProductType.CorporateNonOperatingDeposits,
    ].reduce((sum, product) => sum + balance(state, product), 0) / 1e9,
    cet1: state.risk.riskMetrics.cet1Ratio,
    leverage: state.risk.riskMetrics.leverageRatio,
    lcr: state.risk.riskMetrics.lcr,
    nsfr: state.risk.riskMetrics.nsfr,
    franchise: state.behaviour.depositFranchiseStrength,
  };
};

describe('temporary corporate demand calibration', () => {
  it('compares higher corporate demand replacement rates', () => {
    const outputs = [0.03, 0.035, 0.04, 0.045, 0.05].map((rate) => {
      const config = structuredClone(baseConfig);
      config.behaviour.loanPipelineByProduct![AssetProductType.CorporateLoans]!.baseDemandRateMonthly = rate;
      return {
        rate,
        managedTenYear: run(config, 120, true),
        passiveFiveYear: run(config, 60, false),
      };
    });
    console.log('CORPORATE_DEMAND_SWEEP_HIGH', JSON.stringify(outputs));
    outputs.forEach((output) => expect(output.managedTenYear.failureMonth).toBe(null));
  }, 120000);
});
