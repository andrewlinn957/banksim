import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';
import { calculateRiskMetrics } from './metrics';

describe('Simulation correctness guardrails', () => {
  it('uses confidence-adjusted market default pricing when issuing debt without explicit rate override', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);
    const amount = 10e9;

    const lineBefore = state.financial.balanceSheet.items.find(
      (i) => i.productType === LiabilityProductType.WholesaleFundingLT
    );
    if (!lineBefore) {
      throw new Error('Missing LT wholesale funding line item');
    }

    const marketPricing = state.market.riskFreeLong + state.market.seniorDebtSpread;
    const confidenceState = state.behaviour.fundingConfidenceState ?? 'stable';
    const confidenceImpact =
      baseConfig.behaviour.confidenceStateMachine?.impacts?.[confidenceState] ??
      baseConfig.behaviour.confidenceStateMachine?.impacts?.stable;
    const executableAmount = amount * (confidenceImpact?.accessMultiplier ?? 1);
    const issuanceRate = Math.max(0, marketPricing + (confidenceImpact?.spreadPenaltyBps ?? 0) / 10000);
    const expectedBlendedRate =
      (lineBefore.balance * lineBefore.interestRate + executableAmount * issuanceRate) /
      (lineBefore.balance + executableAmount);

    const { nextState } = engine.step({
      state,
      config: baseConfig,
      actions: [
        {
          type: 'issueDebt',
          productType: LiabilityProductType.WholesaleFundingLT,
          amount,
        },
      ],
      shocks: [],
    });

    const lineAfter = nextState.financial.balanceSheet.items.find(
      (i) => i.productType === LiabilityProductType.WholesaleFundingLT
    );
    if (!lineAfter) {
      throw new Error('Missing LT wholesale funding line item after issuance');
    }

    expect(lineAfter.interestRate).toBeCloseTo(expectedBlendedRate, 10);
    expect(lineAfter.interestRate).toBeGreaterThan(0);
  });

  it('respects explicit debt issuance rate override even in stressed confidence state', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);
    state.behaviour.fundingConfidenceState = 'stressed';
    const amount = 10e9;
    const explicitRate = 0.06;

    const accessMultiplier =
      baseConfig.behaviour.confidenceStateMachine?.impacts?.stressed?.accessMultiplier ?? 1;
    const executedAmount = amount * accessMultiplier;
    const lineBefore = state.financial.balanceSheet.items.find(
      (i) => i.productType === LiabilityProductType.WholesaleFundingLT
    );
    if (!lineBefore) {
      throw new Error('Missing LT wholesale funding line item');
    }
    const expectedBlendedRate =
      (lineBefore.balance * lineBefore.interestRate + executedAmount * explicitRate) /
      (lineBefore.balance + executedAmount);

    const { nextState } = engine.step({
      state,
      config: baseConfig,
      actions: [
        {
          type: 'issueDebt',
          productType: LiabilityProductType.WholesaleFundingLT,
          amount,
          rate: explicitRate,
        },
      ],
      shocks: [],
    });

    const lineAfter = nextState.financial.balanceSheet.items.find(
      (i) => i.productType === LiabilityProductType.WholesaleFundingLT
    );
    if (!lineAfter) {
      throw new Error('Missing LT wholesale funding line item after issuance');
    }

    expect(lineAfter.interestRate).toBeCloseTo(expectedBlendedRate, 10);
  });

  it('emits regulatory warnings once per step even with pre/post metric passes', () => {
    const engine = createSimulationEngine();
    const stressed = cloneBankState(initialState);
    const cash = stressed.financial.balanceSheet.items.find((line) => line.productType === AssetProductType.CashReserves);
    if (!cash) throw new Error('Missing cash line item');
    const targetCet1 = initialState.financial.capital.cet1 * 1.3;
    const cet1Delta = targetCet1 - stressed.financial.capital.cet1;
    stressed.financial.capital.cet1 = targetCet1;
    cash.balance += cet1Delta;

    stressed.behaviour.earningsVolatility = 0.8e9;
    stressed.behaviour.depositFranchiseStrength = 0.45;
    stressed.behaviour.reputation = 0.45;
    stressed.behaviour.conductRiskScore = 1.4;
    stressed.behaviour.fundingConfidenceState = 'stressed';

    const { events } = engine.step({
      state: stressed,
      config: baseConfig,
      actions: [{ type: 'setCapitalPolicy', dividendPayoutRatio: 0.9, at1CouponMode: 'auto' }],
      shocks: [],
    });

    const internalTargetWarnings = events.filter((event) =>
      event.message.startsWith('Internal capital target active:')
    );
    const concentrationWarnings = events.filter((event) =>
      event.message.startsWith('Concentration limit breached')
    );

    expect(internalTargetWarnings.length).toBe(1);
    expect(concentrationWarnings.length).toBe(1);
  });

  it('normalises non-integer step length and advances dates by calendar month', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);
    state.time.date = new Date('2024-01-31T00:00:00.000Z');
    state.time.stepLengthMonths = 1.4;

    const { nextState, events } = engine.step({
      state,
      config: baseConfig,
      actions: [],
      shocks: [],
    });

    expect(nextState.time.stepLengthMonths).toBe(1);
    expect(nextState.time.date.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(events.some((event) => event.message.includes('Non-integer step length'))).toBe(true);
  });

  it('uses OCI-adjusted CET1 as the CET1 ratio numerator', () => {
    const state = cloneBankState(initialState);
    state.financial.capital.cet1 = 1e9;
    state.financial.capital.accumulatedOCI = 0.2e9;
    const inclusionRate = baseConfig.behaviour.securitiesAccounting.fvociCet1InclusionRate;

    const metrics = calculateRiskMetrics({ state, config: baseConfig });

    expect(metrics.cet1Ratio).toBeCloseTo(
      (state.financial.capital.cet1 + state.financial.capital.accumulatedOCI * inclusionRate) / metrics.rwa,
      12
    );
  });
});
