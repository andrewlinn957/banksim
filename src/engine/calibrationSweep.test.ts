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
const deposits = (state: BankState) =>
  balance(state, LiabilityProductType.RetailTransactionalDeposits) +
  balance(state, LiabilityProductType.RetailSavingsDeposits) +
  balance(state, LiabilityProductType.CorporateOperatingDeposits) +
  balance(state, LiabilityProductType.CorporateNonOperatingDeposits);
const buckets = (state: BankState) =>
  Object.values(state.loanCohorts ?? {}).reduce((sum, value) => sum + (value?.length ?? 0), 0) +
  Object.values(state.workoutPipelines ?? {}).reduce((sum, value) => sum + (value?.length ?? 0), 0);

const applyFlatDepositCalibration = (config: SimulationConfig) => {
  const tx = config.behaviour.depositByProduct![LiabilityProductType.RetailTransactionalDeposits]!;
  Object.assign(tx, { baselineGrowthMonthly: 0.002, baseChurnMonthly: 0.0035, policyRateBeta: 0.02, competitorSensitivity: 0.45 });
  const savings = config.behaviour.depositByProduct![LiabilityProductType.RetailSavingsDeposits]!;
  Object.assign(savings, { baselineGrowthMonthly: 0.0023, baseChurnMonthly: 0.002, policyRateBeta: 0, competitorSensitivity: 0.4 });
  const op = config.behaviour.depositByProduct![LiabilityProductType.CorporateOperatingDeposits]!;
  Object.assign(op, { baselineGrowthMonthly: 0.0015, baseChurnMonthly: 0.003, policyRateBeta: 0, competitorSensitivity: 0.75 });
  const nonOp = config.behaviour.depositByProduct![LiabilityProductType.CorporateNonOperatingDeposits]!;
  Object.assign(nonOp, { baselineGrowthMonthly: 0.001, baseChurnMonthly: 0.006, policyRateBeta: 0, competitorSensitivity: 0.8 });
};

const configureCoreCandidate = (config: SimulationConfig, fixedCost: number, corporateTermMonths: number, corporateDemand: number) => {
  applyFlatDepositCalibration(config);
  config.global.fixedOperatingCostPerMonth = fixedCost;
  config.behaviour.costModel!.fixedCostPerMonth = fixedCost;
  config.productParameters[AssetProductType.CorporateLoans].loan!.defaultTermMonths = corporateTermMonths;
  config.behaviour.loanPipelineByProduct![AssetProductType.Mortgages]!.baseDemandRateMonthly = 0.0105;
  config.behaviour.loanPipelineByProduct![AssetProductType.CorporateLoans]!.baseDemandRateMonthly = corporateDemand;
};

const variants: Array<{ name: string; configure: (config: SimulationConfig) => void }> = [
  { name: 'cost14-term84-corp17', configure: (config) => configureCoreCandidate(config, 0.014e9, 84, 0.017) },
  { name: 'cost14-term96-corp17', configure: (config) => configureCoreCandidate(config, 0.014e9, 96, 0.017) },
  { name: 'cost145-term84-corp18', configure: (config) => configureCoreCandidate(config, 0.0145e9, 84, 0.018) },
  { name: 'cost14-term84-corp19', configure: (config) => configureCoreCandidate(config, 0.014e9, 84, 0.019) },
];

const run = (config: SimulationConfig, months: number, managed: boolean) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(initialState);
  let failureMonth: number | null = null;
  let equityRaised = 0;
  for (let month = 1; month <= months; month++) {
    const actions: any[] = [];
    if (managed) {
      actions.push(
        { type: 'adjustRate', productType: AssetProductType.Mortgages, newRate: Math.max(0, state.market.competitorMortgageRate - 0.004) },
        { type: 'adjustRate', productType: AssetProductType.CorporateLoans, newRate: Math.max(0, state.market.riskFreeLong + state.market.corporateLoanSpread - 0.006) },
        { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: 0 },
        { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: 0 },
        { type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'auto' },
      );
      if (state.risk.riskMetrics.leverageRatio < 0.05 && equityRaised < 1.5e9) {
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
    const result = engine.step({ state, config, actions, shocks: [] });
    state = result.nextState;
    if (state.status.hasFailed && failureMonth === null) failureMonth = month;
    if (state.status.hasFailed) break;
  }
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

describe('temporary calibration sweep', () => {
  it('prints focused five and ten year candidate trajectories', () => {
    for (const variant of variants) {
      const config = structuredClone(baseConfig);
      variant.configure(config);
      console.log('CALIBRATION_SWEEP', JSON.stringify({
        variant: variant.name,
        fiveYear: run(config, 60, false),
        tenYear: run(config, 120, false),
        managedFiveYear: run(config, 60, true),
        managedTenYear: run(config, 120, true),
      }));
    }
  }, 120000);
});
