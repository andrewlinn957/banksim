import { AssetProductType as A, LiabilityProductType as L, ProductType } from './catalogue';

export type LcrInflowCapClass = '75' | '90' | 'exempt';
export type LcrHqlaLevel = 'level1' | 'level2a' | 'level2b';

export type LcrHqlaCategory = 'withdrawableCentralBankReserve' | 'centralGovernmentLevel1';
export type LcrOutflowCategory =
  | 'stableRetailDeposit'
  | 'otherRetailDeposit'
  | 'nonFinancialOperationalDeposit'
  | 'nonFinancialNonOperationalDeposit'
  | 'debtSecurity'
  | 'centralBankSecuredLevel1'
  | 'derivativeOutflow'
  | 'retailCreditFacility'
  | 'nonFinancialCorporateCreditFacility';
export type LcrInflowCategory =
  | 'loanInterest'
  | 'retailLoanPrincipal'
  | 'nonFinancialCorporateLoanPrincipal'
  | 'derivativeInflow';

export interface LcrCategoryDefinition {
  corep: string;
  label: string;
  factor: number;
}

export interface LcrHqlaDefinition extends LcrCategoryDefinition {
  level: LcrHqlaLevel;
}

export interface LcrInflowDefinition extends LcrCategoryDefinition {
  capClass: LcrInflowCapClass;
}

export const LCR_HQLA_CATEGORIES: Record<LcrHqlaCategory, LcrHqlaDefinition> = {
  withdrawableCentralBankReserve: {
    corep: 'C72 1.1.1.2',
    label: 'Withdrawable central bank reserves',
    factor: 1,
    level: 'level1',
  },
  centralGovernmentLevel1: {
    corep: 'C72 1.1.1.4',
    label: 'Central government assets',
    factor: 1,
    level: 'level1',
  },
};

export const LCR_OUTFLOW_CATEGORIES: Record<LcrOutflowCategory, LcrCategoryDefinition> = {
  stableRetailDeposit: {
    corep: 'C73 1.1.1.4',
    label: 'Stable retail deposits',
    factor: 0.05,
  },
  otherRetailDeposit: {
    corep: 'C73 1.1.1.7',
    label: 'Other retail deposits',
    factor: 0.10,
  },
  nonFinancialOperationalDeposit: {
    corep: 'C73 1.1.2.3',
    label: 'Operational deposits from non-financial customers',
    factor: 0.25,
  },
  nonFinancialNonOperationalDeposit: {
    corep: 'C73 1.1.4.3.2',
    label: 'Other non-financial customer deposits not covered by DGS',
    factor: 0.40,
  },
  debtSecurity: {
    corep: 'C73 1.1.8.2',
    label: 'Debt securities not treated as retail deposits',
    factor: 1,
  },
  centralBankSecuredLevel1: {
    corep: 'C73 1.2.1.1',
    label: 'Secured funding from central bank collateralised by Level 1 assets',
    factor: 0,
  },
  derivativeOutflow: {
    corep: 'C73 1.1.5.5',
    label: 'Outflows from derivatives',
    factor: 1,
  },
  retailCreditFacility: {
    corep: 'C73 1.1.6.1.1',
    label: 'Credit facilities to retail customers',
    factor: 0.05,
  },
  nonFinancialCorporateCreditFacility: {
    corep: 'C73 1.1.6.1.2',
    label: 'Credit facilities to non-financial customers other than retail',
    factor: 0.10,
  },
};

export const LCR_INFLOW_CATEGORIES: Record<LcrInflowCategory, LcrInflowDefinition> = {
  loanInterest: {
    corep: 'C74 1.1.1.1',
    label: 'Monies due from non-financial customers not corresponding to principal',
    factor: 1,
    capClass: '75',
  },
  retailLoanPrincipal: {
    corep: 'C74 1.1.1.2.1',
    label: 'Principal monies due from retail customers',
    factor: 0.50,
    capClass: '75',
  },
  nonFinancialCorporateLoanPrincipal: {
    corep: 'C74 1.1.1.2.2',
    label: 'Principal monies due from non-financial corporate customers',
    factor: 0.50,
    capClass: '75',
  },
  derivativeInflow: {
    corep: 'C74 1.1.9',
    label: 'Inflows from derivatives',
    factor: 1,
    capClass: '75',
  },
};

export interface LcrProductRule {
  hqla?: LcrHqlaCategory;
  outflow?: 'retailSight' | 'retailTerm' | LcrOutflowCategory;
  inflow?: 'retailLoan' | 'corporateLoan' | LcrInflowCategory;
  commitment?: LcrOutflowCategory;
}

/**
 * Product identity is mapped directly to COR011 treatment. This is deliberately
 * independent of the broader legacy liquidity class: a new catalogue product
 * must declare an explicit LCR mapping here and can reuse any LCR treatment.
 */
export const LCR_PRODUCT_RULES: Record<ProductType, LcrProductRule> = {
  [A.DerivativeAssets]: { inflow: 'derivativeInflow' },
  [A.CashReserves]: { hqla: 'withdrawableCentralBankReserve' },
  [A.Gilts]: { hqla: 'centralGovernmentLevel1' },
  [A.Mortgages]: { inflow: 'retailLoan', commitment: 'retailCreditFacility' },
  [A.ConsumerLoans]: { inflow: 'retailLoan', commitment: 'retailCreditFacility' },
  [A.CorporateLoans]: { inflow: 'corporateLoan', commitment: 'nonFinancialCorporateCreditFacility' },
  [L.DerivativeLiabilities]: { outflow: 'derivativeOutflow' },
  [L.CreditProvisions]: {},
  [L.RetailCurrentAccounts]: { outflow: 'retailSight' },
  [L.RetailTermDeposits]: { outflow: 'retailTerm' },
  [L.CorporateOperatingDeposits]: { outflow: 'nonFinancialOperationalDeposit' },
  [L.CorporateNonOperatingDeposits]: { outflow: 'nonFinancialNonOperationalDeposit' },
  [L.WholesaleFundingST]: { outflow: 'debtSecurity' },
  [L.WholesaleFundingLT]: { outflow: 'debtSecurity' },
  [L.BankOfEnglandFunding]: { outflow: 'centralBankSecuredLevel1' },
  [L.Tier2Debt]: { outflow: 'debtSecurity' },
};

export const getLcrProductRule = (productType: ProductType): LcrProductRule => LCR_PRODUCT_RULES[productType];
