import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import { centralBankExclusion } from './prudential';
import { calculateRiskMetrics } from './metrics';

/**
 * Amount of additional borrowing the bank can take on while preserving its
 * internal leverage target on a gross exposure basis. Central bank reserves
 * can be excluded from the reported leverage measure, so include that amount
 * here when assessing a new debt funded asset expansion.
 */
export const debtFundingHeadroom = (state: BankState, config: SimulationConfig): number => {
  const metrics = calculateRiskMetrics({ state, config });
  const tier1 = metrics.capitalReconciliation?.tier1
    ?? state.financial.capital.cet1 + state.financial.capital.at1;
  const target = Math.max(
    0.01,
    config.riskLimits.minLeverageRatio,
    metrics.internalLeverageTargetRatio ?? 0,
  );
  const grossExposure = Math.max(0, metrics.leverageExposure + centralBankExclusion(state));
  return Math.max(0, tier1 / target - grossExposure);
};
