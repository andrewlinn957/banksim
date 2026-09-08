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

  it('defines live loan and customer-deposit behaviour in the catalogue', () => {
    expect(getProduct(AssetProductType.Mortgages).behaviour).toMatchObject({ isLoan: true, loanBenchmark: 'mortgage' });
    expect(getProduct(AssetProductType.ConsumerLoans).behaviour).toMatchObject({ isLoan: true, loanBenchmark: 'consumer' });
    expect(getProduct(AssetProductType.CorporateLoans).behaviour).toMatchObject({ isLoan: true, loanBenchmark: 'corporate' });

    expect(getProduct(LiabilityProductType.RetailCurrentAccounts).behaviour).toMatchObject({
      isCustomerDeposit: true,
      depositSegment: 'retail',
    });
    expect(getProduct(LiabilityProductType.RetailTermDeposits).behaviour).toMatchObject({
      isCustomerDeposit: true,
      depositSegment: 'retail',
      isTermDeposit: true,
    });
    expect(getProduct(LiabilityProductType.CorporateOperatingDeposits).behaviour).toMatchObject({
      isCustomerDeposit: true,
      depositSegment: 'corporate',
    });
  });

  it('does not retain deleted legacy products', () => {
    expect(Object.keys(PRODUCTS).filter(id => legacyProductIds.includes(id))).toEqual([]);
  });
});
