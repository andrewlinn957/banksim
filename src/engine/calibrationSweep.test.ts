import { describe, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { SimulationConfig } from '../domain/config';
import { BankState } from '../domain/bankState';
import { PlayerAction } from '../domain/actions';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const balance = (state: BankState, product: AssetProductType | LiabilityProductType) =>
  state.financial.balanceSheet.items.find((item) => item.productType === product)?.balance ?? 0;
const deposits = (state: BankState) =>
  balance(state, LiabilityProductType.RetailTransactionalDeposits) +
  balance(state, LiabilityProductType.RetailSavingsDeposits) +
  balance(state, LiabilityProductType.CorporateOperatingDeposits) +
  balance(state, LiabilityProductType.CorporateNonOperatingDeposits);
const buckets = (state: BankState) =>
  Object.values(state.loanCohorts ?? {}).reduce((sum, value) => sum + (value?.length ?? 0), 0) +
  Object.values(state.workoutPipelines ?? {}).reduce((sum, value) => sum + (value?.length ?? 0), 0);

const applyFlatDepositCalibration = (config: SimulationConfig) => {
  Object.assign(config.behaviour.depositByProduct![LiabilityProductType.RetailTransactionalDeposits]!, {
    baselineGrowthMonthly: 0.002,
    baseChurnMonthly: 0.0035,
    policyRateBeta: 0.02,
    competitorSensitivity: 0.45,
  });
  Object.assign(config.behaviour.depositByProduct![LiabilityProductType.RetailSavingsDeposits]!, {
    baselineGrowthMonthly: 0.0023,
    baseChurnMonthly: 0.002,
    policyRateBeta: 0,
    competitorSensitivity: 0.4,
  });
  Object.assign(config.behaviour.depositByProduct![LiabilityProductType.CorporateOperatingDeposits]!, {
    baselineGrowthMonthly: 0.0015,
    baseChurnMonthly: 0.003,
    policyRateBeta: 0,
    competitorSensitivity: 0.75,
  });
  Object.assign(config.behaviour.depositByProduct![LiabilityProductType.CorporateNonOperatingDeposits]!, {
    baselineGrowthMonthly: 0.001,
    baseChurnMonthly: 0.006,
    policyRateBeta: 0,
    competitorSensitivity: 0.8,
  });
};

const configureBalancedCandidate = (config: SimulationConfig) => {
  applyFlatDepositCalibration(config);
  config.global.fixedOperatingCostPerMonth = 0.014e9;
  config.behaviour.costModel!.fixedCostPerMonth = 0.014e9;
};

const summary = (state: BankState, failureMonth: number | null, equityRaised = 0) => {
  const mortgages = balance(state, AssetProductType.Mortgages) / 1e9;
  const corporate = balance(state, AssetProductType.CorporateLoans) / 1e9;
  return {
    failureMonth,
    mortgages,
    corporate,
    loans: mortgages + corporate,
    deposits: deposits(state) / 1e9,
    cash: balance(state, AssetProductType.CashReserves) / 1e9,
    cet1: state.risk.riskMetrics.cet1Ratio,
    leverage: state.risk.riskMetrics.leverageRatio,
    lcr: state.risk.riskMetrics.lcr,
    nsfr: state.risk.riskMetrics.nsfr,
    netIncome: state.financial.incomeStatement.netIncome / 1e6,
    equityRaised: equityRaised / 1e9,
    bucketCount: buckets(state),
  };
};

const run = (config: SimulationConfig, months: number, managed: boolean) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(initialState);
  let failureMonth: number | null = null;
  let equityRaised = 0;
  for (let month = 1; month <= months; month++) {
    const actions: PlayerAction[] = [];
    if (managed) {
      actions.push(
        { type: 'adjustRate', productType: AssetProductType.Mortgages, newRate: Math.max(0, state.market.competitorMortgageRate - 0.004) },
        { type: 'adjustRate', productType: AssetProductType.CorporateLoans, newRate: Math.max(0, state.market.riskFreeLong + state.market.corporateLoanSpread - 0.006) },
        { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: 0.15 },
        { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: 0.15 },
        { type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'auto' },
      );
      if (state.risk.riskMetrics.leverageRatio < 0.045 && equityRaised < 1e9) {
        actions.push({ type: 'issueEquity', amount: 0.25e9 });
        equityRaised += 0.25e9;
      }
      if (month % 12 === 1) {
        const cash = balance(state, AssetProductType.CashReserves);
        const depositOffset = cash < 1.5e9 ? 0.0025 : cash > 3.5e9 ? -0.0025 : 0;
        const retail = Math.max(0, state.market.competitorRetailDepositRate + depositOffset);
        const corporate = Math.max(0, (state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate) + depositOffset);
        actions.push(
          { type: 'adjustRate', productType: LiabilityProductType.RetailTransactionalDeposits, newRate: retail },
          { type: 'adjustRate', productType: LiabilityProductType.RetailSavingsDeposits, newRate: retail },
          { type: 'adjustRate', productType: LiabilityProductType.CorporateOperatingDeposits, newRate: corporate },
          { type: 'adjustRate', productType: LiabilityProductType.CorporateNonOperatingDeposits, newRate: corporate },
        );
      }
    }
    state = engine.step({ state, config, actions, shocks: [] }).nextState;
    if (state.status.hasFailed && failureMonth === null) failureMonth = month;
    if (state.status.hasFailed) break;
  }
  return summary(state, failureMonth, equityRaised);
};

const runControlProbe = (label: string, actionsForMonth: (state: BankState, month: number) => PlayerAction[]) => {
  const engine = createSimulationEngine();
  const config = structuredClone(baseConfig);
  configureBalancedCandidate(config);
  let state = cloneBankState(initialState);
  for (let month = 1; month <= 12 && !state.status.hasFailed; month++) {
    state = engine.step({ state, config, actions: actionsForMonth(state, month), shocks: [] }).nextState;
  }
  return { label, ...summary(state, state.status.hasFailed ? state.time.step : null) };
};

describe('temporary addressable-market calibration sweep', () => {
  it('prints base and balanced five/ten-year trajectories', () => {
    for (const [name, configure] of [
      ['base-addressable', (_config: SimulationConfig) => {}],
      ['balanced-addressable', configureBalancedCandidate],
    ] as const) {
      const config = structuredClone(baseConfig);
      configure(config);
      console.log('ADDRESSABLE_SWEEP', JSON.stringify({
        variant: name,
        fiveYear: run(config, 60, false),
        tenYear: run(config, 120, false),
        managedFiveYear: run(config, 60, true),
        managedTenYear: run(config, 120, true),
      }));
    }
  }, 120000);

  it('prints decision-surface probes for low-value controls', () => {
    const probes = [
      runControlProbe('capital-auto', () => [{ type: 'setCapitalPolicy', dividendPayoutRatio: 0.3, at1CouponMode: 'auto' }]),
      runControlProbe('capital-pay-at1', () => [{ type: 'setCapitalPolicy', dividendPayoutRatio: 0.3, at1CouponMode: 'pay' }]),
      runControlProbe('capital-skip-at1', () => [{ type: 'setCapitalPolicy', dividendPayoutRatio: 0.3, at1CouponMode: 'skip' }]),
      runControlProbe('one-term-debt-500m', (_state, month) => month === 1 ? [{ type: 'issueDebt', productType: LiabilityProductType.WholesaleFundingLT, amount: 0.5e9 }] : []),
      runControlProbe('one-equity-250m', (_state, month) => month === 1 ? [{ type: 'issueEquity', amount: 0.25e9 }] : []),
      runControlProbe('one-market-swap-1bn', (state, month) => month === 1 ? [{
        type: 'enterHedge',
        direction: state.risk.riskMetrics.niiSensitivity100bp > 0 ? 'receiveFixedPayFloat' : 'payFixedReceiveFloat',
        notional: 1e9,
        fixedRate: state.market.riskFreeShort,
        maturityMonths: 24,
      }] : []),
    ];
    console.log('CONTROL_PROBES', JSON.stringify(probes));
  }, 60000);
});
