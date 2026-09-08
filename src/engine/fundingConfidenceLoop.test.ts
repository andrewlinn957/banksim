import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const fundingRate = (state: typeof initialState, productType: LiabilityProductType): number =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType)?.interestRate ?? 0;

describe('Funding confidence loop', () => {
  it('weak confidence increases refinance rates versus baseline', () => {
    const engine = createSimulationEngine();
    const baselineState = cloneBankState(initialState);
    const stressedState = cloneBankState(initialState);
    for (const state of [baselineState, stressedState]) {
      (state.fundingLadders[LiabilityProductType.WholesaleFundingLT] ?? []).forEach(b => b.monthsToMaturity = 1);
    }

    stressedState.behaviour.depositFranchiseStrength = 0.35;
    stressedState.risk.riskMetrics.cet1Ratio = 0.085;
    stressedState.risk.riskMetrics.lcr = 0.88;
    stressedState.risk.riskMetrics.nsfr = 0.9;
    stressedState.risk.riskMetrics.depositQualityIndex = 0.62;
    stressedState.risk.riskMetrics.fundingStressIndex = 1.1;
    stressedState.risk.riskMetrics.fundingConfidenceScore = 0.25;

    const baseline = engine.step({ state: baselineState, config: baseConfig, actions: [], shocks: [] }).nextState;
    const stressed = engine.step({ state: stressedState, config: baseConfig, actions: [], shocks: [] }).nextState;

    expect(fundingRate(stressed, LiabilityProductType.WholesaleFundingLT))
      .toBeGreaterThan(fundingRate(baseline, LiabilityProductType.WholesaleFundingLT));
    expect(stressed.market.seniorDebtSpread).toBeGreaterThan(baseline.market.seniorDebtSpread);
  });
});
