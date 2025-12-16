import {
  AssetProductType,
  LiabilityProductType,
  ProductType,
} from './enums';

export type WholesaleFundingProduct =
  | LiabilityProductType.WholesaleFundingST
  | LiabilityProductType.WholesaleFundingLT;

export interface AdjustRateAction {
  type: 'adjustRate';
  productType: ProductType;
  newRate: number;
}

export interface BuySellAssetAction {
  type: 'buySellAsset';
  productType: AssetProductType;
  amountDelta: number; // positive = buy/increase, negative = sell/decrease
  rate?: number;
}

export interface IssueDebtAction {
  type: 'issueDebt';
  productType: WholesaleFundingProduct;
  amount: number;
  rate: number;
  maturityMonths?: number;
}

export interface IssueEquityAction {
  type: 'issueEquity';
  amount: number;
}

export interface EnterRepoAction {
  type: 'enterRepo';
  direction: 'borrow' | 'lend';
  collateralProduct: AssetProductType;
  amount: number;
  rate: number;
  haircut?: number;
  maturityMonths?: number;
}

export type PlayerAction =
  | AdjustRateAction
  | BuySellAssetAction
  | IssueDebtAction
  | IssueEquityAction
  | EnterRepoAction;
