from pathlib import Path

sim = Path('src/engine/simulation.ts')
text = sim.read_text()
old = "  const interestExpense = liabilities.reduce((sum, l) => sum + l.balance * l.interestRate * dtYears, 0);"
new = """  const interestExpense = liabilities.reduce((sum, liability) => {
    const buckets = state.fundingLadders?.[liability.productType] ?? [];
    if (buckets.length === 0) {
      return sum + liability.balance * liability.interestRate * dtYears;
    }

    const contractualNotional = buckets.reduce(
      (bucketSum, bucket) => bucketSum + Math.max(0, bucket.notional),
      0
    );
    const contractualExpense = buckets.reduce(
      (bucketSum, bucket) =>
        bucketSum + Math.max(0, bucket.notional) * Math.max(0, bucket.rate) * dtYears,
      0
    );
    const unbucketedBalance = Math.max(0, liability.balance - contractualNotional);

    return sum + contractualExpense + unbucketedBalance * liability.interestRate * dtYears;
  }, 0);"""
if old not in text:
    raise SystemExit('interest expense accrual anchor not found')
sim.write_text(text.replace(old, new, 1))

test = Path('src/engine/fundingLadder.test.ts')
test_text = test.read_text()
block = r'''

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

  it('uses the surviving bucket coupon after one fixed-term deposit bucket matures', () => {
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
    expect(next.financial.incomeStatement.interestExpense).toBeCloseTo(1.0e9 * 0.02 / 12, 2);
  });
});
'''
if "describe('Contractual funding interest accrual'" in test_text:
    raise SystemExit('tests already present')
test.write_text(test_text.rstrip() + block + '\n')

loan_test = Path('src/engine/loanCohorts.test.ts')
loan_text = loan_test.read_text()
old_expectation = """    const feeIncome = 0.001 * mortgages.balance;
    expect(capitalClose.operatingCashDeltaApplied).toBeCloseTo(feeIncome, 12);

    const cashAfterClose = cash.balance;
    expect(cashAfterClose - cashBeforeClose).toBeCloseTo(capitalClose.operatingCashDeltaApplied, 12);
    expect(cashAfterClose - cashAfterLoanCashflows).toBeCloseTo(feeIncome, 12);"""
new_expectation = """    const feeIncome = 0.001 * mortgages.balance;
    const expectedOperatingCashDelta = feeIncome - accruals.interestExpense;
    expect(capitalClose.operatingCashDeltaApplied).toBeCloseTo(expectedOperatingCashDelta, 12);

    const cashAfterClose = cash.balance;
    expect(cashAfterClose - cashBeforeClose).toBeCloseTo(capitalClose.operatingCashDeltaApplied, 12);
    expect(cashAfterClose - cashAfterLoanCashflows).toBeCloseTo(expectedOperatingCashDelta, 12);"""
if old_expectation not in loan_text:
    raise SystemExit('loan cash-flow expectation anchor not found')
loan_test.write_text(loan_text.replace(old_expectation, new_expectation, 1))
