import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';
import { calculateRiskMetrics } from './metrics';

describe('Simulation correctness guardrails', () => {
  it('uses confidence-adjusted market pricing for senior issuance', () => {
    const engine = createSimulationEngine();
    const strongState = cloneBankState(initialState);
    strongState.behaviour.fundingConfidenceState = 'strong';
    const stressedState = cloneBankState(initialState);
    stressedState.behaviour.fundingConfidenceState = 'stressed';

    const action = { type: 'launchCapitalMarketsTransaction' as const, instrument: 'senior' as const, targetAmount: 500e6, maxSpreadBps: 5000, tenorMonths: 36 };
    const strong = engine.step({ state: strongState, config: baseConfig, actions: [action], shocks: [] });
    const stressed = engine.step({ state: stressedState, config: baseConfig, actions: [action], shocks: [] });
    const strongExecution = strong.executions.capitalMarkets[0];
    const stressedExecution = stressed.executions.capitalMarkets[0];

    expect(stressedExecution.clearingSpreadBps ?? 0).toBeGreaterThan(strongExecution.clearingSpreadBps ?? 0);
    expect(stressedExecution.demandAmount).toBeLessThan(strongExecution.demandAmount);
  });

  it('respects the management maximum spread when issuing senior debt', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);
    const balanceBefore = state.financial.balanceSheet.items.find(
      (i) => i.productType === LiabilityProductType.WholesaleFundingLT
    )?.balance ?? 0;

    const result = engine.step({
      state,
      config: baseConfig,
      actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'senior', targetAmount: 500e6, maxSpreadBps: 1, tenorMonths: 36 }],
      shocks: [],
    });
    const execution = result.executions.capitalMarkets[0];
    const balanceAfter = result.nextState.financial.balanceSheet.items.find(
      (i) => i.productType === LiabilityProductType.WholesaleFundingLT
    )?.balance ?? 0;

    expect(execution.status).toBe('failed-price');
    expect(execution.executedAmount).toBe(0);
    expect(balanceAfter).toBeCloseTo(balanceBefore, 2);
  });

  it('emits internal warnings once per step and suppresses removed concentration limits', () => {
    const engine = createSimulationEngine();
    const stressed = cloneBankState(initialState);
    const cash = stressed.financial.balanceSheet.items.find((line) => line.productType === AssetProductType.CashReserves);
    if (!cash) throw new Error('Missing cash line item');

    // Keep the fixture inside regulatory buffers but clearly below a conservative internal target,
    // independently of whatever opening capital level the calibration chooses.
    const warningConfig = structuredClone(baseConfig);
    warningConfig.riskLimits.capitalPolicy.internalTargetBaseBuffer = .05;
    warningConfig.riskLimits.capitalPolicy.internalTargetMaxBuffer = .06;
    const openingMetrics = calculateRiskMetrics({ state: stressed, config: warningConfig });
    const inclusionRate = warningConfig.behaviour.securitiesAccounting.fvociCet1InclusionRate;
    const targetAdjustedCet1 = (openingMetrics.cet1Requirement + 0.006) * openingMetrics.rwa;
    const targetCet1 = targetAdjustedCet1 - stressed.financial.capital.accumulatedOCI * inclusionRate;
    const cet1Delta = targetCet1 - stressed.financial.capital.cet1;
    stressed.financial.capital.cet1 = targetCet1;
    cash.balance += cet1Delta;

    stressed.behaviour.depositFranchiseStrength = 0.45;
    stressed.behaviour.fundingConfidenceState = 'stressed';

    const { events } = engine.step({
      state: stressed,
      config: warningConfig,
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
    expect(concentrationWarnings.length).toBe(0);
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