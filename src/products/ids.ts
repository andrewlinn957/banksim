export const AssetProductType = {
  DerivativeAssets: 'DerivativeAssets',
  CashReserves: 'CashReserves',
  Gilts: 'Gilts',
  Mortgages: 'Mortgages',
  ConsumerLoans: 'ConsumerLoans',
  CorporateLoans: 'CorporateLoans',
} as const;

export type AssetProductType = (typeof AssetProductType)[keyof typeof AssetProductType];

export const LiabilityProductType = {
  DerivativeLiabilities: 'DerivativeLiabilities',
  CreditProvisions: 'CreditProvisions',
  RetailCurrentAccounts: 'RetailCurrentAccounts',
  RetailTermDeposits: 'RetailTermDeposits',
  CorporateOperatingDeposits: 'CorporateOperatingDeposits',
  CorporateNonOperatingDeposits: 'CorporateNonOperatingDeposits',
  WholesaleFundingST: 'WholesaleFundingST',
  WholesaleFundingLT: 'WholesaleFundingLT',
  BankOfEnglandFunding: 'BankOfEnglandFunding',
  Tier2Debt: 'Tier2Debt',
} as const;

export type LiabilityProductType = (typeof LiabilityProductType)[keyof typeof LiabilityProductType];

export type ProductType = AssetProductType | LiabilityProductType;
