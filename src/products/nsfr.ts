import { NsfrAsfRegulatoryClass, NsfrRsfRegulatoryClass, ProductType, PRODUCTS } from './catalogue';

export type NsfrMaturityBand = 'under6m' | 'sixTo12m' | 'oneYearPlus' | 'none';

export type NsfrAsfCategory = Exclude<NsfrAsfRegulatoryClass, 'none' | 'retail'> | 'stableRetail' | 'otherRetail';

export type NsfrRsfCategory =
  | Exclude<NsfrRsfRegulatoryClass, 'none' | 'mortgage' | 'otherLoan'>
  | 'mortgageShort'
  | 'mortgageLong'
  | 'otherLoanShort'
  | 'otherLoanLong'
  | 'nonPerforming'
  | 'undrawnCommitment'
  | 'encumberedSixTo12m'
  | 'encumberedOneYearPlus';

export interface NsfrCategoryDefinition {
  corep: string;
  label: string;
  group: string;
  factors: Record<NsfrMaturityBand, number>;
}

export const NSFR_ASF_CATEGORIES: Record<NsfrAsfCategory, NsfrCategoryDefinition> = {
  derivativeLiability: {
    corep: 'C81 2.7',
    label: 'Net derivative liabilities',
    group: 'Derivatives',
    factors: { under6m: 0, sixTo12m: 0, oneYearPlus: 0, none: 0 },
  },
  otherLiabilities: {
    corep: 'C81 2.9.4',
    label: 'Other liabilities',
    group: 'Other funding',
    factors: { under6m: 0, sixTo12m: 0.50, oneYearPlus: 1, none: 0 },
  },
  stableRetail: {
    corep: 'C81 2.2.1',
    label: 'Stable retail deposits',
    group: 'Stable retail deposits',
    factors: { under6m: 0.95, sixTo12m: 0.95, oneYearPlus: 1, none: 0.95 },
  },
  otherRetail: {
    corep: 'C81 2.2.2',
    label: 'Other retail deposits',
    group: 'Other retail deposits',
    factors: { under6m: 0.90, sixTo12m: 0.90, oneYearPlus: 1, none: 0.90 },
  },
  nonFinancialCorporate: {
    corep: 'C81 2.3.5',
    label: 'Liabilities provided by non-financial corporate customers',
    group: 'Non-financial corporate funding',
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 1, none: 0.50 },
  },
  centralBank: {
    corep: 'C81 2.5.1',
    label: 'Liabilities provided by the Bank of England / central bank',
    group: 'Central bank funding',
    factors: { under6m: 0, sixTo12m: 0.50, oneYearPlus: 1, none: 0 },
  },
  counterpartyUnknown: {
    corep: 'C81 2.6',
    label: 'Liabilities where the counterparty cannot be determined',
    group: 'Wholesale funding',
    factors: { under6m: 0, sixTo12m: 0.50, oneYearPlus: 1, none: 0 },
  },
  tier2Capital: {
    corep: 'C81 2.1.3',
    label: 'Tier 2 capital instruments',
    group: 'Eligible capital',
    factors: { under6m: 0, sixTo12m: 0, oneYearPlus: 1, none: 0 },
  },
};

export const NSFR_RSF_CATEGORIES: Record<NsfrRsfCategory, NsfrCategoryDefinition> = {
  centralBankReserve: {
    corep: 'C80 1.1.1.1',
    label: 'Cash, reserves and HQLA central bank exposures: unencumbered / <6m encumbrance',
    group: 'Cash & central bank',
    factors: { under6m: 0, sixTo12m: 0, oneYearPlus: 0, none: 0 },
  },
  level1Sovereign: {
    corep: 'C80 1.2.1.1',
    label: 'Level 1 assets eligible for 0% LCR haircut: unencumbered / <6m encumbrance',
    group: 'Level 1 securities',
    factors: { under6m: 0, sixTo12m: 0, oneYearPlus: 0, none: 0 },
  },
  mortgageShort: {
    corep: 'C80 1.4.5.1',
    label: 'Low-risk non-financial customer loans: <1y contractual amount',
    group: 'Residential mortgages',
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.50, none: 0.50 },
  },
  mortgageLong: {
    corep: 'C80 1.4.5.1',
    label: 'Low-risk non-financial customer loans: ≥1y contractual amount',
    group: 'Residential mortgages',
    factors: { under6m: 0.65, sixTo12m: 0.65, oneYearPlus: 0.65, none: 0.65 },
  },
  otherLoanShort: {
    corep: 'C80 1.4.6.1',
    label: 'Other loans to non-financial customers: <1y contractual amount',
    group: 'Other customer loans',
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.50, none: 0.50 },
  },
  otherLoanLong: {
    corep: 'C80 1.4.6.1',
    label: 'Other performing loans to non-financial customers: ≥1y contractual amount',
    group: 'Other customer loans',
    factors: { under6m: 0.85, sixTo12m: 0.85, oneYearPlus: 0.85, none: 0.85 },
  },
  nonPerforming: {
    corep: 'C80 1.9.3',
    label: 'Non-performing assets',
    group: 'Non-performing assets',
    factors: { under6m: 1, sixTo12m: 1, oneYearPlus: 1, none: 1 },
  },
  derivativeAsset: {
    corep: 'C80 1.7.2',
    label: 'NSFR derivative assets',
    group: 'Derivatives',
    factors: { under6m: 1, sixTo12m: 1, oneYearPlus: 1, none: 1 },
  },
  derivativeLiability: {
    corep: 'C80 1.7.1',
    label: 'Required stable funding for derivative liabilities',
    group: 'Derivatives',
    factors: { under6m: 0.05, sixTo12m: 0.05, oneYearPlus: 0.05, none: 0.05 },
  },
  undrawnCommitment: {
    corep: 'C80 1.10.2',
    label: 'Committed facilities',
    group: 'Undrawn commitments',
    factors: { under6m: 0.05, sixTo12m: 0.05, oneYearPlus: 0.05, none: 0.05 },
  },
  encumberedSixTo12m: {
    corep: 'C80 applicable *.2 encumbrance row',
    label: 'Encumbrance uplift for assets encumbered 6–12 months',
    group: 'Encumbrance uplift',
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.50, none: 0.50 },
  },
  encumberedOneYearPlus: {
    corep: 'C80 applicable *.3 / ≥1y encumbrance row',
    label: 'Encumbrance uplift for assets encumbered at least one year',
    group: 'Encumbrance uplift',
    factors: { under6m: 1, sixTo12m: 1, oneYearPlus: 1, none: 1 },
  },
};

export interface NsfrProductRule {
  asf?: 'retail' | NsfrAsfCategory;
  rsf?: 'mortgage' | 'otherLoan' | NsfrRsfCategory;
}

export const nsfrMaturityBand = (monthsToMaturity?: number | null): NsfrMaturityBand => {
  if (monthsToMaturity === undefined || monthsToMaturity === null) return 'none';
  if (monthsToMaturity < 6) return 'under6m';
  if (monthsToMaturity < 12) return 'sixTo12m';
  return 'oneYearPlus';
};

export const nsfrAsfFactor = (category: NsfrAsfCategory, monthsToMaturity?: number | null): number =>
  NSFR_ASF_CATEGORIES[category].factors[nsfrMaturityBand(monthsToMaturity)];

export const nsfrRsfFactor = (category: NsfrRsfCategory): number =>
  NSFR_RSF_CATEGORIES[category].factors.none;

export const getNsfrProductRule = (productType: ProductType): NsfrProductRule => {
  const regulatory = PRODUCTS[productType].regulatory;
  return {
    asf: regulatory.nsfrAsf === 'none' ? undefined : regulatory.nsfrAsf,
    rsf: regulatory.nsfrRsf === 'none' ? undefined : regulatory.nsfrRsf,
  };
};
