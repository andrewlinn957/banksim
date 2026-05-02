import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const balance = (state: typeof initialState, productType: LiabilityProductType): number =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType)?.balance ?? 0;

describe('Deposit mix migration', () => {
  it('underpricing corporate deposits shifts mix toward non-operating balances', () => {
    const engine = createSimulationEngine();
    let state = cloneBankState(initialState);

    const beforeOperating = balance(state, LiabilityProductType.CorporateOperatingDeposits);
    const beforeNonOperating = balance(state, LiabilityProductType.CorporateNonOperatingDeposits);
    const beforeOperatingShare = beforeOperating / Math.max(1, beforeOperating + beforeNonOperating);
    const beforeQuality = state.risk.riskMetrics.depositQualityIndex;

    for (let month = 0; month < 8; month++) {
      const competitor =
        state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate;
      state = engine.step({
        state,
        config: baseConfig,
        actions: [
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateOperatingDeposits,
            newRate: Math.max(0, competitor - 0.03),
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateNonOperatingDeposits,
            newRate: Math.max(0, competitor - 0.03),
          },
        ],
        shocks: [],
      }).nextState;
    }

    const afterOperating = balance(state, LiabilityProductType.CorporateOperatingDeposits);
    const afterNonOperating = balance(state, LiabilityProductType.CorporateNonOperatingDeposits);
    const afterNonOperatingShare =
      afterNonOperating / Math.max(1, afterOperating + afterNonOperating);
    const afterOperatingShare = afterOperating / Math.max(1, afterOperating + afterNonOperating);
    const afterQuality = state.risk.riskMetrics.depositQualityIndex;

    expect(afterOperatingShare).toBeLessThan(beforeOperatingShare);
    expect(afterNonOperatingShare).toBeGreaterThan(
      beforeNonOperating / Math.max(1, beforeOperating + beforeNonOperating)
    );
    expect(afterQuality).toBeLessThan(beforeQuality);
  });
});
