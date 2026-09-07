import { describe, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { SimulationConfig } from '../domain/config';
import { BankState } from '../domain/bankState';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const balance = (state: BankState, product: AssetProductType | LiabilityProductType) =>
  state.financial.balanceSheet.items.find((item) => item.productType === product)?.balance ?? 0;
const loans = (state: BankState) => balance(state, AssetProductType.Mortgages) + balance(state, AssetProductType.CorporateLoans);
const deposits = (state: BankState) =>
  balance(state, LiabilityProductType.RetailTransactionalDeposits) +
  balance(state, LiabilityProductType.RetailSavingsDeposits) +
  balance(state, LiabilityProductType.CorporateOperatingDeposits) +
  balance(state, LiabilityProductType.CorporateNonOperatingDeposits);
const cash = (state: BankState) => balance(state, AssetProductType.CashReserves);
const buckets = (state: BankState) =>
  Object.values(state.loanCohorts ?? {}).reduce((sum, value) => sum + (value?.length ?? 0), 0) +
  Object.values(state.workoutPipelines ?? {}).reduce((sum, value) => sum + (value?.length ?? 0), 0);

const applyFlatDepositCalibration = (config: SimulationConfig) => {
  const tx = config.behaviour.depositByProduct![LiabilityProductType.RetailTransactionalDeposits]!;
  tx.baselineGrowthMonthly = 0.002;
  tx.baseChurnMonthly = 0.0035;
  tx.policyRateBeta = 0.02;
  tx.competitorSensitivity = 0.45;

  const savings = config.behaviour.depositByProduct![LiabilityProductType.RetailSavingsDeposits]!;
  savings.baselineGrowthMonthly = 0.0023;
  savings.baseChurnMonthly = 0.002;
  savings.policyRateBeta = 0;
  savings.competitorSensitivity = 0.4;

  const op = config.behaviour.depositByProduct![LiabilityProductType.CorporateOperatingDeposits]!;
  op.baselineGrowthMonthly = 0.0015;
  op.baseChurnMonthly = 0.003;
  op.policyRateBeta = 0;
  op.competitorSensitivity = 0.75;

  const nonOp = config.behaviour.depositByProduct![LiabilityProductType.CorporateNonOperatingDeposits]!;
  nonOp.baselineGrowthMonthly = 0.001;
  nonOp.baseChurnMonthly = 0.006;
  nonOp.policyRateBeta = 0;
  nonOp.competitorSensitivity = 0.8;
};

const variants: Array<{ name: string; configure: (config: SimulationConfig) => void }> = [
  { name: 'current', configure: () => {} },
  { name: 'flat-deposits', configure: applyFlatDepositCalibration },
  {
    name: 'flat-deposits-lower-origination',
    configure: (config) => {
      applyFlatDepositCalibration(config);
      config.behaviour.loanPipelineByProduct![AssetProductType.Mortgages]!.baseDemandRateMonthly = 0.009;
      config.behaviour.loanPipelineByProduct![AssetProductType.CorporateLoans]!.baseDemandRateMonthly = 0.014;
    },
  },
  {
    name: 'flat-deposits-longer-corporate',
    configure: (config) => {
      applyFlatDepositCalibration(config);
      config.behaviour.loanPipelineByProduct![AssetProductType.Mortgages]!.baseDemandRateMonthly = 0.0095;
      config.behaviour.loanPipelineByProduct![AssetProductType.CorporateLoans]!.baseDemandRateMonthly = 0.0135;
      config.productParameters[AssetProductType.CorporateLoans].loan!.defaultTermMonths = 84;
    },
  },
  {
    name: 'flat-deposits-lower-cost',
    configure: (config) => {
      applyFlatDepositCalibration(config);
      config.behaviour.loanPipelineByProduct![AssetProductType.Mortgages]!.baseDemandRateMonthly = 0.0095;
      config.behaviour.loanPipelineByProduct![AssetProductType.CorporateLoans]!.baseDemandRateMonthly = 0.0145;
      config.global.fixedOperatingCostPerMonth = 0.015e9;
      config.behaviour.costModel!.fixedCostPerMonth = 0.015e9;
    },
  },
];

const run = (config: SimulationConfig, months: number, managed: boolean) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(initialState);
  let failureMonth: number | null = null;
  for (let month = 1; month <= months; month++) {
    const actions: any[] = [];
    if (managed) {
      actions.push(
        {
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: Math.max(0, state.market.competitorMortgageRate - 0.005),
        },
        {
          type: 'adjustRate',
          productType: AssetProductType.CorporateLoans,
          newRate: Math.max(0, state.market.riskFreeLong + state.market.corporateLoanSpread - 0.0075),
        },
        { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: 0 },
        { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: 0 },
        { type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'auto' },
      );
      if (state.risk.riskMetrics.leverageRatio < 0.045) {
        actions.push({ type: 'issueEquity', amount: 0.2e9 });
      }
      if (month % 12 === 1) {
        actions.push(
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailTransactionalDeposits,
            newRate: Math.max(0, state.market.competitorRetailDepositRate - 0.0025),
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailSavingsDeposits,
            newRate: Math.max(0, state.market.competitorRetailDepositRate - 0.0025),
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateOperatingDeposits,
            newRate: Math.max(0, (state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate) - 0.0025),
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateNonOperatingDeposits,
            newRate: Math.max(0, (state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate) - 0.0025),
          },
        );
      }
    }
    const result = engine.step({ state, config, actions, shocks: [] });
    state = result.nextState;
    if (state.status.hasFailed && failureMonth === null) failureMonth = month;
    if (state.status.hasFailed) break;
  }
  return {
    failureMonth,
    loans: loans(state) / 1e9,
    deposits: deposits(state) / 1e9,
    cash: cash(state) / 1e9,
    cet1: state.risk.riskMetrics.cet1Ratio,
    leverage: state.risk.riskMetrics.leverageRatio,
    lcr: state.risk.riskMetrics.lcr,
    nsfr: state.risk.riskMetrics.nsfr,
    netIncome: state.financial.incomeStatement.netIncome / 1e6,
    bucketCount: buckets(state),
  };
};

describe('temporary calibration sweep', () => {
  it('prints five and ten year candidate trajectories', () => {
    for (const variant of variants) {
      const config = structuredClone(baseConfig);
      variant.configure(config);
      const fiveYear = run(config, 60, false);
      const tenYear = run(config, 120, false);
      const managedFiveYear = run(config, 60, true);
      const managedTenYear = run(config, 120, true);
      console.log('CALIBRATION_SWEEP', JSON.stringify({
        variant: variant.name,
        fiveYear,
        tenYear,
        managedFiveYear,
        managedTenYear,
      }));
    }
  }, 120000);
});
