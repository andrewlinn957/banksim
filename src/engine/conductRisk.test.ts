import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

describe('Conduct and consumer-duty channel', () => {
  it('persistent aggressive pricing accumulates conduct risk and triggers costly events', () => {
    const engine = createSimulationEngine();
    const config = {
      ...baseConfig,
      behaviour: {
        ...baseConfig.behaviour,
        conductRisk: {
          ...baseConfig.behaviour.conductRisk!,
          depositUnderpricingThreshold: 0.002,
          lendingOverpricingThreshold: 0.003,
          scoreBuildRate: 0.4,
          scoreDecayRate: 0.01,
          eventProbabilityBase: 0,
          eventProbabilitySlope: 0.5,
          eventProbabilityCap: 0.95,
          eventCooldownMonths: 2,
          minEventCost: 10e6,
        },
      },
    };

    let aggressive = cloneBankState(initialState);
    let benign = cloneBankState(initialState);
    let triggeredEvents = 0;

    for (let month = 0; month < 18; month++) {
      const aggressiveStep = engine.step({
        state: aggressive,
        config,
        actions: [
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailTransactionalDeposits,
            newRate: 0,
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailSavingsDeposits,
            newRate: 0,
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateOperatingDeposits,
            newRate: 0.002,
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateNonOperatingDeposits,
            newRate: 0.002,
          },
          {
            type: 'adjustRate',
            productType: AssetProductType.Mortgages,
            newRate: aggressive.market.competitorMortgageRate + 0.045,
          },
          {
            type: 'adjustRate',
            productType: AssetProductType.CorporateLoans,
            newRate: aggressive.market.riskFreeLong + aggressive.market.corporateLoanSpread + 0.05,
          },
          {
            type: 'setUnderwriting',
            productType: AssetProductType.Mortgages,
            tightness: 0,
          },
          {
            type: 'setUnderwriting',
            productType: AssetProductType.CorporateLoans,
            tightness: 0,
          },
        ],
        shocks: [],
      });
      aggressive = aggressiveStep.nextState;
      triggeredEvents += aggressiveStep.events.filter((event) =>
        event.message.toLowerCase().includes('conduct event triggered')
      ).length;

      benign = engine.step({
        state: benign,
        config,
        actions: [],
        shocks: [],
      }).nextState;
    }

    expect(triggeredEvents).toBeGreaterThan(0);
    expect(aggressive.behaviour.conductRiskScore ?? 0).toBeGreaterThan(benign.behaviour.conductRiskScore ?? 0);
    expect(aggressive.behaviour.cumulativeConductCosts ?? 0).toBeGreaterThan(0);
    expect(aggressive.behaviour.depositFranchiseStrength).toBeLessThan(benign.behaviour.depositFranchiseStrength);
    expect(
      aggressive.financial.capital.cet1 - (aggressive.behaviour.cumulativeConductCosts ?? 0)
    ).toBeLessThan(benign.financial.capital.cet1);
  });
});
