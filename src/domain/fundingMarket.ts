export type FundingMarketStatus = 'open' | 'open-expensive' | 'restricted' | 'closed';

export type FundingMarketDriverKey =
  | 'market'
  | 'capital'
  | 'liquidity'
  | 'fundingStructure'
  | 'assetQuality'
  | 'earnings'
  | 'recentIssuance'
  | 'instrument'
  | 'tenor';

/**
 * Observable issuer and market measures consumed by the funding-market engine.
 * These deliberately remain in their natural units rather than being collapsed
 * into a single confidence score.
 */
export interface FundingMarketFundamentals {
  cet1Headroom: number;
  leverageHeadroom: number;
  lcr: number;
  nsfr: number;
  wholesaleFundingRatio: number;
  wholesaleFundingMaturing12mRatio: number;
  depositFranchiseStrength: number;
  stage2Share: number;
  stage3Share: number;
  /** Annualised net income / total assets. Undefined until earnings have been observed. */
  annualisedRoa?: number;
  /** Unencumbered Level 1 HQLA / total assets. Retained for future secured-market modelling. */
  unencumberedLevel1Ratio: number;
  marketSeniorSpreadBps: number;
}

export interface FundingMarketInstrumentTerms {
  basePremiumBps: number;
  spreadSensitivity: number;
  baseCapacityMultiple: number;
  newIssueConcessionBps: number;
  demandSlopeBps: number;
  hardCapacityMultiple: number;
  tenorSpreadBpsPerYear: number;
  defaultTenorMonths?: number;
  permittedTenorMonths?: readonly number[];
}

export interface FundingMarketModel {
  referenceAmount: number;
  targetAmount: number;
  maxSpreadBps?: number;
  requestedTenorMonths?: number;
  recentIssuanceRatio: number;
  fundamentals: FundingMarketFundamentals;
  instrument: FundingMarketInstrumentTerms;
}

export interface FundingMarketDriverEffect {
  key: FundingMarketDriverKey;
  /** 0 means neutral-or-better; larger values represent increasing stress. */
  severity: number;
  /** Contribution to the quoted spread, in basis points. */
  spreadBps: number;
  /** Standalone multiplier applied to fair-spread market capacity. */
  capacityMultiplier: number;
  /** Raw observable inputs used to calculate this driver. */
  observations: Record<string, number>;
}

export interface FundingMarketAssessment {
  status: FundingMarketStatus;
  fundamentals: FundingMarketFundamentals;
  drivers: FundingMarketDriverEffect[];
  /** Spread before paying up the investor demand curve for extra size. */
  fairSpreadBps: number;
  /** Spread required for the amount that can actually be executed. */
  clearingSpreadBps: number;
  /** Amount investors will absorb at fair spread. */
  capacityAtFairSpread: number;
  /** Maximum amount investors will absorb even if management pays up. */
  hardCapacity: number;
  /** Demand available at management's stated maximum spread, or hard capacity if no cap is set. */
  demandAtPrice: number;
  maxTenorMonths?: number;
  requestedTenorMonths?: number;
  tenorAvailable: boolean;
  /** Aggregate capacity multiplier, retained for diagnostics rather than user-facing scoring. */
  capacityMultiplier: number;
}
