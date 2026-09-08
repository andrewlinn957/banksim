import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const getBalance = (state: typeof initialState, productType: LiabilityProductType): number =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType)?.balance ?? 0;

describe('Deposit segmentation', () => {
  it('retail current accounts are less price-sensitive than business operating deposits', () => {
    const retailParams = baseConfig.behaviour.depositByProduct?.[LiabilityProductType.RetailCurrentAccounts]!;
    const businessParams = baseConfig.behaviour.depositByProduct?.[LiabilityProductType.CorporateOperatingDeposits]!;
    expect(businessParams.competitorSensitivity).toBeGreaterThan(retailParams.competitorSensitivity);
    expect(businessParams.underpricingConvexity).toBeGreaterThan(retailParams.underpricingConvexity);

    const engine = createSimulationEngine();
    const start = cloneBankState(initialState);
    const retailCompetitor = start.market.competitorRetailCurrentAccountRate;
    const businessCompetitor = start.market.competitorCorporateDepositRate ?? retailCompetitor;

    const beforeRetail = getBalance(start, LiabilityProductType.RetailCurrentAccounts);
    const beforeBusiness = getBalance(start, LiabilityProductType.CorporateOperatingDeposits);

    const { nextState } = engine.step({
      state: start,
      config: baseConfig,
      actions: [
        {
          type: 'adjustRate',
          productType: LiabilityProductType.RetailCurrentAccounts,
          newRate: retailCompetitor + 0.01,
        },
        {
          type: 'adjustRate',
          productType: LiabilityProductType.CorporateOperatingDeposits,
          newRate: businessCompetitor + 0.01,
        },
      ],
      shocks: [],
    });

    const afterRetail = getBalance(nextState, LiabilityProductType.RetailCurrentAccounts);
    const afterBusiness = getBalance(nextState, LiabilityProductType.CorporateOperatingDeposits);
    const retailGrowth = (afterRetail - beforeRetail) / beforeRetail;
    const businessGrowth = (afterBusiness - beforeBusiness) / beforeBusiness;

    expect(Number.isFinite(retailGrowth)).toBe(true);
    expect(Number.isFinite(businessGrowth)).toBe(true);
    expect(businessGrowth).toBeGreaterThan(retailGrowth);
  });

  it('corporate deposit mix shift changes NSFR via ASF factors', () => {
    const engine = createSimulationEngine();
    const competitor = initialState.market.competitorCorporateDepositRate ?? initialState.market.competitorRetailCurrentAccountRate;

    const baseline = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [
        {
          type: 'adjustRate',
          productType: LiabilityProductType.CorporateOperatingDeposits,
          newRate: competitor,
        },
        {
          type: 'adjustRate',
          productType: LiabilityProductType.CorporateNonOperatingDeposits,
          newRate: competitor,
        },
      ],
      shocks: [],
    }).nextState;

    const shifted = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [
        {
          type: 'adjustRate',
          productType: LiabilityProductType.CorporateOperatingDeposits,
          newRate: competitor + 0.01,
        },
        {
          type: 'adjustRate',
          productType: LiabilityProductType.CorporateNonOperatingDeposits,
          newRate: Math.max(0, competitor - 0.01),
        },
      ],
      shocks: [],
    }).nextState;

    const baselineOperating = getBalance(baseline, LiabilityProductType.CorporateOperatingDeposits);
    const baselineNonOperating = getBalance(baseline, LiabilityProductType.CorporateNonOperatingDeposits);
    const shiftedOperating = getBalance(shifted, LiabilityProductType.CorporateOperatingDeposits);
    const shiftedNonOperating = getBalance(shifted, LiabilityProductType.CorporateNonOperatingDeposits);

    const baselineOperatingShare = baselineOperating / Math.max(1, baselineOperating + baselineNonOperating);
    const shiftedOperatingShare = shiftedOperating / Math.max(1, shiftedOperating + shiftedNonOperating);

    expect(shiftedOperatingShare).toBeGreaterThan(baselineOperatingShare);
    expect(shifted.risk.riskMetrics.nsfr).toBeGreaterThan(baseline.risk.riskMetrics.nsfr);
  });
});
