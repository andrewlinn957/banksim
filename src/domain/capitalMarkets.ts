export type CapitalMarketsInstrument = 'cet1' | 'at1' | 'tier2' | 'senior';
export type CapitalMarketsPricingKind = 'discount' | 'spread';
export type CapitalMarketsBookbuildStatus = 'filled' | 'partial' | 'failed-price' | 'failed-demand';

export interface CapitalMarketsOrder {
  instrument: CapitalMarketsInstrument;
  targetAmount: number;
  maxDiscount?: number;
  maxSpreadBps?: number;
  tenorMonths?: number;
}

export interface CapitalMarketsBookbuildResult {
  instrument: CapitalMarketsInstrument;
  pricingKind: CapitalMarketsPricingKind;
  status: CapitalMarketsBookbuildStatus;
  targetAmount: number;
  demandAmount: number;
  executedAmount: number;
  coverageRatio: number;
  tenorMonths?: number;
  marketReferenceRate?: number;
  clearingSpreadBps?: number;
  clearingDiscount?: number;
  issuePrice?: number;
  grossProceeds: number;
  fees: number;
  netProceeds: number;
  recentIssuanceRatio: number;
}

export interface CapitalMarketsTransactionRecord extends CapitalMarketsBookbuildResult {
  step: number;
  date: string;
}

export interface CapitalMarketsState {
  transactions: CapitalMarketsTransactionRecord[];
  /** Weighted coupon on outstanding AT1 issued through the market engine. */
  at1CouponRateAnnual?: number;
}
