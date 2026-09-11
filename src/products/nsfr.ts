import { NsfrAsfRegulatoryClass, NsfrRsfRegulatoryClass, ProductType, PRODUCTS } from './catalogue';

export type NsfrMaturityBand = 'under6m' | 'sixTo12m' | 'oneYearPlus' | 'none';

export type NsfrAsfCategory = Exclude<NsfrAsfRegulatoryClass, 'none' | 'retail'> | 'stableRetail' | 'otherRetail';

// C80 is two-dimensional for several asset classes: the row identifies the
// asset/encumbrance treatment while the maturity column determines the factor.
// Keep those dimensions separate rather than inventing pseudo-rows for short
// and long contractual amounts.
export type NsfrRsfCategory =
  | Exclude<NsfrRsfRegulatoryClass, 'none'>
  | 'nonPerforming'
  | 'undrawnCommitment';

export interface NsfrCorepReference {
  corep: string;
  label: string;
}

export interface NsfrCategoryDefinition extends NsfrCorepReference {
  group: string;
  factors: Record<NsfrMaturityBand, number>;
  parent?: NsfrCorepReference;
  ofWhich?: NsfrCorepReference;
}

export interface NsfrEncumbranceTreatment extends NsfrCorepReference {
  factors: Record<NsfrMaturityBand, number>;
}

export interface NsfrRsfCategoryDefinition extends NsfrCategoryDefinition {
  encumberedSixTo12m?: NsfrEncumbranceTreatment;
  encumberedOneYearPlus?: NsfrEncumbranceTreatment;
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

export const NSFR_RSF_CATEGORIES: Record<NsfrRsfCategory, NsfrRsfCategoryDefinition> = {
  centralBankReserve: {
    corep: 'C80 1.1.1.1',
    label: 'Unencumbered or encumbered for a residual maturity of less than six months',
    group: 'Cash & central bank',
    parent: { corep: 'C80 1.1.1', label: 'Cash, reserves and HQLA exposures to central banks' },
    factors: { under6m: 0, sixTo12m: 0, oneYearPlus: 0, none: 0 },
    encumberedSixTo12m: {
      corep: 'C80 1.1.1.2',
      label: 'Encumbered for a residual maturity of at least six months but less than one year',
      factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.50, none: 0.50 },
    },
    encumberedOneYearPlus: {
      corep: 'C80 1.1.1.3',
      label: 'Encumbered for a residual maturity of one year or more',
      factors: { under6m: 1, sixTo12m: 1, oneYearPlus: 1, none: 1 },
    },
  },
  level1Sovereign: {
    corep: 'C80 1.2.1.1',
    label: 'Unencumbered or encumbered for a residual maturity of less than six months',
    group: 'Level 1 securities',
    parent: { corep: 'C80 1.2.1', label: 'Level 1 assets eligible for 0% LCR haircut' },
    factors: { under6m: 0, sixTo12m: 0, oneYearPlus: 0, none: 0 },
    encumberedSixTo12m: {
      corep: 'C80 1.2.1.2',
      label: 'Encumbered for a residual maturity of at least six months but less than one year',
      factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.50, none: 0.50 },
    },
    encumberedOneYearPlus: {
      corep: 'C80 1.2.1.3',
      label: 'Encumbered for a residual maturity of one year or more',
      factors: { under6m: 1, sixTo12m: 1, oneYearPlus: 1, none: 1 },
    },
  },
  mortgage: {
    corep: 'C80 1.4.5.1',
    label: 'Unencumbered or encumbered for a residual maturity of less than six months',
    group: 'Residential mortgages',
    parent: {
      corep: 'C80 1.4.5',
      label: 'Loans to non-financial customers other than central banks assigned a risk weight of 35% or less',
    },
    ofWhich: { corep: 'C80 1.4.5.0.1', label: 'Of which, residential mortgages' },
    // C80 columns apply 50% below one year and 65% from one year for this row.
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.65, none: 0.65 },
    encumberedSixTo12m: {
      corep: 'C80 1.4.5.2',
      label: 'Encumbered for a residual maturity of at least six months but less than one year',
      factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.65, none: 0.65 },
    },
    encumberedOneYearPlus: {
      corep: 'C80 1.4.5.3',
      label: 'Encumbered for a residual maturity of one year or more',
      factors: { under6m: 1, sixTo12m: 1, oneYearPlus: 1, none: 1 },
    },
  },
  otherLoan: {
    corep: 'C80 1.4.6.1',
    label: 'Unencumbered or encumbered for a residual maturity of less than one year',
    group: 'Other customer loans',
    parent: {
      corep: 'C80 1.4.6',
      label: 'Other loans to non-financial customers other than central banks',
    },
    // C80 columns apply 50% below one year and 85% from one year for this row.
    factors: { under6m: 0.50, sixTo12m: 0.50, oneYearPlus: 0.85, none: 0.85 },
    // There is deliberately no separate 6–12m encumbrance row for 1.4.6:
    // row 1.4.6.1 already covers encumbrance of less than one year.
    encumberedOneYearPlus: {
      corep: 'C80 1.4.6.2',
      label: 'Encumbered for a residual maturity of one year or more',
      factors: { under6m: 1, sixTo12m: 1, oneYearPlus: 1, none: 1 },
    },
  },
  nonPerforming: {
    corep: 'C80 1.9.3',
    label: 'Non-performing assets',
    group: 'Non-performing assets',
    parent: { corep: 'C80 1.9', label: 'RSF from other assets' },
    factors: { under6m: 1, sixTo12m: 1, oneYearPlus: 1, none: 1 },
  },
  derivativeAsset: {
    corep: 'C80 1.7.2',
    label: 'NSFR derivative assets',
    group: 'Derivatives',
    parent: { corep: 'C80 1.7', label: 'RSF from derivatives' },
    factors: { under6m: 1, sixTo12m: 1, oneYearPlus: 1, none: 1 },
  },
  derivativeLiability: {
    corep: 'C80 1.7.1',
    label: 'Required stable funding for derivative liabilities',
    group: 'Derivatives',
    parent: { corep: 'C80 1.7', label: 'RSF from derivatives' },
    factors: { under6m: 0.05, sixTo12m: 0.05, oneYearPlus: 0.05, none: 0.05 },
  },
  undrawnCommitment: {
    corep: 'C80 1.10.2',
    label: 'Committed facilities',
    group: 'Undrawn commitments',
    parent: { corep: 'C80 1.10', label: 'RSF from OBS items' },
    factors: { under6m: 0.05, sixTo12m: 0.05, oneYearPlus: 0.05, none: 0.05 },
  },
};

export interface NsfrProductRule {
  asf?: 'retail' | NsfrAsfCategory;
  rsf?: Exclude<NsfrRsfRegulatoryClass, 'none'>;
}

export const nsfrMaturityBand = (monthsToMaturity?: number | null): NsfrMaturityBand => {
  if (monthsToMaturity === undefined || monthsToMaturity === null) return 'none';
  if (monthsToMaturity < 6) return 'under6m';
  if (monthsToMaturity < 12) return 'sixTo12m';
  return 'oneYearPlus';
};

export const nsfrAsfFactor = (category: NsfrAsfCategory, monthsToMaturity?: number | null): number =>
  NSFR_ASF_CATEGORIES[category].factors[nsfrMaturityBand(monthsToMaturity)];

export const nsfrRsfFactor = (
  category: NsfrRsfCategory,
  maturityBand: NsfrMaturityBand = 'none'
): number => NSFR_RSF_CATEGORIES[category].factors[maturityBand];

export const nsfrEncumbranceTreatment = (
  category: NsfrRsfCategory,
  months: number
): NsfrEncumbranceTreatment | undefined => {
  const definition = NSFR_RSF_CATEGORIES[category];
  if (months >= 12) return definition.encumberedOneYearPlus;
  if (months >= 6) return definition.encumberedSixTo12m;
  return undefined;
};

export const getNsfrProductRule = (productType: ProductType): NsfrProductRule => {
  const regulatory = PRODUCTS[productType].regulatory;
  return {
    asf: regulatory.nsfrAsf === 'none' ? undefined : regulatory.nsfrAsf,
    rsf: regulatory.nsfrRsf === 'none' ? undefined : regulatory.nsfrRsf,
  };
};
