import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { calibrationPacks } from '../config/calibration';
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

const run = (config: SimulationConfig, start: BankState, months: number, managed: boolean) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(start);
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
    corporateBn: balance(state, AssetProductType.CorporateLoans) / 1e9,
    depositsBn: [
      LiabilityProductType.RetailTransactionalDeposits,
      LiabilityProductType.RetailSavingsDeposits,
      LiabilityProductType.CorporateOperatingDeposits,
      LiabilityProductType.CorporateNonOperatingDeposits,
    ].reduce((sum, product) => sum + balance(state, product), 0) / 1e9,
    cet1: state.risk.riskMetrics.cet1Ratio,
    leverage: state.risk.riskMetrics.leverageRatio,
  };
};

const overrideCorporate = (config: SimulationConfig, pricingSensitivity: number) => {
  const cloned = structuredClone(config);
  const corporate = cloned.behaviour.loanPipelineByProduct![AssetProductType.CorporateLoans]!;
  corporate.baseDemandRateMonthly = 0.03;
  corporate.pricingSensitivity = pricingSensitivity;
  return cloned;
};

describe('temporary corporate pricing-capture calibration', () => {
  it('finds a managed capture sensitivity that preserves neutral runway', () => {
    const challenger = calibrationPacks.find((pack) => pack.id === 'challenger');
    if (!challenger) throw new Error('Missing challenger pack');
    const outputs = [80, 100, 120, 140, 160].map((pricingSensitivity) => ({
      pricingSensitivity,
      managedTenYear: run(overrideCorporate(baseConfig, pricingSensitivity), initialState, 120, true),
      passiveFiveYear: run(overrideCorporate(baseConfig, pricingSensitivity), initialState, 60, false),
      challengerTwoYear: run(overrideCorporate(challenger.config, pricingSensitivity), challenger.initialState, 24, false),
    }));
    console.log('CORPORATE_CAPTURE_SWEEP', JSON.stringify(outputs));
    outputs.forEach((output) => expect(output.managedTenYear.failureMonth).toBe(null));
  }, 120000);
});
