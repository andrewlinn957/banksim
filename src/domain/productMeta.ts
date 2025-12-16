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
    label: 'Retail deposits',
    side: BalanceSheetSide.Liability,
    behaviour: { isCustomerDeposit: true, depositSegment: 'retail', affectsBehaviouralDepositFlow: true },
  },
  [LiabilityProductType.CorporateDeposits]: {
    productType: LiabilityProductType.CorporateDeposits,
    label: 'Corporate deposits',
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
