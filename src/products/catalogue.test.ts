import { describe, expect, it } from 'vitest';
import { BalanceSheetSide } from '../domain/enums';
import {
  ASSET_PRODUCTS,
  LIABILITY_PRODUCTS,
  PRODUCTS,
  AssetProductType,
  LiabilityProductType,
  assetProducts,
  getProduct,
  liabilityProducts,
} from './catalogue';

const legacyProductIds = [
  'ReverseRepo',
  'RepurchaseAgreements',
  'RetailDeposits',
  'CorporateDeposits',
];

describe('product catalogue', () => {
  it('is the authoritative source for runtime product identifiers', () => {
    expect(AssetProductType).toEqual(
      Object.fromEntries(Object.entries(ASSET_PRODUCTS).map(([key, product]) => [key, product.productType]))
    );
    expect(LiabilityProductType).toEqual(
      Object.fromEntries(Object.entries(LIABILITY_PRODUCTS).map(([key, product]) => [key, product.productType]))
    );

    const productIds = [...assetProducts(), ...liabilityProducts()].map(product => product.productType);
    expect(Object.keys(PRODUCTS).sort()).toEqual([...productIds].sort());
    expect(new Set(productIds).size).toBe(productIds.length);
  });

  it('keeps asset and liability definitions on the correct balance-sheet side', () => {
    expect(assetProducts().every(product => product.side === BalanceSheetSide.Asset)).toBe(true);
    expect(liabilityProducts().every(product => product.side === BalanceSheetSide.Liability)).toBe(true);
  });

  it('defines loans through the loan capability', () => {
    expect(getProduct(AssetProductType.Mortgages).capabilities.loan).toEqual({
      benchmark: 'mortgage',
      behaviouralFlow: true,
      underwritingEditable: true,
    });
    expect(getProduct(AssetProductType.ConsumerLoans).capabilities.loan).toEqual({
      benchmark: 'consumer',
      behaviouralFlow: true,
      underwritingEditable: true,
    });
    expect(getProduct(AssetProductType.CorporateLoans).capabilities.loan).toEqual({
      benchmark: 'corporate',
      behaviouralFlow: true,
      underwritingEditable: true,
    });
  });

  it('defines customer deposits through the customer-deposit capability', () => {
    expect(getProduct(LiabilityProductType.RetailCurrentAccounts).capabilities.customerDeposit).toEqual({
      segment: 'retail',
      benchmark: 'retailCurrentAccount',
      behaviouralFlow: true,
    });
    expect(getProduct(LiabilityProductType.RetailTermDeposits).capabilities.customerDeposit).toEqual({
      segment: 'retail',
      benchmark: 'termDeposit',
      behaviouralFlow: true,
      termFunding: true,
    });
    expect(getProduct(LiabilityProductType.CorporateOperatingDeposits).capabilities.customerDeposit).toEqual({
      segment: 'corporate',
      benchmark: 'corporateDeposit',
      behaviouralFlow: true,
    });
  });

  it('derives the legacy engine behaviour view from capabilities', () => {
    expect(getProduct(AssetProductType.Mortgages).behaviour).toMatchObject({
      isLoan: true,
      loanBenchmark: 'mortgage',
      affectsBehaviouralLoanFlow: true,
    });
    expect(getProduct(LiabilityProductType.RetailTermDeposits).behaviour).toMatchObject({
      isCustomerDeposit: true,
      depositSegment: 'retail',
      affectsBehaviouralDepositFlow: true,
      isTermDeposit: true,
    });
  });

  it('defines issuable wholesale debt through a funding capability', () => {
    expect(getProduct(LiabilityProductType.WholesaleFundingST).capabilities.wholesaleFunding).toEqual({
      tenorClass: 'short',
      issuable: true,
    });
    expect(getProduct(LiabilityProductType.WholesaleFundingLT).capabilities.wholesaleFunding).toEqual({
      tenorClass: 'long',
      issuable: true,
    });
  });

  it('does not retain deleted legacy products', () => {
    expect(Object.keys(PRODUCTS).filter(id => legacyProductIds.includes(id))).toEqual([]);
  });
});
