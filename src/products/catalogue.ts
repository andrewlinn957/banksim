export type ProductSide = 'Asset' | 'Liability';

export type DepositSegment = 'retail' | 'corporate';
export type DepositBenchmark = 'retailCurrentAccount' | 'termDeposit' | 'corporateDeposit';
export type LoanBenchmark = 'mortgage' | 'consumer' | 'corporate';
export type WholesaleFundingTenorClass = 'short' | 'long';

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

export interface ProductCapabilities {
  customerDeposit?: CustomerDepositCapability;
  loan?: LoanCapability;
  wholesaleFunding?: WholesaleFundingCapability;
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
  },
  CashReserves: {
    productType: 'CashReserves',
    label: 'Cash & Reserves',
    side: 'Asset',
    capabilities: {},
  },
  Gilts: {
    productType: 'Gilts',
    label: 'Gilts / Liquidity Portfolio',
    side: 'Asset',
    capabilities: {},
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
  },
});

export const LIABILITY_PRODUCTS = defineProducts({
  DerivativeLiabilities: {
    productType: 'DerivativeLiabilities',
    label: 'Derivative liabilities',
    side: 'Liability',
    capabilities: {},
  },
  CreditProvisions: {
    productType: 'CreditProvisions',
    label: 'Undrawn credit provisions',
    side: 'Liability',
    capabilities: {},
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
    },
  },
  BankOfEnglandFunding: {
    productType: 'BankOfEnglandFunding',
    label: 'Bank of England secured funding',
    side: 'Liability',
    capabilities: {},
  },
  Tier2Debt: {
    productType: 'Tier2Debt',
    label: 'Tier 2 subordinated debt',
    side: 'Liability',
    capabilities: {},
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
