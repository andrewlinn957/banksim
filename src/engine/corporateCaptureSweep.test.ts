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

const policy = (state: BankState, monthIndex: number, corporateDiscount: number): PlayerAction[] => {
  const actions: PlayerAction[] = [
    { type: 'adjustRate', productType: AssetProductType.Mortgages, newRate: Math.max(0, state.market.competitorMortgageRate - 0.004) },
    { type: 'adjustRate', productType: AssetProductType.CorporateLoans, newRate: Math.max(0, state.market.riskFreeLong + state.market.corporateLoanSpread - corporateDiscount) },
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

const run = (config: SimulationConfig, start: BankState, months: number, managed: boolean, corporateDiscount = 0) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(start);
  let failureMonth: number | null = null;
  for (let month = 0; month < months; month++) {
    state = engine.step({ state, config, actions: managed ? policy(state, month, corporateDiscount) : [], shocks: [] }).nextState;
    if (state.status.hasFailed) {
      failureMonth = month + 1;
      break;
    }
  }
  return {
    failureMonth,
    corporateBn: balance(state, AssetProductType.CorporateLoans) / 1e9,
    cet1: state.risk.riskMetrics.cet1Ratio,
    leverage: state.risk.riskMetrics.leverageRatio,
  };
};

const overrideCorporate = (config: SimulationConfig, baseDemandRateMonthly: number, pricingSensitivity: number) => {
  const cloned = structuredClone(config);
  const corporate = cloned.behaviour.loanPipelineByProduct![AssetProductType.CorporateLoans]!;
  corporate.baseDemandRateMonthly = baseDemandRateMonthly;
  corporate.pricingSensitivity = pricingSensitivity;
  return cloned;
};

describe('temporary corporate pricing-capture calibration', () => {
  it('tests lower neutral demand with stronger deliberate price capture', () => {
    const challenger = calibrationPacks.find((pack) => pack.id === 'challenger');
    if (!challenger) throw new Error('Missing challenger pack');
    const candidates = [
      { baseDemandRateMonthly: 0.026, pricingSensitivity: 65, discount: 0.015 },
      { baseDemandRateMonthly: 0.024, pricingSensitivity: 75, discount: 0.015 },
      { baseDemandRateMonthly: 0.022, pricingSensitivity: 85, discount: 0.016 },
      { baseDemandRateMonthly: 0.020, pricingSensitivity: 100, discount: 0.015 },
    ];
    const outputs = candidates.map((candidate) => {
      const config = overrideCorporate(baseConfig, candidate.baseDemandRateMonthly, candidate.pricingSensitivity);
      return {
        ...candidate,
        managedTenYear: run(config, initialState, 120, true, candidate.discount),
        passiveFiveYear: run(config, initialState, 60, false),
        challengerTwoYear: run(
          overrideCorporate(challenger.config, candidate.baseDemandRateMonthly, candidate.pricingSensitivity),
          challenger.initialState,
          24,
          false
        ),
      };
    });
    console.log('CORPORATE_CAPTURE_SWEEP_LOWER_BASE', JSON.stringify(outputs));
    outputs.forEach((output) => expect(output.managedTenYear.failureMonth).toBe(null));
  }, 120000);
});
