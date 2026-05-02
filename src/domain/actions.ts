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
  rate?: number;
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

export interface SetUnderwritingAction {
  type: 'setUnderwriting';
  productType: AssetProductType.Mortgages | AssetProductType.CorporateLoans;
  tightness: number; // 0 = loose baseline, 1 = very tight
}

export interface EnterHedgeAction {
  type: 'enterHedge';
  direction: 'payFixedReceiveFloat' | 'receiveFixedPayFloat';
  notional: number;
  fixedRate: number;
  maturityMonths?: number;
}

export interface SetCapitalPolicyAction {
  type: 'setCapitalPolicy';
  dividendPayoutRatio: number; // 0..1 payout of positive net income
  at1CouponMode?: 'auto' | 'pay' | 'skip';
}

export type PlayerAction =
  | AdjustRateAction
  | BuySellAssetAction
  | IssueDebtAction
  | IssueEquityAction
  | EnterRepoAction
  | SetUnderwritingAction
  | EnterHedgeAction
  | SetCapitalPolicyAction;
