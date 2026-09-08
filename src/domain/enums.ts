export enum Currency {
  GBP = 'GBP',
}

export enum BalanceSheetSide {
  Asset = 'Asset',
  Liability = 'Liability',
}

export enum AssetProductType {
  DerivativeAssets = 'DerivativeAssets',
  CashReserves = 'CashReserves',
  Gilts = 'Gilts',
  Mortgages = 'Mortgages',
  ConsumerLoans = 'ConsumerLoans',
  CorporateLoans = 'CorporateLoans',
  // Legacy engine support. Generic reverse repo is no longer part of the default retail-bank balance sheet.
  ReverseRepo = 'ReverseRepo',
}

export enum LiabilityProductType {
  DerivativeLiabilities = 'DerivativeLiabilities',
  CreditProvisions = 'CreditProvisions',
  // Legacy aggregate categories (kept for backwards-compatibility with older states/tests).
  RetailDeposits = 'RetailDeposits',
  CorporateDeposits = 'CorporateDeposits',
  // Segmented customer deposits.
  RetailCurrentAccounts = 'RetailCurrentAccounts',
  RetailTermDeposits = 'RetailTermDeposits',
  CorporateOperatingDeposits = 'CorporateOperatingDeposits',
  CorporateNonOperatingDeposits = 'CorporateNonOperatingDeposits',
  WholesaleFundingST = 'WholesaleFundingST',
  WholesaleFundingLT = 'WholesaleFundingLT',
  BankOfEnglandFunding = 'BankOfEnglandFunding',
  Tier2Debt = 'Tier2Debt',
  // Legacy engine support. Generic market repo is no longer part of the default retail-bank balance sheet.
  RepurchaseAgreements = 'RepurchaseAgreements',
}

export type ProductType = AssetProductType | LiabilityProductType;

export enum MaturityBucket {
  Overnight = 'Overnight',
  LessThan1Y = 'LessThan1Y',
  OneToThreeY = 'OneToThreeY',
  ThreeToFiveY = 'ThreeToFiveY',
  GreaterThan5Y = 'GreaterThan5Y',
  Perpetual = 'Perpetual',
}

export enum HQLALevel {
  Level1 = 'Level1',
  Level2A = 'Level2A',
  Level2B = 'Level2B',
  None = 'None',
}
