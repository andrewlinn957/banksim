export enum Currency {
  GBP = 'GBP',
}

export enum BalanceSheetSide {
  Asset = 'Asset',
  Liability = 'Liability',
}

export enum AssetProductType {
  CashReserves = 'CashReserves',
  Gilts = 'Gilts',
  Mortgages = 'Mortgages',
  CorporateLoans = 'CorporateLoans',
  ReverseRepo = 'ReverseRepo',
}

export enum LiabilityProductType {
  RetailDeposits = 'RetailDeposits',
  CorporateDeposits = 'CorporateDeposits',
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
