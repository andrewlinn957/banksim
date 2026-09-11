export type ProductSide = 'Asset' | 'Liability';

export type DepositSegment = 'retail' | 'corporate';
export type DepositBenchmark = 'retailCurrentAccount' | 'termDeposit' | 'corporateDeposit';
export type LoanBenchmark = 'mortgage' | 'consumer' | 'corporate';
export type WholesaleFundingTenorClass = 'short' | 'long';
export type TreasuryAssetRateSource = 'bankRate' | 'giltCurve';
export type CapitalMarketsFundingInstrument = 'tier2' | 'senior';

export type LiquidityRegulatoryClass =
  | 'derivativeAsset'
  | 'derivativeLiability'
  | 'creditProvision'
  | 'centralBankReserve'
  | 'level1Sovereign'
  | 'residentialMortgage'
  | 'consumerLoan'
  | 'corporateLoan'
  | 'retailSightDeposit'
  | 'retailTermDeposit'
  | 'corporateOperatingDeposit'
  | 'corporateNonOperatingDeposit'
  | 'wholesaleFundingShort'
  | 'wholesaleFundingLong'
  | 'centralBankSecuredFunding'
  | 'tier2Funding';

/**
 * NSFR classifications are independent of the broader liquidity class so a new
 * product can reuse an existing LCR treatment while declaring its own C80/C81
 * treatment. Factor schedules live in products/nsfr.ts.
 */
export type NsfrAsfRegulatoryClass =
  | 'none'
  | 'retail'
  | 'nonFinancialCorporate'
  | 'centralBank'
  | 'counterpartyUnknown'
  | 'tier2Capital'
  | 'derivativeLiability'
  | 'otherLiabilities';

export type NsfrRsfRegulatoryClass =
  | 'none'
  | 'centralBankReserve'
  | 'level1Sovereign'
  | 'mortgage'
  | 'otherLoan'
  | 'derivativeAsset'
  | 'derivativeLiability';

export type CreditRiskRegulatoryClass =
  | 'derivativeCounterparty'
  | 'centralBank'
  | 'sovereign'
  | 'residentialMortgage'
  | 'retailUnsecured'
  | 'corporate'
  | 'none';

export type CapitalRegulatoryClass = 'none' | 'tier2OwnFunds';
export type LeverageRegulatoryClass = 'standard' | 'derivativeAssetReplacement' | 'centralBankReserve';

export interface ProductRegulatoryClassification {
  liquidity: LiquidityRegulatoryClass;
  nsfrAsf: NsfrAsfRegulatoryClass;
  nsfrRsf: NsfrRsfRegulatoryClass;
  creditRisk: CreditRiskRegulatoryClass;
  capital: CapitalRegulatoryClass;
  leverage: LeverageRegulatoryClass;
}

export interface CustomerDepositCapability {
  segment: DepositSegment;
  benchmark: DepositBenchmark;
  behaviouralFlow?: boolean;
  termFunding?: boolean;
}

export interface LoanCapability {
  benchmark: LoanBenchmark;
  behaviouralFlow?: boolean;
  underwritingEditable?: boolean;
}

export interface WholesaleFundingCapability {
  tenorClass: WholesaleFundingTenorClass;
  issuable?: boolean;
}

/** Capital-market issuance metadata for funding products. Product identity and tenor eligibility live here. */
export interface CapitalMarketsFundingCapability {
  instrument: CapitalMarketsFundingInstrument;
  defaultTenorMonths: number;
  permittedTenorMonths: readonly number[];
}

/** Contractual/treasury behaviour authored once in the product catalogue. */
export interface TreasuryAssetCapability {
  tradable?: boolean;
  contractualMaturity?: boolean;
  settlementAsset?: boolean;
  rateSource?: TreasuryAssetRateSource;
  permittedTenorMonths?: readonly number[];
}

export interface ProductCapabilities {
  customerDeposit?: CustomerDepositCapability;
  loan?: LoanCapability;
  wholesaleFunding?: WholesaleFundingCapability;
  capitalMarketsFunding?: CapitalMarketsFundingCapability;
  treasuryAsset?: TreasuryAssetCapability;
}

/**
 * Temporary compatibility view for engine code that still reads the pre-PR3
 * behaviour flags. These values are derived from capabilities and are no
 * longer authored independently in product definitions.
 */
export interface ProductBehaviourFlags {
  isCustomerDeposit?: boolean;
  depositSegment?: DepositSegment;
  affectsBehaviouralDepositFlow?: boolean;
  isTermDeposit?: boolean;
  isLoan?: boolean;
  loanBenchmark?: LoanBenchmark;
  affectsBehaviouralLoanFlow?: boolean;
}

export interface ProductDefinitionInput<T extends string = string> {
  productType: T;
  label: string;
  side: ProductSide;
  capabilities: ProductCapabilities;
  regulatory: ProductRegulatoryClassification;
}

export interface ProductDefinition<T extends string = string> extends ProductDefinitionInput<T> {
  behaviour: ProductBehaviourFlags;
}

const deriveBehaviour = (capabilities: ProductCapabilities): ProductBehaviourFlags => ({
  isCustomerDeposit: capabilities.customerDeposit ? true : undefined,
  depositSegment: capabilities.customerDeposit?.segment,
  affectsBehaviouralDepositFlow: capabilities.customerDeposit?.behaviouralFlow,
  isTermDeposit: capabilities.customerDeposit?.termFunding,
  isLoan: capabilities.loan ? true : undefined,
  loanBenchmark: capabilities.loan?.benchmark,
  affectsBehaviouralLoanFlow: capabilities.loan?.behaviouralFlow,
});

const defineProducts = <const T extends Record<string, ProductDefinitionInput>>(products: T) =>
  Object.fromEntries(
    Object.entries(products).map(([key, product]) => [
      key,
      { ...product, behaviour: deriveBehaviour(product.capabilities) },
    ])
  ) as {
    readonly [K in keyof T]: T[K] & { readonly behaviour: ProductBehaviourFlags };
  };

export const ASSET_PRODUCTS = defineProducts({
  DerivativeAssets: {
    productType: 'DerivativeAssets',
    label: 'Derivative assets',
    side: 'Asset',
    capabilities: {},
    regulatory: {
      liquidity: 'derivativeAsset',
      nsfrAsf: 'none',
      nsfrRsf: 'derivativeAsset',
      creditRisk: 'derivativeCounterparty',
      capital: 'none',
      leverage: 'derivativeAssetReplacement',
    },
  },
  CashReserves: {
    productType: 'CashReserves',
    label: 'Cash & Reserves',
    side: 'Asset',
    capabilities: {
      treasuryAsset: { settlementAsset: true, rateSource: 'bankRate' },
    },
    regulatory: {
      liquidity: 'centralBankReserve',
      nsfrAsf: 'none',
      nsfrRsf: 'centralBankReserve',
      creditRisk: 'centralBank',
      capital: 'none',
      leverage: 'centralBankReserve',
    },
  },
  Gilts: {
    productType: 'Gilts',
    label: 'Gilts / Liquidity Portfolio',
    side: 'Asset',
    capabilities: {
      treasuryAsset: {
        tradable: true,
        contractualMaturity: true,
        rateSource: 'giltCurve',
        permittedTenorMonths: [24, 60, 120],
      },
    },
    regulatory: {
      liquidity: 'level1Sovereign',
      nsfrAsf: 'none',
      nsfrRsf: 'level1Sovereign',
      creditRisk: 'sovereign',
      capital: 'none',
      leverage: 'standard',
    },
  },
  Mortgages: {
    productType: 'Mortgages',
    label: 'Residential Mortgages',
    side: 'Asset',
    capabilities: {
      loan: {
        benchmark: 'mortgage',
        behaviouralFlow: true,
        underwritingEditable: true,
      },
    },
    regulatory: {
      liquidity: 'residentialMortgage',
      nsfrAsf: 'none',
      nsfrRsf: 'mortgage',
      creditRisk: 'residentialMortgage',
      capital: 'none',
      leverage: 'standard',
    },
  },
  ConsumerLoans: {
    productType: 'ConsumerLoans',
    label: 'Personal Loans & Revolving Credit',
    side: 'Asset',
    capabilities: {
      loan: {
        benchmark: 'consumer',
        behaviouralFlow: true,
        underwritingEditable: true,
      },
    },
    regulatory: {
      liquidity: 'consumerLoan',
      nsfrAsf: 'none',
      nsfrRsf: 'otherLoan',
      creditRisk: 'retailUnsecured',
      capital: 'none',
      leverage: 'standard',
    },
  },
  CorporateLoans: {
    productType: 'CorporateLoans',
    label: 'SME & Business Lending',
    side: 'Asset',
    capabilities: {
      loan: {
        benchmark: 'corporate',
        behaviouralFlow: true,
        underwritingEditable: true,
      },
    },
    regulatory: {
      liquidity: 'corporateLoan',
      nsfrAsf: 'none',
      nsfrRsf: 'otherLoan',
      creditRisk: 'corporate',
      capital: 'none',
      leverage: 'standard',
    },
  },
});

export const LIABILITY_PRODUCTS = defineProducts({
  DerivativeLiabilities: {
    productType: 'DerivativeLiabilities',
    label: 'Derivative liabilities',
    side: 'Liability',
    capabilities: {},
    regulatory: {
      liquidity: 'derivativeLiability',
      nsfrAsf: 'derivativeLiability',
      nsfrRsf: 'derivativeLiability',
      creditRisk: 'none',
      capital: 'none',
      leverage: 'standard',
    },
  },
  CreditProvisions: {
    productType: 'CreditProvisions',
    label: 'Undrawn credit provisions',
    side: 'Liability',
    capabilities: {},
    regulatory: {
      liquidity: 'creditProvision',
      nsfrAsf: 'otherLiabilities',
      nsfrRsf: 'none',
      creditRisk: 'none',
      capital: 'none',
      leverage: 'standard',
    },
  },
  RetailCurrentAccounts: {
    productType: 'RetailCurrentAccounts',
    label: 'Retail current accounts',
    side: 'Liability',
    capabilities: {
      customerDeposit: {
        segment: 'retail',
        benchmark: 'retailCurrentAccount',
        behaviouralFlow: true,
      },
    },
    regulatory: {
      liquidity: 'retailSightDeposit',
      nsfrAsf: 'retail',
      nsfrRsf: 'none',
      creditRisk: 'none',
      capital: 'none',
      leverage: 'standard',
    },
  },
  RetailTermDeposits: {
    productType: 'RetailTermDeposits',
    label: 'Fixed-Term Savings',
    side: 'Liability',
    capabilities: {
      customerDeposit: {
        segment: 'retail',
        benchmark: 'termDeposit',
        behaviouralFlow: true,
        termFunding: true,
      },
    },
    regulatory: {
      liquidity: 'retailTermDeposit',
      nsfrAsf: 'retail',
      nsfrRsf: 'none',
      creditRisk: 'none',
      capital: 'none',
      leverage: 'standard',
    },
  },
  CorporateOperatingDeposits: {
    productType: 'CorporateOperatingDeposits',
    label: 'SME / Business Operating Deposits',
    side: 'Liability',
    capabilities: {
      customerDeposit: {
        segment: 'corporate',
        benchmark: 'corporateDeposit',
        behaviouralFlow: true,
      },
    },
    regulatory: {
      liquidity: 'corporateOperatingDeposit',
      nsfrAsf: 'nonFinancialCorporate',
      nsfrRsf: 'none',
      creditRisk: 'none',
      capital: 'none',
      leverage: 'standard',
    },
  },
  CorporateNonOperatingDeposits: {
    productType: 'CorporateNonOperatingDeposits',
    label: 'Other Business Deposits',
    side: 'Liability',
    capabilities: {
      customerDeposit: {
        segment: 'corporate',
        benchmark: 'corporateDeposit',
        behaviouralFlow: true,
      },
    },
    regulatory: {
      liquidity: 'corporateNonOperatingDeposit',
      nsfrAsf: 'nonFinancialCorporate',
      nsfrRsf: 'none',
      creditRisk: 'none',
      capital: 'none',
      leverage: 'standard',
    },
  },
  WholesaleFundingST: {
    productType: 'WholesaleFundingST',
    label: 'Short-term wholesale funding',
    side: 'Liability',
    capabilities: {
      wholesaleFunding: {
        tenorClass: 'short',
        issuable: true,
      },
    },
    regulatory: {
      liquidity: 'wholesaleFundingShort',
      nsfrAsf: 'counterpartyUnknown',
      nsfrRsf: 'none',
      creditRisk: 'none',
      capital: 'none',
      leverage: 'standard',
    },
  },
  WholesaleFundingLT: {
    productType: 'WholesaleFundingLT',
    label: 'Long-Term Debt',
    side: 'Liability',
    capabilities: {
      wholesaleFunding: {
        tenorClass: 'long',
        issuable: true,
      },
      capitalMarketsFunding: {
        instrument: 'senior',
        defaultTenorMonths: 36,
        permittedTenorMonths: [24, 36, 60],
      },
    },
    regulatory: {
      liquidity: 'wholesaleFundingLong',
      nsfrAsf: 'counterpartyUnknown',
      nsfrRsf: 'none',
      creditRisk: 'none',
      capital: 'none',
      leverage: 'standard',
    },
  },
  BankOfEnglandFunding: {
    productType: 'BankOfEnglandFunding',
    label: 'Bank of England secured funding',
    side: 'Liability',
    capabilities: {},
    regulatory: {
      liquidity: 'centralBankSecuredFunding',
      nsfrAsf: 'centralBank',
      nsfrRsf: 'none',
      creditRisk: 'none',
      capital: 'none',
      leverage: 'standard',
    },
  },
  Tier2Debt: {
    productType: 'Tier2Debt',
    label: 'Tier 2 subordinated debt',
    side: 'Liability',
    capabilities: {
      capitalMarketsFunding: {
        instrument: 'tier2',
        defaultTenorMonths: 60,
        permittedTenorMonths: [60, 84, 120],
      },
    },
    regulatory: {
      liquidity: 'tier2Funding',
      nsfrAsf: 'tier2Capital',
      nsfrRsf: 'none',
      creditRisk: 'none',
      capital: 'tier2OwnFunds',
      leverage: 'standard',
    },
  },
});

type ProductTypeOf<T extends Record<string, ProductDefinition>> = T[keyof T]['productType'];

export type AssetProductType = ProductTypeOf<typeof ASSET_PRODUCTS>;
export type LiabilityProductType = ProductTypeOf<typeof LIABILITY_PRODUCTS>;
export type ProductType = AssetProductType | LiabilityProductType;

const productTypeConstants = <T extends Record<string, ProductDefinition>>(products: T) =>
  Object.fromEntries(Object.entries(products).map(([key, product]) => [key, product.productType])) as {
    readonly [K in keyof T]: T[K]['productType'];
  };

export const AssetProductType = productTypeConstants(ASSET_PRODUCTS);
export const LiabilityProductType = productTypeConstants(LIABILITY_PRODUCTS);

export const PRODUCTS: Record<ProductType, ProductDefinition> = {
  ...Object.fromEntries(Object.values(ASSET_PRODUCTS).map(product => [product.productType, product])),
  ...Object.fromEntries(Object.values(LIABILITY_PRODUCTS).map(product => [product.productType, product])),
} as Record<ProductType, ProductDefinition>;

export const getProduct = <T extends ProductType>(productType: T): ProductDefinition<T> =>
  PRODUCTS[productType] as ProductDefinition<T>;

export const assetProducts = (): ProductDefinition<AssetProductType>[] => Object.values(ASSET_PRODUCTS);
export const liabilityProducts = (): ProductDefinition<LiabilityProductType>[] => Object.values(LIABILITY_PRODUCTS);
