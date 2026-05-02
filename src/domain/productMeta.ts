import { AssetProductType, BalanceSheetSide, LiabilityProductType, ProductType } from './enums';

export interface ProductBehaviourFlags {
  isCustomerDeposit?: boolean;
  depositSegment?: 'retail' | 'corporate';
  affectsBehaviouralDepositFlow?: boolean;
  isLoan?: boolean;
  loanBenchmark?: 'mortgage' | 'corporate';
  affectsBehaviouralLoanFlow?: boolean;
}

export interface ProductMetadata {
  productType: ProductType;
  label: string;
  side: BalanceSheetSide;
  behaviour: ProductBehaviourFlags;
}

export const PRODUCT_META: Record<ProductType, ProductMetadata> = {
  [AssetProductType.CashReserves]: {
    productType: AssetProductType.CashReserves,
    label: 'Cash & Reserves',
    side: BalanceSheetSide.Asset,
    behaviour: {},
  },
  [AssetProductType.Gilts]: {
    productType: AssetProductType.Gilts,
    label: 'Gilts',
    side: BalanceSheetSide.Asset,
    behaviour: {},
  },
  [AssetProductType.Mortgages]: {
    productType: AssetProductType.Mortgages,
    label: 'Retail mortgages',
    side: BalanceSheetSide.Asset,
    behaviour: { isLoan: true, affectsBehaviouralLoanFlow: true, loanBenchmark: 'mortgage' },
  },
  [AssetProductType.CorporateLoans]: {
    productType: AssetProductType.CorporateLoans,
    label: 'Corporate loans',
    side: BalanceSheetSide.Asset,
    behaviour: { isLoan: true, affectsBehaviouralLoanFlow: true, loanBenchmark: 'corporate' },
  },
  [AssetProductType.ReverseRepo]: {
    productType: AssetProductType.ReverseRepo,
    label: 'Reverse repo',
    side: BalanceSheetSide.Asset,
    behaviour: {},
  },
  [LiabilityProductType.RetailDeposits]: {
    productType: LiabilityProductType.RetailDeposits,
    label: 'Retail deposits (legacy aggregate)',
    side: BalanceSheetSide.Liability,
    behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: false },
  },
  [LiabilityProductType.CorporateDeposits]: {
    productType: LiabilityProductType.CorporateDeposits,
    label: 'Corporate deposits (legacy aggregate)',
    side: BalanceSheetSide.Liability,
    behaviour: { isCustomerDeposit: true, depositSegment: 'corporate', affectsBehaviouralDepositFlow: false },
  },
  [LiabilityProductType.RetailTransactionalDeposits]: {
    productType: LiabilityProductType.RetailTransactionalDeposits,
    label: 'Retail transactional deposits',
    side: BalanceSheetSide.Liability,
    behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: true },
  },
  [LiabilityProductType.RetailSavingsDeposits]: {
    productType: LiabilityProductType.RetailSavingsDeposits,
    label: 'Retail savings deposits',
    side: BalanceSheetSide.Liability,
    behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: true },
  },
  [LiabilityProductType.CorporateOperatingDeposits]: {
    productType: LiabilityProductType.CorporateOperatingDeposits,
    label: 'Corporate operating deposits',
    side: BalanceSheetSide.Liability,
    behaviour: { isCustomerDeposit: true, depositSegment: 'corporate', affectsBehaviouralDepositFlow: true },
  },
  [LiabilityProductType.CorporateNonOperatingDeposits]: {
    productType: LiabilityProductType.CorporateNonOperatingDeposits,
    label: 'Corporate non-operating deposits',
    side: BalanceSheetSide.Liability,
    behaviour: { isCustomerDeposit: true, depositSegment: 'corporate', affectsBehaviouralDepositFlow: true },
  },
  [LiabilityProductType.WholesaleFundingST]: {
    productType: LiabilityProductType.WholesaleFundingST,
    label: 'Wholesale funding ST',
    side: BalanceSheetSide.Liability,
    behaviour: {},
  },
  [LiabilityProductType.WholesaleFundingLT]: {
    productType: LiabilityProductType.WholesaleFundingLT,
    label: 'Wholesale funding LT',
    side: BalanceSheetSide.Liability,
    behaviour: {},
  },
  [LiabilityProductType.RepurchaseAgreements]: {
    productType: LiabilityProductType.RepurchaseAgreements,
    label: 'Repo borrowing',
    side: BalanceSheetSide.Liability,
    behaviour: {},
  },
};
