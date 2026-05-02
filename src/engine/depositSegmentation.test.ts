import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const getBalance = (state: typeof initialState, productType: LiabilityProductType): number =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType)?.balance ?? 0;

describe('Deposit segmentation', () => {
  it('retail segments react differently to the same pricing change', () => {
    const engine = createSimulationEngine();
    const start = cloneBankState(initialState);
    const competitor = start.market.competitorRetailDepositRate;

    const beforeTransactional = getBalance(start, LiabilityProductType.RetailTransactionalDeposits);
    const beforeSavings = getBalance(start, LiabilityProductType.RetailSavingsDeposits);

    const { nextState } = engine.step({
      state: start,
      config: baseConfig,
      actions: [
        {
          type: 'adjustRate',
          productType: LiabilityProductType.RetailTransactionalDeposits,
          newRate: competitor + 0.01,
        },
        {
          type: 'adjustRate',
          productType: LiabilityProductType.RetailSavingsDeposits,
          newRate: competitor + 0.01,
        },
      ],
      shocks: [],
    });

    const afterTransactional = getBalance(nextState, LiabilityProductType.RetailTransactionalDeposits);
    const afterSavings = getBalance(nextState, LiabilityProductType.RetailSavingsDeposits);

    const transactionalGrowth = (afterTransactional - beforeTransactional) / beforeTransactional;
    const savingsGrowth = (afterSavings - beforeSavings) / beforeSavings;
    expect(Math.abs(savingsGrowth - transactionalGrowth)).toBeGreaterThan(0.001);
    expect(savingsGrowth).toBeGreaterThan(transactionalGrowth);
  });

  it('corporate deposit mix shift changes NSFR via ASF factors', () => {
    const engine = createSimulationEngine();
    const competitor = initialState.market.competitorCorporateDepositRate ?? initialState.market.competitorRetailDepositRate;

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
