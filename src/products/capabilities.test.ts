import { describe, expect, it } from 'vitest';
import { AssetProductType, LiabilityProductType } from './catalogue';
import {
  getCapability,
  hasCapability,
  productTypesWithCapability,
} from './capabilities';

describe('product capabilities', () => {
  it('selects all loan products from the catalogue', () => {
    expect(productTypesWithCapability('loan').sort()).toEqual(
      [
        AssetProductType.Mortgages,
        AssetProductType.ConsumerLoans,
        AssetProductType.CorporateLoans,
      ].sort()
    );
  });

  it('selects all customer deposit products from the catalogue', () => {
    expect(productTypesWithCapability('customerDeposit').sort()).toEqual(
      [
        LiabilityProductType.RetailCurrentAccounts,
        LiabilityProductType.RetailTermDeposits,
        LiabilityProductType.CorporateOperatingDeposits,
        LiabilityProductType.CorporateNonOperatingDeposits,
      ].sort()
    );
  });

  it('selects issuable wholesale funding products from the catalogue', () => {
    expect(productTypesWithCapability('wholesaleFunding').sort()).toEqual(
      [LiabilityProductType.WholesaleFundingST, LiabilityProductType.WholesaleFundingLT].sort()
    );
  });

  it('selects product-backed capital-market instruments from capabilities', () => {
    expect(productTypesWithCapability('capitalMarketsFunding').sort()).toEqual(
      [LiabilityProductType.WholesaleFundingLT, LiabilityProductType.Tier2Debt].sort()
    );
    expect(getCapability(LiabilityProductType.WholesaleFundingLT, 'capitalMarketsFunding')).toEqual({
      instrument: 'senior',
      defaultTenorMonths: 36,
      permittedTenorMonths: [24, 36, 60],
    });
    expect(getCapability(LiabilityProductType.Tier2Debt, 'capitalMarketsFunding')).toEqual({
      instrument: 'tier2',
      defaultTenorMonths: 60,
      permittedTenorMonths: [60, 84, 120],
    });
  });

  it('returns capability data without product-name branching', () => {
    expect(getCapability(AssetProductType.ConsumerLoans, 'loan')).toMatchObject({
      benchmark: 'consumer',
      behaviouralFlow: true,
      underwritingEditable: true,
    });
    expect(getCapability(LiabilityProductType.RetailTermDeposits, 'customerDeposit')).toMatchObject({
      benchmark: 'termDeposit',
      termFunding: true,
    });
    expect(hasCapability(AssetProductType.Gilts, 'loan')).toBe(false);
  });
});
