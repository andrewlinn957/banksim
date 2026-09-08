import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { BalanceSheet } from '../domain/balanceSheet';
import { BalanceSheetSide, Currency, MaturityBucket } from '../domain/enums';
import { AssetProductType, LiabilityProductType } from './catalogue';
import { createPosition } from './factory';
import {
  assetPositions,
  findProductPosition,
  liabilityPositions,
  requireProductPosition,
} from './selectors';

describe('position factory', () => {
  it('derives product identity and config-backed metadata', () => {
    const mortgage = createPosition(baseConfig, {
      productType: AssetProductType.Mortgages,
      balance: 7e9,
      interestRate: 0.05,
      maturityBucket: MaturityBucket.GreaterThan5Y,
    });

    expect(mortgage).toMatchObject({
      side: BalanceSheetSide.Asset,
      productType: AssetProductType.Mortgages,
      label: 'Residential Mortgages',
      currency: Currency.GBP,
      balance: 7e9,
      interestRate: 0.05,
      maturityBucket: MaturityBucket.GreaterThan5Y,
      encumbrance: { encumberedAmount: 0 },
    });
    expect(mortgage.liquidityTag).toBe(baseConfig.liquidityTags[AssetProductType.Mortgages]);
    expect(mortgage.security).toBeUndefined();
  });

  it('derives securities accounting metadata from the active config', () => {
    const gilts = createPosition(baseConfig, {
      productType: AssetProductType.Gilts,
      balance: 2.5e9,
      interestRate: 0.041,
      maturityBucket: MaturityBucket.GreaterThan5Y,
      encumberedAmount: 0.2e9,
    });

    expect(gilts.label).toBe('Gilts / Liquidity Portfolio');
    expect(gilts.encumbrance.encumberedAmount).toBe(0.2e9);
    expect(gilts.security).toEqual({
      classification: 'FVOCI',
      effectiveDurationYears: 5.5,
      valuationReferenceYield: 0,
    });
  });

  it('uses the catalogue side and label for liabilities', () => {
    const deposit = createPosition(baseConfig, {
      productType: LiabilityProductType.RetailCurrentAccounts,
      balance: 7e9,
      interestRate: 0.017,
      maturityBucket: MaturityBucket.LessThan1Y,
    });

    expect(deposit.side).toBe(BalanceSheetSide.Liability);
    expect(deposit.label).toBe('Retail current accounts');
  });
});

describe('position selectors', () => {
  const balanceSheet: BalanceSheet = {
    items: [
      createPosition(baseConfig, {
        productType: AssetProductType.CashReserves,
        balance: 1,
        interestRate: 0,
        maturityBucket: MaturityBucket.Overnight,
      }),
      createPosition(baseConfig, {
        productType: LiabilityProductType.RetailCurrentAccounts,
        balance: 2,
        interestRate: 0,
        maturityBucket: MaturityBucket.LessThan1Y,
      }),
    ],
  };

  it('finds and requires positions by product', () => {
    expect(findProductPosition(balanceSheet, AssetProductType.CashReserves)?.balance).toBe(1);
    expect(requireProductPosition(balanceSheet, LiabilityProductType.RetailCurrentAccounts).balance).toBe(2);
    expect(() => requireProductPosition(balanceSheet, AssetProductType.Mortgages)).toThrow(
      'Missing balance-sheet line for Mortgages'
    );
  });

  it('selects positions by balance-sheet side', () => {
    expect(assetPositions(balanceSheet).map(item => item.productType)).toEqual([AssetProductType.CashReserves]);
    expect(liabilityPositions(balanceSheet).map(item => item.productType)).toEqual([
      LiabilityProductType.RetailCurrentAccounts,
    ]);
  });
});
