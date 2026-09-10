import type { AssetProductType } from './enums';

export interface AssetTradeExecution {
  kind: 'assetTrade';
  productType: AssetProductType;
  side: 'buy' | 'sell';
  requestedAmount: number;
  executedAmount: number;
  tenorMonths?: number;
  executionRate?: number;
}

export interface StepExecutionResult {
  assetTrades: AssetTradeExecution[];
}

export const createEmptyStepExecutionResult = (): StepExecutionResult => ({ assetTrades: [] });
