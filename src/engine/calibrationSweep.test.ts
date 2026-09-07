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

const applyFlatDeposits = (config: SimulationConfig, tighter = false) => {
  Object.assign(config.behaviour.depositByProduct![LiabilityProductType.RetailTransactionalDeposits]!, {
    baselineGrowthMonthly: 0.002, baseChurnMonthly: tighter ? 0.004 : 0.0035, policyRateBeta: 0.02, competitorSensitivity: 0.45,
  });
  Object.assign(config.behaviour.depositByProduct![LiabilityProductType.RetailSavingsDeposits]!, {
    baselineGrowthMonthly: tighter ? 0.002 : 0.0023, baseChurnMonthly: 0.002, policyRateBeta: 0, competitorSensitivity: 0.4,
  });
  Object.assign(config.behaviour.depositByProduct![LiabilityProductType.CorporateOperatingDeposits]!, {
    baselineGrowthMonthly: tighter ? 0.0012 : 0.0015, baseChurnMonthly: 0.003, policyRateBeta: 0, competitorSensitivity: 0.75,
  });
  Object.assign(config.behaviour.depositByProduct![LiabilityProductType.CorporateNonOperatingDeposits]!, {
    baselineGrowthMonthly: 0.001, baseChurnMonthly: tighter ? 0.007 : 0.006, policyRateBeta: 0, competitorSensitivity: 0.8,
  });
};

const configure = (config: SimulationConfig, mortgageShare: number, corporateShare: number, fixedCost = 0.014e9, tighterDeposits = false) => {
  applyFlatDeposits(config, tighterDeposits);
  config.global.fixedOperatingCostPerMonth = fixedCost;
  config.behaviour.costModel!.fixedCostPerMonth = fixedCost;
  config.behaviour.loanPipelineByProduct![AssetProductType.Mortgages]!.referenceBankShare = mortgageShare;
  config.behaviour.loanPipelineByProduct![AssetProductType.CorporateLoans]!.referenceBankShare = corporateShare;
};

const summary = (state: BankState, failureMonth: number | null, equityRaised = 0) => ({
  failureMonth,
  mortgages: balance(state, AssetProductType.Mortgages) / 1e9,
  corporate: balance(state, AssetProductType.CorporateLoans) / 1e9,
  deposits: deposits(state) / 1e9,
  cash: balance(state, AssetProductType.CashReserves) / 1e9,
  cet1: state.risk.riskMetrics.cet1Ratio,
  leverage: state.risk.riskMetrics.leverageRatio,
  lcr: state.risk.riskMetrics.lcr,
  nsfr: state.risk.riskMetrics.nsfr,
  netIncome: state.financial.incomeStatement.netIncome / 1e6,
  equityRaised: equityRaised / 1e9,
});

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
    }
    state = engine.step({ state, config, actions, shocks: [] }).nextState;
    if (state.status.hasFailed && failureMonth === null) failureMonth = month;
    if (state.status.hasFailed) break;
  }
  return summary(state, failureMonth, equityRaised);
};

const variants = [
  ['s0303-c0086', 0.00303, 0.0086, 0.014e9, false],
  ['s0035-c012', 0.0035, 0.012, 0.014e9, false],
  ['s0040-c014', 0.0040, 0.014, 0.014e9, false],
  ['s0035-c012-cost13', 0.0035, 0.012, 0.013e9, false],
  ['s0035-c012-tightdep', 0.0035, 0.012, 0.014e9, true],
] as const;

describe('temporary addressable market share sweep', () => {
  it('prints five-year passive and ten-year managed trajectories', () => {
    for (const [name, mortgageShare, corporateShare, cost, tighter] of variants) {
      const config = structuredClone(baseConfig);
      configure(config, mortgageShare, corporateShare, cost, tighter);
      console.log('MARKET_SHARE_SWEEP', JSON.stringify({
        variant: name,
        passiveFiveYear: run(config, 60, false),
        managedTenYear: run(config, 120, true),
      }));
    }
  }, 120000);
});
