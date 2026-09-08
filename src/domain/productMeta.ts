import { AssetProductType, BalanceSheetSide, LiabilityProductType, ProductType } from './enums';

export interface ProductBehaviourFlags {
  isCustomerDeposit?: boolean;
  depositSegment?: 'retail' | 'corporate';
  affectsBehaviouralDepositFlow?: boolean;
  isTermDeposit?: boolean;
  isLoan?: boolean;
  loanBenchmark?: 'mortgage' | 'consumer' | 'corporate';
  affectsBehaviouralLoanFlow?: boolean;
}

export interface ProductMetadata {
  productType: ProductType;
  label: string;
  side: BalanceSheetSide;
  behaviour: ProductBehaviourFlags;
}

export const PRODUCT_META: Record<ProductType, ProductMetadata> = {
  [AssetProductType.DerivativeAssets]: { productType: AssetProductType.DerivativeAssets, label: 'Derivative assets', side: BalanceSheetSide.Asset, behaviour: {} },
  [LiabilityProductType.DerivativeLiabilities]: { productType: LiabilityProductType.DerivativeLiabilities, label: 'Derivative liabilities', side: BalanceSheetSide.Liability, behaviour: {} },
  [LiabilityProductType.CreditProvisions]: { productType: LiabilityProductType.CreditProvisions, label: 'Undrawn credit provisions', side: BalanceSheetSide.Liability, behaviour: {} },
  [AssetProductType.CashReserves]: { productType: AssetProductType.CashReserves, label: 'Cash & reserves', side: BalanceSheetSide.Asset, behaviour: {} },
  [AssetProductType.Gilts]: { productType: AssetProductType.Gilts, label: 'Gilts / liquidity portfolio', side: BalanceSheetSide.Asset, behaviour: {} },
  [AssetProductType.Mortgages]: { productType: AssetProductType.Mortgages, label: 'Residential mortgages', side: BalanceSheetSide.Asset, behaviour: { isLoan: true, affectsBehaviouralLoanFlow: true, loanBenchmark: 'mortgage' } },
  [AssetProductType.ConsumerLoans]: { productType: AssetProductType.ConsumerLoans, label: 'Personal loans & revolving credit', side: BalanceSheetSide.Asset, behaviour: { isLoan: true, affectsBehaviouralLoanFlow: true, loanBenchmark: 'consumer' } },
  [AssetProductType.CorporateLoans]: { productType: AssetProductType.CorporateLoans, label: 'SME & business lending', side: BalanceSheetSide.Asset, behaviour: { isLoan: true, affectsBehaviouralLoanFlow: true, loanBenchmark: 'corporate' } },
  [AssetProductType.ReverseRepo]: { productType: AssetProductType.ReverseRepo, label: 'Reverse repo (legacy)', side: BalanceSheetSide.Asset, behaviour: {} },
  [LiabilityProductType.RetailDeposits]: { productType: LiabilityProductType.RetailDeposits, label: 'Retail deposits (legacy aggregate)', side: BalanceSheetSide.Liability, behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: false } },
  [LiabilityProductType.CorporateDeposits]: { productType: LiabilityProductType.CorporateDeposits, label: 'Business deposits (legacy aggregate)', side: BalanceSheetSide.Liability, behaviour: { isCustomerDeposit: true, depositSegment: 'corporate', affectsBehaviouralDepositFlow: false } },
  [LiabilityProductType.RetailTransactionalDeposits]: { productType: LiabilityProductType.RetailTransactionalDeposits, label: 'Retail current accounts', side: BalanceSheetSide.Liability, behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: true } },
  [LiabilityProductType.RetailSavingsDeposits]: { productType: LiabilityProductType.RetailSavingsDeposits, label: 'Instant retail', side: BalanceSheetSide.Liability, behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: true } },
  [LiabilityProductType.RetailTermDeposits]: { productType: LiabilityProductType.RetailTermDeposits, label: 'Fixed-term savings', side: BalanceSheetSide.Liability, behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: true, isTermDeposit: true } },
  [LiabilityProductType.CorporateOperatingDeposits]: { productType: LiabilityProductType.CorporateOperatingDeposits, label: 'SME/business operating deposits', side: BalanceSheetSide.Liability, behaviour: { isCustomerDeposit: true, depositSegment: 'corporate', affectsBehaviouralDepositFlow: true } },
  [LiabilityProductType.CorporateNonOperatingDeposits]: { productType: LiabilityProductType.CorporateNonOperatingDeposits, label: 'Other business deposits', side: BalanceSheetSide.Liability, behaviour: { isCustomerDeposit: true, depositSegment: 'corporate', affectsBehaviouralDepositFlow: true } },
  [LiabilityProductType.WholesaleFundingST]: { productType: LiabilityProductType.WholesaleFundingST, label: 'Short-term wholesale funding', side: BalanceSheetSide.Liability, behaviour: {} },
  [LiabilityProductType.WholesaleFundingLT]: { productType: LiabilityProductType.WholesaleFundingLT, label: 'Long-term debt', side: BalanceSheetSide.Liability, behaviour: {} },
  [LiabilityProductType.BankOfEnglandFunding]: { productType: LiabilityProductType.BankOfEnglandFunding, label: 'Bank of England secured funding', side: BalanceSheetSide.Liability, behaviour: {} },
  [LiabilityProductType.Tier2Debt]: { productType: LiabilityProductType.Tier2Debt, label: 'Tier 2 subordinated debt', side: BalanceSheetSide.Liability, behaviour: {} },
  [LiabilityProductType.RepurchaseAgreements]: { productType: LiabilityProductType.RepurchaseAgreements, label: 'Repo borrowing (legacy)', side: BalanceSheetSide.Liability, behaviour: {} },
};
