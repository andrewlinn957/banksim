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

    const baselineState = cloneBankState(initialState);
    (baselineState.fundingLadders[LiabilityProductType.WholesaleFundingLT] ?? []).forEach(b => b.monthsToMaturity = 1);
    const stressedState = cloneBankState(initialState);
    (stressedState.fundingLadders[LiabilityProductType.WholesaleFundingLT] ?? []).forEach(b => b.monthsToMaturity = 1);

    const baseline = engine.step({
      state: baselineState,
      config: baseConfig,
      actions: [],
      shocks: [],
    }).nextState;

    const stressed = engine.step({
      state: stressedState,
      config: baseConfig,
      actions: [],
      shocks: [{ type: 'rolloverStress', accessMultiplier: 0.6, spreadBps: 150 }],
    }).nextState;

    const baselineSt = baseline.financial.balanceSheet.items.find(
      (item) => item.productType === LiabilityProductType.WholesaleFundingLT
    );
    const stressedSt = stressed.financial.balanceSheet.items.find(
      (item) => item.productType === LiabilityProductType.WholesaleFundingLT
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

    const strong = engine.step({
      state: strongState,
      config: baseConfig,
      actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'senior', targetAmount: requested, maxSpreadBps: 5000, tenorMonths: 36 }],
      shocks: [],
    });
    const stressed = engine.step({
      state: stressedState,
      config: baseConfig,
      actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'senior', targetAmount: requested, maxSpreadBps: 5000, tenorMonths: 36 }],
      shocks: [],
    });

    const strongExecution = strong.executions.capitalMarkets[0];
    const stressedExecution = stressed.executions.capitalMarkets[0];
    expect(stressedExecution.executedAmount).toBeLessThan(strongExecution.executedAmount);
    expect(stressedExecution.demandAmount).toBeLessThan(strongExecution.demandAmount);
    expect(stressedExecution.clearingSpreadBps ?? 0).toBeGreaterThan(strongExecution.clearingSpreadBps ?? 0);
  });
});

describe('Contractual funding interest accrual', () => {
  const configWithoutDepositFlows = {
    ...baseConfig,
    featureFlags: {
      ...baseConfig.featureFlags,
      depositSegmentation: false,
    },
  };

  it('does not reprice existing fixed-term deposits when the offer changes without new deposits', () => {
    const engine = createSimulationEngine();
    const baselineState = cloneBankState(initialState);
    const repricedState = cloneBankState(initialState);

    const baseline = engine.step({
      state: baselineState,
      config: configWithoutDepositFlows,
      actions: [],
      shocks: [],
    }).nextState;

    const repriced = engine.step({
      state: repricedState,
      config: configWithoutDepositFlows,
      actions: [
        {
          type: 'adjustRate',
          productType: LiabilityProductType.RetailTermDeposits,
          newRate: 0.028,
        },
      ],
      shocks: [],
    }).nextState;

    const repricedBuckets = repriced.fundingLadders[LiabilityProductType.RetailTermDeposits] ?? [];
    expect(repricedBuckets.length).toBeGreaterThan(0);
    expect(repricedBuckets.every((bucket) => Math.abs(bucket.rate - 0.038) < 1e-12)).toBe(true);
    expect(repriced.financial.incomeStatement.interestExpense).toBeCloseTo(
      baseline.financial.incomeStatement.interestExpense,
      6
    );
  });

  it('charges the maturing bucket coupon for its final month before removing it', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);
    const termLine = state.financial.balanceSheet.items.find(
      (item) => item.productType === LiabilityProductType.RetailTermDeposits
    );
    if (!termLine) throw new Error('Missing fixed-term deposit line');

    state.financial.balanceSheet.items
      .filter((item) => item.side === 'Liability' && item.productType !== LiabilityProductType.RetailTermDeposits)
      .forEach((item) => { item.interestRate = 0; });
    Object.values(state.fundingLadders).forEach((buckets) =>
      buckets?.forEach((bucket) => { bucket.rate = 0; })
    );

    termLine.balance = 1.5e9;
    termLine.interestRate = 0.01;
    state.fundingLadders[LiabilityProductType.RetailTermDeposits] = [
      { tenorMonths: 12, monthsToMaturity: 1, notional: 0.5e9, rate: 0.05 },
      { tenorMonths: 12, monthsToMaturity: 12, notional: 1.0e9, rate: 0.02 },
    ];

    const next = engine.step({
      state,
      config: configWithoutDepositFlows,
      actions: [],
      shocks: [],
    }).nextState;

    const remaining = next.fundingLadders[LiabilityProductType.RetailTermDeposits] ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].notional).toBeCloseTo(1.0e9, 2);
    expect(remaining[0].rate).toBeCloseTo(0.02, 12);
    expect(lineBalance(next, LiabilityProductType.RetailTermDeposits)).toBeCloseTo(1.0e9, 2);
    expect(next.financial.incomeStatement.interestExpense).toBeCloseTo((0.5e9 * 0.05 + 1.0e9 * 0.02) / 12, 2);
  });
});

describe('Funding maturity ordering', () => {
  const quietConfig = {
    ...baseConfig,
    featureFlags: {
      ...baseConfig.featureFlags,
      depositSegmentation: false,
      loanPipeline: false,
      conductRisk: false,
      irrbbHedges: false,
      securitiesAccounting: false,
      capitalPolicy: false,
    },
  };

  it('accrues STR interest for its full one-month life before repaying principal', () => {
    const engine = createSimulationEngine();
    const controlState = cloneBankState(initialState);
    const borrowingState = cloneBankState(initialState);
    const amount = 250e6;
    const rate = borrowingState.market.baseRate;

    const control = engine.step({
      state: controlState,
      config: quietConfig,
      actions: [],
      shocks: [],
    }).nextState;

    const result = engine.step({
      state: borrowingState,
      config: quietConfig,
      actions: [{ type: 'drawBoeFunding', facility: 'STR', amount }],
      shocks: [],
    });
    const next = result.nextState;

    expect(next.financial.incomeStatement.interestExpense - control.financial.incomeStatement.interestExpense)
      .toBeCloseTo(amount * rate / 12, 2);
    expect(lineBalance(next, LiabilityProductType.BankOfEnglandFunding)).toBeCloseTo(0, 2);
    expect(next.fundingLadders[LiabilityProductType.BankOfEnglandFunding] ?? []).toHaveLength(0);

    const gilts = next.financial.balanceSheet.items.find((item) => item.productType === 'Gilts');
    expect(gilts?.encumbrance?.encumberedAmount ?? 0).toBeCloseTo(0, 2);
    expect(result.events.some((event) => event.message.includes('STR drawing'))).toBe(true);
    expect(result.events.some((event) => event.message.includes('Bank of England secured funding matured'))).toBe(true);
  });

  it('accrues the final coupon on wholesale funding before month-end rollover', () => {
    const engine = createSimulationEngine();
    const state = cloneBankState(initialState);
    const wholesale = state.financial.balanceSheet.items.find(
      (item) => item.productType === LiabilityProductType.WholesaleFundingLT
    );
    if (!wholesale) throw new Error('Missing wholesale funding line');

    state.financial.balanceSheet.items
      .filter((item) => item.side === 'Liability' && item.productType !== LiabilityProductType.WholesaleFundingLT)
      .forEach((item) => {
        item.balance = 0;
        item.interestRate = 0;
      });
    Object.keys(state.fundingLadders).forEach((key) => {
      state.fundingLadders[key as LiabilityProductType] = [];
    });

    wholesale.balance = 600e6;
    wholesale.interestRate = 0.01;
    state.fundingLadders[LiabilityProductType.WholesaleFundingLT] = [
      { tenorMonths: 36, monthsToMaturity: 1, notional: 600e6, rate: 0.06 },
    ];

    const next = engine.step({
      state,
      config: quietConfig,
      actions: [],
      shocks: [],
    }).nextState;

    expect(next.financial.incomeStatement.interestExpense).toBeCloseTo(600e6 * 0.06 / 12, 2);
    expect(next.fundingLadders[LiabilityProductType.WholesaleFundingLT] ?? []).not.toHaveLength(0);
  });
});

