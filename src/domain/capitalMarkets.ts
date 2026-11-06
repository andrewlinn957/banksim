import type { FundingMarketAssessment } from './fundingMarket';

export type CapitalMarketsInstrument = 'cet1' | 'at1' | 'tier2' | 'senior';
export type CapitalMarketsPricingKind = 'discount' | 'spread';
export type CapitalMarketsBookbuildStatus = 'filled' | 'partial' | 'failed-price' | 'failed-demand';

/** Consecutive fully paid months required to restore AT1 market access after a coupon suspension. */
export const AT1_COUPON_ISSUANCE_REENTRY_MONTHS = 12;

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
  /** Explains why no new AT1 demand is available, when issuance is suspended. */
  marketAccessBlockReason?: string;
  /** Estimated post-issue ROE at the requested size, assuming proceeds earn the current reserve rate. */
  equityPostIssueRoe?: number;
  /** Estimated annual dividend per share at the requested size and permitted payout ratio. */
  equityPostIssueDps?: number;
  /** Estimated total-return proxy: dividend yield plus retained-earnings growth. */
  equityExpectedReturn?: number;
  /** Cost-of-equity hurdle used to assess investor returns. */
  equityCostOfEquity?: number;
  /** Share of base investor capacity supported by the projected investor return. */
  equityReturnDemandFactor?: number;
  /**
   * Backend-only diagnostic output from the fundamentals-driven funding-market engine.
   * No current UI consumes this object; it is retained so future UX can choose how much
   * of the underlying mechanism to expose without recalculating it.
   */
  fundingMarketAssessment?: FundingMarketAssessment;
}

export interface CapitalMarketsTransactionRecord extends CapitalMarketsBookbuildResult {
  step: number;
  date: string;
}

export interface CapitalMarketsState {
  transactions: CapitalMarketsTransactionRecord[];
  /** Weighted coupon on outstanding AT1 issued through the market engine. */
  at1CouponRateAnnual?: number;
  /** Consecutive months in which an outstanding AT1 coupon was skipped or underpaid. */
  at1CouponSkipStreakMonths?: number;
  /** Full-payment months still required before fresh AT1 can be issued again. */
  at1CouponIssuanceLockoutMonthsRemaining?: number;
}
