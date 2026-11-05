import {
  AssetProductType,
  ProductType,
} from './enums';
import type { LoanProductType } from '../products/capabilities';
import type { CapitalMarketsInstrument } from './capitalMarkets';

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

export interface ModifyLoanCohortAction {
  type: 'modifyLoanCohort';
  productType: LoanProductType;
  cohortId: number;
  newCouponAnnual: number;
  newRemainingMonths: number;
  /** Derecognition is a separate IFRS 9 assessment and must be explicitly ruled out. */
  nonDerecognition: true;
  /** Fees received and qualifying incremental modification costs (capitalised). */
  feeReceived?: number;
  modificationCostPaid?: number;
}

export interface PurchasePociLoanAction {
  type: 'purchasePociLoan';
  assetId: string;
  productType: LoanProductType;
  contractualFaceValue: number;
  purchasePrice: number;
  /** Initially expected collectible cash flows, from the next monthly close. */
  expectedMonthlyCashFlows: number[];
}

export interface RevisePociLoanAction {
  type: 'revisePociLoan';
  assetId: string;
  revisedMonthlyCashFlows: number[];
}

export interface OriginateBorrowerLoanAction {
  type: 'originateBorrowerLoan';
  borrowerId: string;
  productType: LoanProductType;
  principal: number;
  annualInterestRate: number;
  annualPd: number;
  lgd: number;
  termMonths: number;
}
export interface SetBorrowerPaymentAction {
  type: 'setBorrowerPayment';
  borrowerId: string;
  /** Cash receipt in the coming simulation month, including arrears repayments. */
  nextPaymentAmount: number;
}

export interface DerecognizeLoanCohortAction {
  type: 'derecognizeLoanCohort';
  productType: LoanProductType;
  cohortId: number;
  /** Explicit legal determination under IFRS 9 3.2.3. */
  qualifyingEvent: 'rightsExpired' | 'qualifyingTransfer';
  /** Cash consideration received in exchange for removing the old asset. */
  cashConsideration: number;
  /** Transaction fees and costs included in disposal proceeds, not modification EIR. */
  feeReceived?: number;
  transactionCostPaid?: number;
}

export type PlayerAction =
  | { type: 'setRiskAppetite'; targets: import('./bankState').BehaviouralState['riskAppetite'] | null }
  | AdjustRateAction
  | BuySellAssetAction
  | LaunchCapitalMarketsTransactionAction
  | DrawBoeFundingAction
  | SetUnderwritingAction
  | SetMortgagePolicyAction
  | SetTermDepositPolicyAction
  | EnterHedgeAction
  | SetCapitalPolicyAction
  | ModifyLoanCohortAction
  | PurchasePociLoanAction
  | RevisePociLoanAction
  | OriginateBorrowerLoanAction
  | SetBorrowerPaymentAction
  | DerecognizeLoanCohortAction;
