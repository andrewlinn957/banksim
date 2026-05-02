import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const totalCustomerDeposits = (state: typeof initialState): number =>
  state.financial.balanceSheet.items
    .filter((item) => item.side === 'Liability')
    .filter((item) =>
      [
        LiabilityProductType.RetailTransactionalDeposits,
        LiabilityProductType.RetailSavingsDeposits,
        LiabilityProductType.CorporateOperatingDeposits,
        LiabilityProductType.CorporateNonOperatingDeposits,
      ].includes(item.productType as LiabilityProductType)
    )
    .reduce((sum, item) => sum + item.balance, 0);

describe('Deposit franchise dynamics', () => {
  it('persistent underpricing degrades franchise and deposit stability', () => {
    const engine = createSimulationEngine();
    let state = cloneBankState(initialState);
    const startDeposits = totalCustomerDeposits(state);
    const startFranchise = state.behaviour.depositFranchiseStrength;
    const startStability =
      state.behaviour.depositStabilityIndex?.[LiabilityProductType.RetailSavingsDeposits] ?? 1;

    for (let month = 0; month < 24; month++) {
      const retailTarget = Math.max(0, state.market.competitorRetailDepositRate - 0.02);
      const corporateTarget = Math.max(
        0,
        (state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate) -
          0.025
      );
      state = engine.step({
        state,
        config: baseConfig,
        actions: [
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailTransactionalDeposits,
            newRate: retailTarget,
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailSavingsDeposits,
            newRate: retailTarget,
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateOperatingDeposits,
            newRate: corporateTarget,
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateNonOperatingDeposits,
            newRate: corporateTarget,
          },
        ],
        shocks: [],
      }).nextState;
    }

    const endDeposits = totalCustomerDeposits(state);
    const endFranchise = state.behaviour.depositFranchiseStrength;
    const endStability =
      state.behaviour.depositStabilityIndex?.[LiabilityProductType.RetailSavingsDeposits] ?? 1;

    expect(endFranchise).toBeLessThan(startFranchise);
    expect(endStability).toBeLessThan(startStability);
    expect(endDeposits).toBeLessThan(startDeposits);
    expect(
      state.behaviour.depositUnderpricingMonths?.[LiabilityProductType.RetailSavingsDeposits] ?? 0
    ).toBeGreaterThan(12);
  });
});
