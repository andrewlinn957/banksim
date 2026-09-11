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
  otherLiabilities: {
    corep: 'C81 2.8',
    label: 'Other liabilities',
    group: 'Other funding',
    factors: { under6m: 0, sixTo12m: 0, oneYearPlus: 0, none: 0 },
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
    label: 'Non-financial corporate funding',
    group: 'Non-financial corporate funding',
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 1, none: 0.50 },
  },
  centralBank: {
    corep: 'C81 2.5.1',
    label: 'Funding from central banks',
    group: 'Central bank funding',
    factors: { under6m: 0, sixTo12m: 0.50, oneYearPlus: 1, none: 0 },
  },
  counterpartyUnknown: {
    corep: 'C81 2.6',
    label: 'Funding where counterparty cannot be determined',
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
    corep: 'C80 1.1.1',
    label: 'Cash and central bank reserves',
    group: 'Cash & central bank',
    factors: { under6m: 0, sixTo12m: 0, oneYearPlus: 0, none: 0 },
  },
  level1Sovereign: {
    corep: 'C80 1.2.1',
    label: 'Level 1 assets subject to a 0% LCR haircut',
    group: 'Level 1 securities',
    factors: { under6m: 0, sixTo12m: 0, oneYearPlus: 0, none: 0 },
  },
  mortgageShort: {
    corep: 'C80 1.4.5',
    label: 'Residential mortgage principal due within one year',
    group: 'Residential mortgages',
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.50, none: 0.50 },
  },
  mortgageLong: {
    corep: 'C80 1.4.5',
    label: 'Qualifying residential mortgages with residual maturity of at least one year',
    group: 'Residential mortgages',
    factors: { under6m: 0.65, sixTo12m: 0.65, oneYearPlus: 0.65, none: 0.65 },
  },
  otherLoanShort: {
    corep: 'C80 1.4.6',
    label: 'Other loans to non-financial customers due within one year',
    group: 'Other customer loans',
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.50, none: 0.50 },
  },
  otherLoanLong: {
    corep: 'C80 1.4.6',
    label: 'Other performing loans to non-financial customers with residual maturity of at least one year',
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
    label: 'RSF contribution from derivative liabilities',
    group: 'Derivatives',
    factors: { under6m: 0.05, sixTo12m: 0.05, oneYearPlus: 0.05, none: 0.05 },
  },
  undrawnCommitment: {
    corep: 'C80 1.10.2',
    label: 'Undrawn committed credit and liquidity facilities',
    group: 'Undrawn commitments',
    factors: { under6m: 0.05, sixTo12m: 0.05, oneYearPlus: 0.05, none: 0.05 },
  },
  encumberedSixTo12m: {
    corep: 'C80 encumbrance 6-12m',
    label: 'Assets encumbered for six months to less than one year',
    group: 'Encumbrance uplift',
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.50, none: 0.50 },
  },
  encumberedOneYearPlus: {
    corep: 'C80 encumbrance >=1y',
    label: 'Assets encumbered for at least one year',
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
