import { describe, expect, it } from 'vitest';
import type { FundingMarketModel } from '../domain/fundingMarket';
import { calculateFundingMarket } from './fundingMarket';

const neutralModel = (): FundingMarketModel => ({
  referenceAmount: 10e9,
  targetAmount: 500e6,
  requestedTenorMonths: 36,
  recentIssuanceRatio: 0,
  fundamentals: {
    cet1Headroom: 0.025,
    leverageHeadroom: 0.0125,
    lcr: 1.25,
    nsfr: 1.08,
    wholesaleFundingRatio: 0.20,
    wholesaleFundingMaturing12mRatio: 0.08,
    depositFranchiseStrength: 0.70,
    stage2Share: 0.12,
    stage3Share: 0.025,
    annualisedRoa: 0.005,
    unencumberedLevel1Ratio: 0.10,
    marketSeniorSpreadBps: 140,
  },
  instrument: {
    basePremiumBps: 0,
    spreadSensitivity: 1,
    baseCapacityMultiple: 0.08,
    newIssueConcessionBps: 10,
    demandSlopeBps: 75,
    hardCapacityMultiple: 2.5,
    tenorSpreadBpsPerYear: 4,
    defaultTenorMonths: 36,
    permittedTenorMonths: [24, 36, 60],
  },
});

describe('funding-market engine', () => {
  it('prices a neutral issuer from observable market and instrument terms', () => {
    const result = calculateFundingMarket(neutralModel());
    expect(result.fairSpreadBps).toBeCloseTo(150, 8);
    expect(result.capacityAtFairSpread).toBeCloseTo(800e6, -2);
    expect(result.hardCapacity).toBeCloseTo(2e9, -2);
    expect(result.clearingSpreadBps).toBeCloseTo(150, 8);
    expect(result.status).toBe('open');
    expect(result.maxTenorMonths).toBe(60);
    expect(result.drivers.find(driver => driver.key === 'capital')?.spreadBps).toBeCloseTo(0, 8);
  });

  it('widens spread and cuts capacity when issuer fundamentals deteriorate', () => {
    const neutral = calculateFundingMarket(neutralModel());
    const model = neutralModel();
    model.fundamentals = {
      ...model.fundamentals,
      cet1Headroom: -0.01,
      leverageHeadroom: -0.005,
      lcr: 0.85,
      nsfr: 0.90,
      wholesaleFundingRatio: 0.50,
      wholesaleFundingMaturing12mRatio: 0.30,
      depositFranchiseStrength: 0.35,
      stage2Share: 0.35,
      stage3Share: 0.10,
      annualisedRoa: -0.01,
      marketSeniorSpreadBps: 300,
    };
    const stressed = calculateFundingMarket(model);
    expect(stressed.fairSpreadBps).toBeGreaterThan(neutral.fairSpreadBps);
    expect(stressed.capacityAtFairSpread).toBeLessThan(neutral.capacityAtFairSpread);
    expect(stressed.capacityMultiplier).toBeLessThan(neutral.capacityMultiplier);
    expect(stressed.drivers.find(driver => driver.key === 'capital')?.severity).toBeGreaterThan(0);
    expect(stressed.drivers.find(driver => driver.key === 'assetQuality')?.spreadBps).toBeGreaterThan(0);
  });

  it('uses an investor demand curve instead of a fixed all-or-nothing capacity limit', () => {
    const unrestrictedModel = neutralModel();
    unrestrictedModel.targetAmount = 1.2e9;
    const unrestricted = calculateFundingMarket(unrestrictedModel);
    expect(unrestricted.demandAtPrice).toBeCloseTo(2e9, -2);
    expect(unrestricted.clearingSpreadBps).toBeGreaterThan(unrestricted.fairSpreadBps);

    const priceCappedModel = neutralModel();
    priceCappedModel.targetAmount = 1.2e9;
    priceCappedModel.maxSpreadBps = 170;
    const priceCapped = calculateFundingMarket(priceCappedModel);
    expect(priceCapped.demandAtPrice).toBeGreaterThan(priceCapped.capacityAtFairSpread);
    expect(priceCapped.demandAtPrice).toBeLessThan(priceCappedModel.targetAmount);
    expect(priceCapped.clearingSpreadBps).toBeLessThanOrEqual(170 + 1e-9);
  });

  it('makes longer tenor modestly more expensive without inventing a confidence state', () => {
    const shortModel = neutralModel();
    shortModel.requestedTenorMonths = 36;
    const longModel = neutralModel();
    longModel.requestedTenorMonths = 60;
    const short = calculateFundingMarket(shortModel);
    const long = calculateFundingMarket(longModel);
    expect(long.fairSpreadBps).toBeGreaterThan(short.fairSpreadBps);
    expect(long.capacityAtFairSpread).toBeLessThan(short.capacityAtFairSpread);
    expect(long.tenorAvailable).toBe(true);
  });
});
