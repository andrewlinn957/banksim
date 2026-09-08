export type ProductSide = 'Asset' | 'Liability';

export interface ProductBehaviourFlags {
  isCustomerDeposit?: boolean;
  depositSegment?: 'retail' | 'corporate';
  affectsBehaviouralDepositFlow?: boolean;
  isTermDeposit?: boolean;
  isLoan?: boolean;
  loanBenchmark?: 'mortgage' | 'consumer' | 'corporate';
  affectsBehaviouralLoanFlow?: boolean;
}

export interface ProductDefinition<T extends string = string> {
  productType: T;
  label: string;
  side: ProductSide;
  behaviour: ProductBehaviourFlags;
}

const defineProducts = <const T extends Record<string, ProductDefinition>>(products: T): T => products;

export const ASSET_PRODUCTS = defineProducts({
  DerivativeAssets: { productType: 'DerivativeAssets', label: 'Derivative assets', side: 'Asset', behaviour: {} },
  CashReserves: { productType: 'CashReserves', label: 'Cash & Reserves', side: 'Asset', behaviour: {} },
  Gilts: { productType: 'Gilts', label: 'Gilts / Liquidity Portfolio', side: 'Asset', behaviour: {} },
  Mortgages: { productType: 'Mortgages', label: 'Residential Mortgages', side: 'Asset', behaviour: { isLoan: true, affectsBehaviouralLoanFlow: true, loanBenchmark: 'mortgage' } },
  ConsumerLoans: { productType: 'ConsumerLoans', label: 'Personal Loans & Revolving Credit', side: 'Asset', behaviour: { isLoan: true, affectsBehaviouralLoanFlow: true, loanBenchmark: 'consumer' } },
  CorporateLoans: { productType: 'CorporateLoans', label: 'SME & Business Lending', side: 'Asset', behaviour: { isLoan: true, affectsBehaviouralLoanFlow: true, loanBenchmark: 'corporate' } },
});

export const LIABILITY_PRODUCTS = defineProducts({
  DerivativeLiabilities: { productType: 'DerivativeLiabilities', label: 'Derivative liabilities', side: 'Liability', behaviour: {} },
  CreditProvisions: { productType: 'CreditProvisions', label: 'Undrawn credit provisions', side: 'Liability', behaviour: {} },
  RetailCurrentAccounts: { productType: 'RetailCurrentAccounts', label: 'Retail current accounts', side: 'Liability', behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: true } },
  RetailTermDeposits: { productType: 'RetailTermDeposits', label: 'Fixed-Term Savings', side: 'Liability', behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: true, isTermDeposit: true } },
  CorporateOperatingDeposits: { productType: 'CorporateOperatingDeposits', label: 'SME / Business Operating Deposits', side: 'Liability', behaviour: { isCustomerDeposit: true, depositSegment: 'corporate', affectsBehaviouralDepositFlow: true } },
  CorporateNonOperatingDeposits: { productType: 'CorporateNonOperatingDeposits', label: 'Other Business Deposits', side: 'Liability', behaviour: { isCustomerDeposit: true, depositSegment: 'corporate', affectsBehaviouralDepositFlow: true } },
  WholesaleFundingST: { productType: 'WholesaleFundingST', label: 'Short-term wholesale funding', side: 'Liability', behaviour: {} },
  WholesaleFundingLT: { productType: 'WholesaleFundingLT', label: 'Long-Term Debt', side: 'Liability', behaviour: {} },
  BankOfEnglandFunding: { productType: 'BankOfEnglandFunding', label: 'Bank of England secured funding', side: 'Liability', behaviour: {} },
  Tier2Debt: { productType: 'Tier2Debt', label: 'Tier 2 subordinated debt', side: 'Liability', behaviour: {} },
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
