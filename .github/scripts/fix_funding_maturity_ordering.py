from pathlib import Path

sim = Path('src/engine/simulation.ts')
text = sim.read_text()

old_order = """    applyActions(state, activeConfig, actions, events);
    stepContractualRetailFunding(state, activeConfig, dtMonths, events);
    applyTreasuryPolicy(state, activeConfig, events);
    stepCompetitorReaction(state, activeConfig, dtMonths, events);
    const fundingLifecycle = featureFlags.fundingLadder
      ? stepFundingLadders(state, activeConfig, dtMonths, shockEffects, events)
      : {
          maturingNotional: 0,
          refinancedNotional: 0,
          shortfallNotional: 0,
          weightedRefinanceRate: 0,
          effectiveAccess: 1,
        };
    if (featureFlags.depositSegmentation) {
"""
new_order = """    applyActions(state, activeConfig, actions, events);
    applyTreasuryPolicy(state, activeConfig, events);
    stepCompetitorReaction(state, activeConfig, dtMonths, events);
    if (featureFlags.depositSegmentation) {
"""
if old_order not in text:
    raise SystemExit('step-order anchor not found')
text = text.replace(old_order, new_order, 1)

close_anchor = """    capitalClose.operatingCashDelta -= cohortStep.nonCashInterest;
    computeMetrics(state, activeConfig, shockEffects.lcrOutflowMultiplier, events, true, false);
"""
close_replacement = """    capitalClose.operatingCashDelta -= cohortStep.nonCashInterest;

    // Funding drawn or outstanding during this step remains on balance sheet for the month's
    // business activity and P&L accrual. Contractual principal maturities and wholesale rollover
    // are settled at month-end, after interest for the maturity month has been recognised.
    stepContractualRetailFunding(state, activeConfig, dtMonths, events);
    const fundingLifecycle = featureFlags.fundingLadder
      ? stepFundingLadders(state, activeConfig, dtMonths, shockEffects, events)
      : {
          maturingNotional: 0,
          refinancedNotional: 0,
          shortfallNotional: 0,
          weightedRefinanceRate: 0,
          effectiveAccess: 1,
        };

    computeMetrics(state, activeConfig, shockEffects.lcrOutflowMultiplier, events, true, false);
"""
if close_anchor not in text:
    raise SystemExit('capital-close anchor not found')
text = text.replace(close_anchor, close_replacement, 1)
sim.write_text(text)

test = Path('src/engine/fundingLadder.test.ts')
test_text = test.read_text()
old_desc = "it('uses the surviving bucket coupon after one fixed-term deposit bucket matures', () => {"
new_desc = "it('charges the maturing bucket coupon for its final month before removing it', () => {"
if old_desc not in test_text:
    raise SystemExit('term maturity test description anchor not found')
test_text = test_text.replace(old_desc, new_desc, 1)
old_expect = "expect(next.financial.incomeStatement.interestExpense).toBeCloseTo(1.0e9 * 0.02 / 12, 2);"
new_expect = "expect(next.financial.incomeStatement.interestExpense).toBeCloseTo((0.5e9 * 0.05 + 1.0e9 * 0.02) / 12, 2);"
if old_expect not in test_text:
    raise SystemExit('term maturity expectation anchor not found')
test_text = test_text.replace(old_expect, new_expect, 1)

extra = r'''

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
'''
if "describe('Funding maturity ordering'" in test_text:
    raise SystemExit('funding maturity ordering tests already present')
test.write_text(test_text.rstrip() + extra + '\n')
