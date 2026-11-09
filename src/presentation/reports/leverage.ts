import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import { BalanceSheetSide, AssetProductType } from '../../domain/enums';
import { eligibleCet1, centralBankExclusion, committedExposure } from '../../engine/prudential';
import { hedgeExposures } from '../../engine/hedgeValuation';
import { calculateRiskMetrics } from '../../engine/metrics';

export function leverageDashboardData(state: BankState, config: SimulationConfig) {
  const assets = state.financial.balanceSheet.items.filter(i => i.side === BalanceSheetSide.Asset);
  const book = assets.reduce((n, i) => n + i.balance, 0);
  const derivativeBook = assets.find(i => i.productType === AssetProductType.DerivativeAssets)?.balance ?? 0;
  const derivatives = hedgeExposures(state).leverage;
  const reserves = centralBankExclusion(state);
  const commitments = committedExposure(state) * 0.2;
  const metrics = calculateRiskMetrics({ state, config });
  const exposure = metrics.leverageExposure;
  const cet1 = eligibleCet1(state, config);
  const at1 = state.financial.capital.at1;
  const tier1 = cet1 + at1;
  const inScope = metrics.leverageFrameworkInScope ?? false;
  const minimum = metrics.leverageBaseRate ?? config.riskLimits.minLeverageRatio;
  const minimumCet1 = minimum * (metrics.leverageMinimumCet1Share ?? 0.75);
  const minimumAt1Eligible = Math.max(0, minimum - minimumCet1);
  const cclb = metrics.leverageCclbRate ?? 0;
  const alrb = metrics.leverageAlrbRate ?? 0;
  const cclbIndicative = metrics.leverageCclbIndicativeRate ?? 0;
  const alrbIndicative = metrics.leverageAlrbIndicativeRate ?? 0;
  const indicativeThreshold = minimum + cclbIndicative + alrbIndicative;
  const threshold = metrics.leverageApplicableThresholdRate ?? minimum;
  const cet1Threshold = metrics.leverageCet1ThresholdRate ?? minimumCet1;
  const target = Math.max(threshold, state.behaviour.riskAppetite?.leverage ?? threshold * 1.05);
  const ratio = metrics.leverageRatio;
  const leverageCet1Ratio = metrics.leverageCet1Ratio ?? (exposure > 0 ? cet1 / exposure : NaN);
  const hardMinimumBreached = inScope && (ratio < minimum || leverageCet1Ratio < minimumCet1);
  const required = exposure * threshold;
  const baseRequired = exposure * minimum;
  const cet1Required = exposure * cet1Threshold;
  const targetRequired = exposure * target;
  const limit = threshold > 0 ? Math.max(0, tier1 / threshold) : NaN;
  const internalLimit = target > 0 ? Math.max(0, tier1 / target) : NaN;

  return {
    cet1,
    at1,
    tier1,
    exposure,
    minimum,
    minimumCet1,
    minimumAt1Eligible,
    threshold,
    indicativeThreshold,
    cet1Threshold,
    target,
    ratio,
    leverageCet1Ratio,
    hardMinimumBreached,
    required,
    baseRequired,
    cet1Required,
    targetRequired,
    surplus: tier1 - required,
    cet1Surplus: cet1 - cet1Required,
    limit,
    internalLimit,
    inScope,
    scopeRoute: metrics.leverageFrameworkScopeRoute ?? 'belowThresholds',
    expectationMissed: metrics.leverageExpectationMissed ?? false,
    bufferShortfall: metrics.leverageBufferShortfall ?? false,
    cclb,
    alrb,
    cclbIndicative,
    alrbIndicative,
    retailDeposits: metrics.leverageRetailDeposits ?? 0,
    averageRetailDeposits: metrics.leverageRetailDepositsThreeYearAverage ?? 0,
    nonUkAssets: metrics.leverageNonUkAssets ?? 0,
    averageNonUkAssets: metrics.leverageNonUkAssetsThreeYearAverage ?? 0,
    retailDepositsThreshold: metrics.leverageRetailDepositThreshold ?? 75e9,
    nonUkAssetsThreshold: metrics.leverageNonUkAssetThreshold ?? 10e9,
    nextAssessmentStep: metrics.leverageFrameworkNextAssessmentStep,
    exposureRows: [
      { label: 'On-balance-sheet assets', value: book },
      { label: 'Remove derivative book assets', value: -derivativeBook },
      { label: 'Add prudential derivative exposure', value: derivatives },
      { label: 'Eligible central bank reserves exclusion', value: -reserves },
      { label: 'Undrawn commitments × 20% CCF', value: commitments },
    ],
  };
}
