import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { MaturityBucket } from '../domain/enums';
import { assetCreditRwa } from '../engine/creditRwa';
import { calculateRiskMetrics } from '../engine/metrics';
import { cloneBankState } from '../engine/clone';
import { createPosition } from './factory';
import {
  AssetProductType,
  LiabilityProductType,
  PRODUCTS,
  ProductType,
} from './catalogue';
import {
  CREDIT_RISK_RULES,
  LIQUIDITY_RULES,
  eligibleTier2OwnFunds,
  getCapitalRule,
  getCreditRiskRule,
  getLiquidityRule,
  getRegulatoryClassification,
  liquidityTagForProduct,
  regulatoryRiskWeight,
} from './regulatory';

const compact = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

describe('prudential product classification', () => {
  it('gives every product complete regulatory classifications backed by rule tables', () => {
    (Object.keys(PRODUCTS) as ProductType[]).forEach(productType => {
      const classification = getRegulatoryClassification(productType);
      expect(LIQUIDITY_RULES[classification.liquidity]).toBeDefined();
      expect(CREDIT_RISK_RULES[classification.creditRisk]).toBeDefined();
      expect(getCapitalRule(productType)).toBeDefined();
      expect(classification.leverage).toBeTruthy();
    });
  });

  it('preserves the current liquidity calibration while making the regulatory table authoritative', () => {
    (Object.keys(PRODUCTS) as ProductType[]).forEach(productType => {
      expect(compact(liquidityTagForProduct(productType) as unknown as Record<string, unknown>)).toEqual(
        compact(baseConfig.liquidityTags[productType] as unknown as Record<string, unknown>)
      );
    });
  });

  it('preserves current standardised performing risk weights by credit-risk class', () => {
    expect(regulatoryRiskWeight(AssetProductType.CashReserves)).toBe(0);
    expect(regulatoryRiskWeight(AssetProductType.Gilts)).toBe(0);
    expect(regulatoryRiskWeight(AssetProductType.Mortgages)).toBe(0.35);
    expect(regulatoryRiskWeight(AssetProductType.ConsumerLoans)).toBe(0.75);
    expect(regulatoryRiskWeight(AssetProductType.CorporateLoans)).toBe(1);
    expect(regulatoryRiskWeight(AssetProductType.DerivativeAssets)).toBe(1);

    (Object.keys(PRODUCTS) as ProductType[]).forEach(productType => {
      expect(regulatoryRiskWeight(productType)).toBe(baseConfig.productParameters[productType].riskWeight);
    });
  });

  it('keeps RWA independent of the legacy config riskWeight field', () => {
    const state = cloneBankState(initialState);
    const config = structuredClone(baseConfig);
    const mortgage = state.financial.balanceSheet.items.find(
      item => item.productType === AssetProductType.Mortgages
    )!;
    const baseline = assetCreditRwa(state, config, mortgage);
    config.productParameters[AssetProductType.Mortgages].riskWeight = 9;
    expect(assetCreditRwa(state, config, mortgage)).toBeCloseTo(baseline, 8);
  });

  it('owns commitment LCR, NSFR and RWA factors through the product class', () => {
    expect(getLiquidityRule(AssetProductType.Mortgages)).toMatchObject({
      commitmentOutflowFactor: 0.05,
      commitmentRsfFactor: 0.05,
    });
    expect(getLiquidityRule(AssetProductType.CorporateLoans)).toMatchObject({
      commitmentOutflowFactor: 0.10,
      commitmentRsfFactor: 0.05,
    });
    expect(getCreditRiskRule(AssetProductType.Mortgages).performingRiskWeight).toBe(0.35);
    expect(getCreditRiskRule(AssetProductType.CorporateLoans).performingRiskWeight).toBe(1);
  });

  it('classifies Tier 2 debt as eligible own funds and caps eligibility at the classified balance', () => {
    const state = cloneBankState(initialState);
    state.financial.capital.tier2 = 100;
    state.financial.balanceSheet.items.push(
      createPosition(baseConfig, {
        productType: LiabilityProductType.Tier2Debt,
        balance: 60,
        interestRate: 0,
        maturityBucket: MaturityBucket.GreaterThan5Y,
      })
    );

    expect(getCapitalRule(LiabilityProductType.Tier2Debt)).toEqual({ ownFundsTier: 'tier2' });
    expect(eligibleTier2OwnFunds(state)).toBe(60);

    const metrics = calculateRiskMetrics({ state, config: baseConfig });
    expect(((metrics.totalCapitalRatio ?? 0) - (metrics.tier1Ratio ?? 0)) * metrics.rwa).toBeCloseTo(60, 4);
  });

  it('keeps recorded Tier 2 eligible for legacy states that predate a Tier 2 balance-sheet line', () => {
    const state = cloneBankState(initialState);
    state.financial.capital.tier2 = 50;
    state.financial.balanceSheet.items = state.financial.balanceSheet.items.filter(
      item => item.productType !== LiabilityProductType.Tier2Debt
    );
    expect(eligibleTier2OwnFunds(state)).toBe(50);
  });
});
