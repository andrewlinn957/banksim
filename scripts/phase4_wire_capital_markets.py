from pathlib import Path

p = Path('src/engine/simulation.ts')
s = p.read_text()

old = """  IssueTier2Action,\n  DrawBoeFundingAction,"""
new = """  IssueTier2Action,\n  LaunchCapitalMarketsTransactionAction,\n  DrawBoeFundingAction,"""
assert old in s
s = s.replace(old, new, 1)

old = """import { bankThreeYearPlanMetricRegistry } from './threeYearPlanMetrics';\n"""
new = """import { bankThreeYearPlanMetricRegistry } from './threeYearPlanMetrics';\nimport { buildCapitalMarketsBook } from './capitalMarkets';\nimport type { CapitalMarketsBookbuildResult } from '../domain/capitalMarkets';\n"""
assert old in s
s = s.replace(old, new, 1)

old = """  issueTier2: (action: IssueTier2Action, ctx) => { applyIssueTier2(ctx.state,ctx.config,action.amount,action.maturityMonths,ctx.events); },\n  drawBoeFunding:"""
new = """  issueTier2: (action: IssueTier2Action, ctx) => { applyIssueTier2(ctx.state,ctx.config,action.amount,action.maturityMonths,ctx.events); },\n  launchCapitalMarketsTransaction: (action: LaunchCapitalMarketsTransactionAction, ctx) => {\n    const book = buildCapitalMarketsBook(ctx.state, ctx.config, {\n      instrument: action.instrument,\n      targetAmount: action.targetAmount,\n      maxDiscount: action.maxDiscount,\n      maxSpreadBps: action.maxSpreadBps,\n      tenorMonths: action.tenorMonths,\n    });\n    settleCapitalMarketsBookbuild(ctx.state, ctx.config, book, ctx.events);\n    ctx.executions.capitalMarkets.push({ kind: 'capitalMarkets', ...book });\n  },\n  drawBoeFunding:"""
assert old in s
s = s.replace(old, new, 1)

marker = """const applyBoeFunding = (state: BankState, config: SimulationConfig, facility: 'STR'|'ILTR', amount: number, events: SimulationEvent[]): void => {"""
assert marker in s
settlement = r'''const capitalMarketsPricingLabel = (book: CapitalMarketsBookbuildResult): string =>
  book.pricingKind === 'discount'
    ? `${((book.clearingDiscount ?? 0) * 100).toFixed(1)}% discount`
    : `${(book.clearingSpreadBps ?? 0).toFixed(0)}bp spread`;

const settleCapitalMarketsBookbuild = (
  state: BankState,
  config: SimulationConfig,
  book: CapitalMarketsBookbuildResult,
  events: SimulationEvent[]
): void => {
  state.capitalMarkets ??= { transactions: [] };
  state.capitalMarkets.transactions.push({
    ...book,
    step: state.time.step,
    date: state.time.date.toISOString(),
  });

  const instrumentLabel = book.instrument === 'cet1' ? 'CET1 equity' : book.instrument === 'at1' ? 'AT1' : book.instrument === 'tier2' ? 'Tier 2' : 'senior unsecured';
  if (book.executedAmount <= 0) {
    const reason = book.status === 'failed-price' ? 'management price limit was inside the clearing level' : 'insufficient market demand';
    events.push(createEvent('warning', `${instrumentLabel} bookbuild failed: ${reason}; demand ${(book.demandAmount / 1e6).toFixed(0)}m for target ${(book.targetAmount / 1e6).toFixed(0)}m`, ['capital','funding','market']));
    return;
  }

  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;

  if (book.instrument === 'cet1') {
    ensureEquityMarketState(state, config);
    state.financial.capital.cet1 += book.netProceeds;
    cash.balance += book.netProceeds;
    const issuePrice = Math.max(1e-6, book.issuePrice ?? state.equityMarket.sharePrice);
    state.equityMarket.sharesOutstanding += book.grossProceeds / issuePrice;
    state.equityMarket.marketCap = state.equityMarket.sharePrice * state.equityMarket.sharesOutstanding;
  } else if (book.instrument === 'at1') {
    const oldBalance = Math.max(0, state.financial.capital.at1);
    const oldCoupon = state.capitalMarkets.at1CouponRateAnnual ?? config.riskLimits.capitalPolicy.at1CouponRateAnnual;
    const newCoupon = Math.max(0, (book.marketReferenceRate ?? state.market.riskFreeLong) + (book.clearingSpreadBps ?? 0) / 10000);
    state.financial.capital.at1 += book.netProceeds;
    cash.balance += book.netProceeds;
    state.capitalMarkets.at1CouponRateAnnual = blendRate(oldBalance, oldCoupon, book.netProceeds, newCoupon);
  } else if (book.instrument === 'tier2') {
    const rate = Math.max(0, (book.marketReferenceRate ?? state.market.riskFreeLong) + (book.clearingSpreadBps ?? 0) / 10000);
    const tenor = Math.max(60, Math.round(book.tenorMonths ?? 60));
    const line = ensureLineItem(state, BalanceSheetSide.Liability, LiabilityProductType.Tier2Debt, 'Tier 2 Subordinated Debt', rate, config);
    genericFundingBuckets(state, LiabilityProductType.Tier2Debt).push({ tenorMonths: tenor, monthsToMaturity: tenor, notional: book.executedAmount, rate });
    line.balance += book.executedAmount;
    line.interestRate = blendRate(Math.max(0, line.balance - book.executedAmount), line.interestRate, book.executedAmount, rate);
    state.financial.capital.tier2 = (state.financial.capital.tier2 ?? 0) + book.executedAmount;
    cash.balance += book.executedAmount;
  } else {
    const rate = Math.max(0, (book.marketReferenceRate ?? state.market.riskFreeLong) + (book.clearingSpreadBps ?? 0) / 10000);
    const tenor = getDefaultRefinanceTenorMonths(config, LiabilityProductType.WholesaleFundingLT, book.tenorMonths);
    addFundingBucket(state, LiabilityProductType.WholesaleFundingLT, book.executedAmount, rate, tenor);
    syncFundingLineFromLadder(state, config, LiabilityProductType.WholesaleFundingLT);
    cash.balance += book.executedAmount;
  }

  events.push(createEvent(
    book.status === 'partial' ? 'warning' : 'info',
    `${instrumentLabel} bookbuild ${book.status}: target ${(book.targetAmount / 1e6).toFixed(0)}m, demand ${(book.demandAmount / 1e6).toFixed(0)}m (${book.coverageRatio.toFixed(2)}x), executed ${(book.executedAmount / 1e6).toFixed(0)}m at ${capitalMarketsPricingLabel(book)}`,
    ['capital','funding','market']
  ));
};

'''
s = s.replace(marker, settlement + marker, 1)

old = """    state.financial.capital.at1 * config.riskLimits.capitalPolicy.at1CouponRateAnnual * dtYears"""
new = """    state.financial.capital.at1 * (state.capitalMarkets?.at1CouponRateAnnual ?? config.riskLimits.capitalPolicy.at1CouponRateAnnual) * dtYears"""
assert old in s
s = s.replace(old, new, 1)

p.write_text(s)
