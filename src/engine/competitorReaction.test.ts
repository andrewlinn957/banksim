import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

describe('Competitor reaction dynamics', () => {
  it('competitor rates move toward persistent player pricing', () => {
    const engine = createSimulationEngine();
    let state = cloneBankState(initialState);
    const startRetail = state.market.competitorRetailDepositRate;
    const startMortgage = state.market.competitorMortgageRate;

    for (let month = 0; month < 6; month++) {
      state = engine.step({
        state,
        config: baseConfig,
        actions: [
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailTransactionalDeposits,
            newRate: state.market.competitorRetailDepositRate + 0.02,
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailSavingsDeposits,
            newRate: state.market.competitorRetailDepositRate + 0.02,
          },
          {
            type: 'adjustRate',
            productType: AssetProductType.Mortgages,
            newRate: state.market.competitorMortgageRate + 0.02,
          },
        ],
        shocks: [],
      }).nextState;
    }

    expect(state.market.competitorRetailDepositRate).toBeGreaterThan(startRetail);
    expect(state.market.competitorMortgageRate).toBeGreaterThan(startMortgage);
  });
});
