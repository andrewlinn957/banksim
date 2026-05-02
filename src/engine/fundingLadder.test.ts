import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const lineBalance = (state: typeof initialState, productType: LiabilityProductType): number =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType)?.balance ?? 0;

describe('Funding ladder lifecycle', () => {
  it('keeps wholesale funding line balance aligned to ladder buckets after rollover', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);

    const { nextState } = engine.step({
      state,
      config: baseConfig,
      actions: [],
      shocks: [],
    });

    const stBuckets = nextState.fundingLadders[LiabilityProductType.WholesaleFundingST] ?? [];
    const ltBuckets = nextState.fundingLadders[LiabilityProductType.WholesaleFundingLT] ?? [];
    const stTotal = stBuckets.reduce((sum, bucket) => sum + bucket.notional, 0);
    const ltTotal = ltBuckets.reduce((sum, bucket) => sum + bucket.notional, 0);

    expect(stTotal).toBeCloseTo(lineBalance(nextState, LiabilityProductType.WholesaleFundingST), 6);
    expect(ltTotal).toBeCloseTo(lineBalance(nextState, LiabilityProductType.WholesaleFundingLT), 6);
  });

  it('rollover stress reduces refinancing capacity and increases short-term funding cost', () => {
    const engine = createSimulationEngine();

    const baseline = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [],
      shocks: [],
    }).nextState;

    const stressed = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [],
      shocks: [{ type: 'rolloverStress', accessMultiplier: 0.6, spreadBps: 150 }],
    }).nextState;

    const baselineSt = baseline.financial.balanceSheet.items.find(
      (item) => item.productType === LiabilityProductType.WholesaleFundingST
    );
    const stressedSt = stressed.financial.balanceSheet.items.find(
      (item) => item.productType === LiabilityProductType.WholesaleFundingST
    );

    expect(stressedSt?.interestRate ?? 0).toBeGreaterThan(baselineSt?.interestRate ?? 0);
    expect(stressed.risk.riskMetrics.fundingMaturing12m).toBeGreaterThanOrEqual(0);
  });

  it('confidence state applies stepwise spread/access penalties to issuance', () => {
    const engine = createSimulationEngine();
    const requested = 12e9;

    const strongState = cloneBankState(initialState);
    strongState.behaviour.fundingConfidenceState = 'strong';
    const stressedState = cloneBankState(initialState);
    stressedState.behaviour.fundingConfidenceState = 'stressed';

    const beforeStrong = lineBalance(strongState, LiabilityProductType.WholesaleFundingLT);
    const beforeStressed = lineBalance(stressedState, LiabilityProductType.WholesaleFundingLT);

    const strong = engine.step({
      state: strongState,
      config: baseConfig,
      actions: [{ type: 'issueDebt', productType: LiabilityProductType.WholesaleFundingLT, amount: requested }],
      shocks: [],
    }).nextState;

    const stressed = engine.step({
      state: stressedState,
      config: baseConfig,
      actions: [{ type: 'issueDebt', productType: LiabilityProductType.WholesaleFundingLT, amount: requested }],
      shocks: [],
    }).nextState;

    const strongDelta = lineBalance(strong, LiabilityProductType.WholesaleFundingLT) - beforeStrong;
    const stressedDelta = lineBalance(stressed, LiabilityProductType.WholesaleFundingLT) - beforeStressed;
    const strongRate =
      strong.financial.balanceSheet.items.find((item) => item.productType === LiabilityProductType.WholesaleFundingLT)
        ?.interestRate ?? 0;
    const stressedRate =
      stressed.financial.balanceSheet.items.find((item) => item.productType === LiabilityProductType.WholesaleFundingLT)
        ?.interestRate ?? 0;

    expect(stressedDelta).toBeLessThan(strongDelta);
    expect(stressedRate).toBeGreaterThan(strongRate);
  });
});
