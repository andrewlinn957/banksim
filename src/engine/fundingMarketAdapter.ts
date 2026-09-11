import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import type { FundingMarketFundamentals } from '../domain/fundingMarket';
import { BalanceSheetSide, HQLALevel, type ProductType } from '../domain/enums';
import { hasCapability } from '../products/capabilities';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const safeRatio = (num: number, den: number): number => den > 1e-9 ? num / den : 0;

const totalAssets = (state: BankState): number => state.financial.balanceSheet.items
  .filter(item => item.side === BalanceSheetSide.Asset)
  .reduce((sum, item) => sum + Math.max(0, item.balance), 0);

const totalLiabilities = (state: BankState): number => state.financial.balanceSheet.items
  .filter(item => item.side === BalanceSheetSide.Liability)
  .reduce((sum, item) => sum + Math.max(0, item.balance), 0);

const isMarketFundingProduct = (productType: ProductType): boolean =>
  hasCapability(productType, 'wholesaleFunding') || hasCapability(productType, 'capitalMarketsFunding');

const wholesaleFundingBalance = (state: BankState): number => state.financial.balanceSheet.items
  .filter(item => item.side === BalanceSheetSide.Liability && isMarketFundingProduct(item.productType))
  .reduce((sum, item) => sum + Math.max(0, item.balance), 0);

const wholesaleFundingMaturingWithin12m = (state: BankState): number => {
  let total = 0;
  Object.entries(state.fundingLadders).forEach(([rawProductType, buckets]) => {
    const productType = rawProductType as ProductType;
    if (!isMarketFundingProduct(productType)) return;
    (buckets ?? []).forEach(bucket => {
      if (bucket.monthsToMaturity > 0 && bucket.monthsToMaturity <= 12) {
        total += Math.max(0, bucket.notional);
      }
    });
  });
  return total;
};

const loanStageShares = (state: BankState): { stage2Share: number; stage3Share: number } => {
  const cohorts = Object.values(state.loanCohorts).flatMap(value => value ?? []);
  const total = cohorts.reduce((sum, cohort) => sum + Math.max(0, cohort.outstandingPrincipal), 0);
  if (total <= 1e-9) return { stage2Share: 0, stage3Share: 0 };
  const stage2 = cohorts
    .filter(cohort => cohort.stage === 'stage2')
    .reduce((sum, cohort) => sum + Math.max(0, cohort.outstandingPrincipal), 0);
  const stage3 = cohorts
    .filter(cohort => cohort.stage === 'stage3')
    .reduce((sum, cohort) => sum + Math.max(0, cohort.outstandingPrincipal), 0);
  return { stage2Share: stage2 / total, stage3Share: stage3 / total };
};

const unencumberedLevel1 = (state: BankState): number => state.financial.balanceSheet.items
  .filter(item => item.side === BalanceSheetSide.Asset && item.liquidityTag.hqlaLevel === HQLALevel.Level1)
  .reduce(
    (sum, item) => sum + Math.max(0, item.balance - Math.max(0, item.encumbrance.encumberedAmount)),
    0
  );

export const buildFundingMarketFundamentals = (
  state: BankState,
  config: SimulationConfig
): FundingMarketFundamentals => {
  const assets = totalAssets(state);
  const liabilities = totalLiabilities(state);
  const stageShares = loanStageShares(state);
  const leverageThreshold =
    state.risk.riskMetrics.leverageApplicableThresholdRate ?? config.riskLimits.minLeverageRatio;
  const annualisedRoa = state.time.step > 0 && state.time.stepLengthMonths > 0
    ? safeRatio(
      state.financial.incomeStatement.netIncome * (12 / state.time.stepLengthMonths),
      assets
    )
    : undefined;

  return {
    cet1Headroom: state.risk.riskMetrics.cet1Headroom,
    leverageHeadroom: state.risk.riskMetrics.leverageRatio - leverageThreshold,
    lcr: state.risk.riskMetrics.lcr,
    nsfr: state.risk.riskMetrics.nsfr,
    wholesaleFundingRatio: safeRatio(wholesaleFundingBalance(state), liabilities),
    wholesaleFundingMaturing12mRatio: safeRatio(wholesaleFundingMaturingWithin12m(state), liabilities),
    depositFranchiseStrength: clamp(state.behaviour.depositFranchiseStrength, 0, 1),
    stage2Share: stageShares.stage2Share,
    stage3Share: stageShares.stage3Share,
    annualisedRoa,
    unencumberedLevel1Ratio: safeRatio(unencumberedLevel1(state), assets),
    marketSeniorSpreadBps: Math.max(0, state.market.seniorDebtSpread * 10000),
  };
};
