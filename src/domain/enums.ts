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
  CorporateLoans = 'CorporateLoans',
  ReverseRepo = 'ReverseRepo',
}

export enum LiabilityProductType {
  DerivativeLiabilities = 'DerivativeLiabilities',
  CreditProvisions = 'CreditProvisions',
  // Legacy aggregate categories (kept for backwards-compatibility with older states/tests).
  RetailDeposits = 'RetailDeposits',
  CorporateDeposits = 'CorporateDeposits',
  // Segmented customer deposits.
  RetailTransactionalDeposits = 'RetailTransactionalDeposits',
  RetailSavingsDeposits = 'RetailSavingsDeposits',
  CorporateOperatingDeposits = 'CorporateOperatingDeposits',
  CorporateNonOperatingDeposits = 'CorporateNonOperatingDeposits',
  WholesaleFundingST = 'WholesaleFundingST',
  WholesaleFundingLT = 'WholesaleFundingLT',
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
