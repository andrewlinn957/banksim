import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const findBalance = (state: typeof initialState, productType: AssetProductType | LiabilityProductType) =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType);

describe('Internal capital target and payout gating', () => {
  it('clips distributions earlier when volatility/stress are high, before MDA breach', () => {
    const engine = createSimulationEngine();

    const benignState = cloneBankState(initialState);
    const benignCash = findBalance(benignState, AssetProductType.CashReserves);
    if (!benignCash) throw new Error('Missing cash line for benign internal target test');
    const targetCet1 = initialState.financial.capital.cet1 * 0.95;
    const benignCet1Delta = targetCet1 - benignState.financial.capital.cet1;
    benignState.financial.capital.cet1 = targetCet1;
    benignCash.balance += benignCet1Delta;
    benignState.behaviour.capitalPolicy = { dividendPayoutRatio: 0.9, at1CouponMode: 'auto' };
    benignState.behaviour.earningsVolatility = 0.05e9;
    benignState.behaviour.depositFranchiseStrength = 0.9;
    benignState.behaviour.reputation = 0.9;
    benignState.behaviour.conductRiskScore = 0;
    benignState.behaviour.fundingConfidenceState = 'strong';

    const stressedState = cloneBankState(initialState);
    const stressedCash = findBalance(stressedState, AssetProductType.CashReserves);
    if (!stressedCash) throw new Error('Missing cash line for stressed internal target test');
    const stressedCet1Delta = targetCet1 - stressedState.financial.capital.cet1;
    stressedState.financial.capital.cet1 = targetCet1;
    stressedCash.balance += stressedCet1Delta;
    stressedState.behaviour.capitalPolicy = { dividendPayoutRatio: 0.9, at1CouponMode: 'auto' };
    stressedState.behaviour.earningsVolatility = 0.8e9;
    stressedState.behaviour.depositFranchiseStrength = 0.42;
    stressedState.behaviour.reputation = 0.45;
    stressedState.behaviour.conductRiskScore = 1.6;
    stressedState.behaviour.fundingConfidenceState = 'stressed';

    const benignStep = engine.step({ state: benignState, config: baseConfig, actions: [], shocks: [] });
    const stressedStep = engine.step({ state: stressedState, config: baseConfig, actions: [], shocks: [] });
    const benign = benignStep.nextState;
    const stressed = stressedStep.nextState;

    expect(benign.risk.riskMetrics.mdaTriggered).toBe(false);
    expect(stressed.risk.riskMetrics.mdaTriggered).toBe(false);
    expect(stressed.risk.riskMetrics.payoutBlockedByInternalTarget).toBe(true);
    expect(stressed.risk.riskMetrics.maxPayoutRatio).toBeLessThan(benign.risk.riskMetrics.maxPayoutRatio);
    expect(stressed.risk.riskMetrics.internalCet1Headroom).toBeLessThan(benign.risk.riskMetrics.internalCet1Headroom);
    expect(stressed.board.score).toBeGreaterThan(benign.board.score);
    expect(stressedStep.events.some((event) => event.message.toLowerCase().includes('internal target'))).toBe(true);
  });
});
