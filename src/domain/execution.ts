import type { AssetProductType } from './enums';
import type { CapitalMarketsBookbuildResult } from './capitalMarkets';

export interface AssetTradeExecution {
  kind: 'assetTrade';
  productType: AssetProductType;
  side: 'buy' | 'sell';
  requestedAmount: number;
  executedAmount: number;
  tenorMonths?: number;
  executionRate?: number;
}

export interface CapitalMarketsExecution extends CapitalMarketsBookbuildResult {
  kind: 'capitalMarkets';
}

export interface StepExecutionResult {
  assetTrades: AssetTradeExecution[];
  capitalMarkets: CapitalMarketsExecution[];
}

export const createEmptyStepExecutionResult = (): StepExecutionResult => ({ assetTrades: [], capitalMarkets: [] });
