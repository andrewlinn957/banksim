import {
  AssetProductType,
  ProductType,
} from './enums';
import type {
  LoanProductType,
  WholesaleFundingProductType,
} from '../products/capabilities';

export type WholesaleFundingProduct = WholesaleFundingProductType;

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

export interface IssueTier2Action {
  type: 'issueTier2';
  amount: number;
  maturityMonths?: number;
}

export interface DrawBoeFundingAction {
  type: 'drawBoeFunding';
  facility: 'STR' | 'ILTR';
  amount: number;
}

export interface SetUnderwritingAction {
  type: 'setUnderwriting';
  productType: LoanProductType;
  tightness: number; // 0 = loose baseline, 1 = very tight
}

export interface SetMortgagePolicyAction {
  type: 'setMortgagePolicy';
  maxLtv: number;
  fixedPeriodMonths: number;
}

export interface SetTreasuryPolicyAction {
  type: 'setTreasuryPolicy';
  giltShareOfHqla: number;
  giltDurationYears: number;
}

export interface SetTermDepositPolicyAction {
  type: 'setTermDepositPolicy';
  tenorMonths: number;
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
  | { type: 'setRiskAppetite'; targets: import('./bankState').BehaviouralState['riskAppetite'] | null }
  | AdjustRateAction
  | BuySellAssetAction
  | IssueDebtAction
  | IssueEquityAction
  | IssueTier2Action
  | DrawBoeFundingAction
  | SetUnderwritingAction
  | SetMortgagePolicyAction
  | SetTreasuryPolicyAction
  | SetTermDepositPolicyAction
  | EnterHedgeAction
  | SetCapitalPolicyAction;
