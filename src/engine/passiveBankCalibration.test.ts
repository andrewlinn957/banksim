import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, BalanceSheetSide, LiabilityProductType, ProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { commitmentLiquidity, prudentialLiquidityLines } from './prudential';
import { createSimulationEngine } from './simulation';

const balance = (state: typeof initialState, productType: ProductType): number =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType)?.balance ?? 0;

const totalLoans = (state: typeof initialState): number =>
  balance(state, AssetProductType.Mortgages) +
  balance(state, AssetProductType.ConsumerLoans) +
  balance(state, AssetProductType.CorporateLoans);

const totalDeposits = (state: typeof initialState): number =>
  balance(state, LiabilityProductType.RetailCurrentAccounts) +
  balance(state, LiabilityProductType.RetailTermDeposits) +
  balance(state, LiabilityProductType.CorporateOperatingDeposits) +
  balance(state, LiabilityProductType.CorporateNonOperatingDeposits);

const snapshot = (state: typeof initialState) => {
  const lines = prudentialLiquidityLines(state, baseConfig);
  const commitments = commitmentLiquidity(state);
  const grossOutflows = lines.reduce((sum, line) => sum + line.outflow, commitments.outflow);
  const inflows = lines.reduce((sum, line) => sum + line.inflow, 0);
  const netOutflows = grossOutflows - Math.min(inflows, grossOutflows * 0.75);
  const customerDepositAsf = lines
    .filter((line) =>
      [
        LiabilityProductType.RetailCurrentAccounts,
        LiabilityProductType.RetailTermDeposits,
        LiabilityProductType.CorporateOperatingDeposits,
        LiabilityProductType.CorporateNonOperatingDeposits,
      ].includes(line.productType as LiabilityProductType)
    )
    .reduce((sum, line) => sum + line.asf, 0);
  const wholesaleAsf = lines
    .filter((line) =>
      [LiabilityProductType.WholesaleFundingST, LiabilityProductType.WholesaleFundingLT].includes(
        line.productType as LiabilityProductType
      )
    )
    .reduce((sum, line) => sum + line.asf, 0);
  const loanRsf = lines
    .filter((line) =>
      [AssetProductType.Mortgages, AssetProductType.ConsumerLoans, AssetProductType.CorporateLoans].includes(
        line.productType as AssetProductType
      )
    )
    .reduce((sum, line) => sum + line.rsf, 0);
  const assets = state.financial.balanceSheet.items
    .filter((item) => item.side === BalanceSheetSide.Asset)
    .reduce((sum, item) => sum + Math.max(0, item.balance), 0);
  const cash = balance(state, AssetProductType.CashReserves);
  const gilts = balance(state, AssetProductType.Gilts);
  const loans = totalLoans(state);
  const deposits = totalDeposits(state);

  return {
    month: state.time.step,
    assets,
    mortgages: balance(state, AssetProductType.Mortgages),
    consumerLoans: balance(state, AssetProductType.ConsumerLoans),
    corporateLoans: balance(state, AssetProductType.CorporateLoans),
    loans,
    retailCurrent: balance(state, LiabilityProductType.RetailCurrentAccounts),
    retailTerm: balance(state, LiabilityProductType.RetailTermDeposits),
    corporateOperating: balance(state, LiabilityProductType.CorporateOperatingDeposits),
    corporateNonOperating: balance(state, LiabilityProductType.CorporateNonOperatingDeposits),
    deposits,
    wholesaleLt: balance(state, LiabilityProductType.WholesaleFundingLT),
    cash,
    gilts,
    liquidAssetShare: assets > 0 ? (cash + gilts) / assets : 0,
    loanDepositRatio: deposits > 0 ? loans / deposits : 0,
    cet1: state.financial.capital.cet1,
    cet1Ratio: state.risk.riskMetrics.cet1Ratio,
    leverageRatio: state.risk.riskMetrics.leverageRatio,
    hqla: state.risk.riskMetrics.hqla,
    grossOutflows,
    inflows,
    netOutflows,
    lcr: state.risk.riskMetrics.lcr,
    customerDepositAsf,
    wholesaleAsf,
    totalAsf: state.risk.riskMetrics.asf,
    loanRsf,
    totalRsf: state.risk.riskMetrics.rsf,
    nsfr: state.risk.riskMetrics.nsfr,
    netIncome: state.financial.incomeStatement.netIncome,
    franchise: state.behaviour.depositFranchiseStrength,
    fundingConfidence: state.risk.riskMetrics.fundingConfidenceScore,
  };
};

describe('Passive bank calibration diagnostics', () => {
  it('reports the unmanaged balance-sheet and liquidity path without player actions', () => {
    const engine = createSimulationEngine();
    let state = cloneBankState(initialState);
    const checkpoints = new Set([0, 12, 24, 36, 60, 120]);
    const results = [snapshot(state)];
    let hiddenTreasuryTrades = 0;

    for (let month = 1; month <= 120; month++) {
      const result = engine.step({ state, config: baseConfig, actions: [], shocks: [] });
      hiddenTreasuryTrades += result.events.filter((event) => /Bought Gilts|Sold Gilts/.test(event.message)).length;
      state = result.nextState;
      if (checkpoints.has(month)) results.push(snapshot(state));
      if (state.status.hasFailed) break;
    }

    console.log('PASSIVE_BANK_CALIBRATION=' + JSON.stringify(results));
    console.log('PASSIVE_HIDDEN_TREASURY_TRADES=' + hiddenTreasuryTrades);
    expect(state.status.hasFailed).toBe(false);
    expect(state.time.step).toBeGreaterThanOrEqual(120);
  });
});
