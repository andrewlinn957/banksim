import {
  AssetProductType,
  ProductType,
} from './enums';
import type {
  LoanProductType,
  WholesaleFundingProductType,
} from '../products/capabilities';
import type { CapitalMarketsInstrument } from './capitalMarkets';

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
  /** Optional contractual tenor for securities/other term assets. */
  tenorMonths?: number;
  /** @deprecated Replay compatibility; new callers should use tenorMonths. */
  maturityYears?: number;
}

/** @deprecated Replay compatibility; live management uses launchCapitalMarketsTransaction. */
export interface IssueDebtAction {
  type: 'issueDebt';
  productType: WholesaleFundingProduct;
  amount: number;
  rate?: number;
  maturityMonths?: number;
}

/** @deprecated Replay compatibility; live management uses launchCapitalMarketsTransaction. */
export interface IssueEquityAction {
  type: 'issueEquity';
  amount: number;
}

/** @deprecated Replay compatibility; live management uses launchCapitalMarketsTransaction. */
export interface IssueTier2Action {
  type: 'issueTier2';
  amount: number;
  maturityMonths?: number;
}

export interface LaunchCapitalMarketsTransactionAction {
  type: 'launchCapitalMarketsTransaction';
  instrument: CapitalMarketsInstrument;
  targetAmount: number;
  maxDiscount?: number;
  maxSpreadBps?: number;
  tenorMonths?: number;
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

/** @deprecated Legacy replay action. Live management uses explicit asset trades. */
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
  | LaunchCapitalMarketsTransactionAction
  | DrawBoeFundingAction
  | SetUnderwritingAction
  | SetMortgagePolicyAction
  | SetTreasuryPolicyAction
  | SetTermDepositPolicyAction
  | EnterHedgeAction
  | SetCapitalPolicyAction;
