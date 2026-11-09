import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import type { ActionFormState } from '../application/playerControls';
import { AssetProductType } from '../domain/enums';
import { parseMoneyInput } from '../utils/parsers';
import { centralBankExclusion } from '../engine/prudential';
import { calculateRiskMetrics } from '../engine/metrics';

export interface TreasuryTransactionLimits {
  unencumberedGilts: number;
  maxGiltSaleAmount: number;
  maxBoeFundingAmount: number;
}

const debtFundingHeadroom = (state: BankState, config: SimulationConfig): number => {
  const metrics = calculateRiskMetrics({ state, config });
  const tier1 = metrics.capitalReconciliation?.tier1 ?? state.financial.capital.cet1 + state.financial.capital.at1;
  const target = Math.max(0.01, config.riskLimits.minLeverageRatio, metrics.internalLeverageTargetRatio ?? 0);
  const grossExposure = Math.max(0, metrics.leverageExposure + centralBankExclusion(state));
  return Math.max(0, tier1 / target - grossExposure);
};

/** Dynamic gilt-sale and secured-funding limits used by both React and the player API. */
export const buildTreasuryTransactionLimits = (
  state: BankState,
  config: SimulationConfig,
  form: ActionFormState,
): TreasuryTransactionLimits => {
  const gilts = state.financial.balanceSheet.items.find((item) => item.productType === AssetProductType.Gilts);
  const unencumberedGilts = Math.max(0, (gilts?.balance ?? 0) - (gilts?.encumbrance?.encumberedAmount ?? 0));
  const queuedGiltSale = form.giltTradeDirection === 'sell'
    ? Math.max(0, parseMoneyInput(form.giltTradeAmount).value ?? 0)
    : 0;
  const giltsAfterQueuedSale = Math.max(0, unencumberedGilts - Math.min(unencumberedGilts, queuedGiltSale));
  const haircut = Math.min(0.25, Math.max(config.behaviour.boeFunding?.levelAHaircut ?? 0.03, state.market.giltRepoHaircut));
  return {
    unencumberedGilts,
    maxGiltSaleAmount: unencumberedGilts,
    maxBoeFundingAmount: Math.min(
      giltsAfterQueuedSale * (1 - haircut),
      debtFundingHeadroom(state, config),
    ),
  };
};
