from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing expected block: {label}')
    return text.replace(old, new, 1)


# Remove obsolete compatibility paths from the central simulation engine.
path = Path('src/engine/simulation.ts')
text = path.read_text()
text = replace_once(
    text,
    "import { BankState, FundingMaturityBucket, InterestRateHedge } from '../domain/bankState';",
    "import { BankState, ContractualMaturityBucket, InterestRateHedge } from '../domain/bankState';",
    'bank state imports',
)

for line in [
    '  IssueDebtAction,\n',
    '  IssueEquityAction,\n',
    '  IssueTier2Action,\n',
    '  SetTreasuryPolicyAction,\n',
]:
    text = replace_once(text, line, '', f'legacy action import {line.strip()}')

text = replace_once(
    text,
    """  issueEquity: (action: IssueEquityAction, ctx) => {
    applyIssueEquity(ctx.state, ctx.config, action.amount, ctx.events);
  },
  issueDebt: (action: IssueDebtAction, ctx) => {
    applyIssueDebt(
      ctx.state,
      ctx.config,
      action.productType,
      action.amount,
      action.rate,
      action.maturityMonths,
      ctx.events
    );
  },
""",
    '',
    'legacy equity/debt handlers',
)
text = replace_once(
    text,
    """  buySellAsset: (action: BuySellAssetAction, ctx) => {
    const tenorMonths = action.tenorMonths ?? (action.maturityYears !== undefined ? Math.round(action.maturityYears * 12) : undefined);
    const execution = applyBuySellAsset(ctx.state, ctx.config, action.productType, action.amountDelta, ctx.events, tenorMonths);
    if (execution) ctx.executions.assetTrades.push(execution);
  },
  issueTier2: (action: IssueTier2Action, ctx) => { applyIssueTier2(ctx.state,ctx.config,action.amount,action.maturityMonths,ctx.events); },
""",
    """  buySellAsset: (action: BuySellAssetAction, ctx) => {
    const execution = applyBuySellAsset(ctx.state, ctx.config, action.productType, action.amountDelta, ctx.events, action.tenorMonths);
    if (execution) ctx.executions.assetTrades.push(execution);
  },
""",
    'asset tenor bridge and tier2 handler',
)
text = replace_once(
    text,
    """  setTreasuryPolicy: (action: SetTreasuryPolicyAction, ctx) => {
    const nextPolicy = {
      giltShareOfHqla: clamp(action.giltShareOfHqla, 0, 1),
      giltDurationYears: clamp(action.giltDurationYears, .25, 15),
    };
    const previous = ctx.state.behaviour.treasuryPolicy;
    const changed =
      !previous ||
      Math.abs(previous.giltShareOfHqla - nextPolicy.giltShareOfHqla) > 1e-9 ||
      Math.abs(previous.giltDurationYears - nextPolicy.giltDurationYears) > 1e-9;
    ctx.state.behaviour.treasuryPolicy = nextPolicy;
    // Treasury allocation changes are player actions. A standing policy is not silently
    // re-applied every month, preserving the consequences of choosing to do nothing.
    if (changed) {
      const execution = applyTreasuryPolicy(ctx.state, ctx.config, ctx.events);
      if (execution) ctx.executions.assetTrades.push(execution);
    }
  },
""",
    '',
    'legacy treasury policy handler',
)

patterns = [
    (r"\nconst applyIssueEquity = \([\s\S]*?\n\};\n\n// Weighted-average rate", "\n// Weighted-average rate", 'legacy equity helper'),
    (r"\nconst applyIssueDebt = \([\s\S]*?\n\};\n\nconst genericFundingBuckets", "\nconst genericFundingBuckets", 'legacy debt helper'),
    (r"\nconst applyIssueTier2 = \([\s\S]*?\n\};\n\nconst capitalMarketsPricingLabel", "\nconst capitalMarketsPricingLabel", 'legacy tier2 helper'),
    (r"\nconst applyTreasuryPolicy = \([\s\S]*?\n\};\n\nconst stepContractualRetailFunding", "\nconst stepContractualRetailFunding", 'legacy treasury helper'),
]
for pattern, replacement, label in patterns:
    text, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise SystemExit(f'expected one {label}, found {count}')

text = text.replace('FundingMaturityBucket', 'ContractualMaturityBucket')
text = replace_once(
    text,
    """  if (!state.fundingLadders) {
    state.fundingLadders = {};
  }
""",
    '',
    'funding ladder save fallback',
)
text = replace_once(text, '  state.fundingLadders ??= {};\n', '', 'generic funding ladder save fallback')
text = replace_once(
    text,
    '  // Legacy saved games with an existing line, or products with real maturity buckets, still work normally.\n',
    '  // Existing positions or products with real maturity buckets are synchronized normally.\n',
    'saved-game comment',
)
text = replace_once(
    text,
    """  if (!state.loanPipelines) {
    state.loanPipelines = {};
  }
""",
    '',
    'loan pipeline save fallback',
)
text = replace_once(
    text,
    '  const nextIndex = (state.financial.hedges?.length ?? 0) + 1;\n',
    '  const nextIndex = state.financial.hedges.length + 1;\n',
    'hedge length save fallback',
)
text = replace_once(
    text,
    """  if (!state.financial.hedges) {
    state.financial.hedges = [];
  }
""",
    '',
    'hedge collection save fallback',
)
text = replace_once(text, '  const hedges = state.financial.hedges ?? [];\n', '  const hedges = state.financial.hedges;\n', 'hedge step save fallback')
text = replace_once(
    text,
    '    const buckets = state.fundingLadders?.[liability.productType] ?? [];\n',
    '    const buckets = state.fundingLadders[liability.productType] ?? [];\n',
    'funding ladder optional access',
)
text = replace_once(
    text,
    '  const workoutPipelineStock = Object.values(state.workoutPipelines ?? {}).reduce(\n',
    '  const workoutPipelineStock = Object.values(state.workoutPipelines).reduce(\n',
    'workout pipeline save fallback',
)

for symbol in [
    'FundingMaturityBucket', 'IssueDebtAction', 'IssueEquityAction', 'IssueTier2Action',
    'SetTreasuryPolicyAction', 'action.maturityYears', 'applyIssueDebt(', 'applyIssueEquity(',
    'applyIssueTier2(', 'applyTreasuryPolicy(',
]:
    if symbol in text:
        raise SystemExit(f'obsolete simulation symbol remains: {symbol}')
path.write_text(text)


# Current recommendation engine emits only current PlayerAction variants.
recommendations = Path('src/engine/recommendations.ts')
rec = recommendations.read_text()
rec = rec.replace("import { AssetProductType, LiabilityProductType } from '../domain/enums';", "import { AssetProductType } from '../domain/enums';")
rec = replace_once(
    rec,
    "actions: [{ type: 'issueEquity', amount: 2e9 }],",
    "actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'cet1', targetAmount: 2e9, maxDiscount: 0.5 }],",
    'legacy equity recommendation',
)
rec = replace_once(
    rec,
    """        {
          type: 'issueDebt',
          productType: LiabilityProductType.WholesaleFundingLT,
          amount: 5e9,
          maturityMonths: 36,
        },""",
    """        {
          type: 'launchCapitalMarketsTransaction',
          instrument: 'senior',
          targetAmount: 5e9,
          maxSpreadBps: 2500,
          tenorMonths: 36,
        },""",
    'legacy senior-debt recommendation',
)
recommendations.write_text(rec)


suite_path = Path('src/engine/simulationTestSuite.ts')
suite = suite_path.read_text()
suite = replace_once(
    suite,
    "{ type: 'issueDebt', productType: LiabilityProductType.WholesaleFundingST, amount: 20e9, rate: 0.055 },",
    "{ type: 'launchCapitalMarketsTransaction', instrument: 'senior', targetAmount: 20e9, maxSpreadBps: 2500, tenorMonths: 24 },",
    'legacy simulation-suite debt action',
)
suite_path.write_text(suite)


# Funding confidence is now tested at the capital-markets execution layer.
funding_path = Path('src/engine/fundingLadder.test.ts')
funding = funding_path.read_text()
old_funding = re.compile(r"  it\('confidence state applies stepwise spread/access penalties to issuance', \(\) => \{[\s\S]*?\n  \}\);\n", re.M)
new_funding = """  it('confidence state applies stepwise spread/access penalties to issuance', () => {
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
"""
funding, count = old_funding.subn(new_funding, funding, count=1)
if count != 1:
    raise SystemExit('could not migrate funding confidence test')
funding_path.write_text(funding)


# Replace correctness tests for the removed direct-debt helper with current bookbuild guardrails.
correctness_path = Path('src/engine/simulationCorrectness.test.ts')
correctness = correctness_path.read_text()
first_two = re.compile(
    r"  it\('uses confidence-adjusted market default pricing when issuing debt without explicit rate override', \(\) => \{[\s\S]*?\n  \}\);\n\n  it\('respects explicit debt issuance rate override even in stressed confidence state', \(\) => \{[\s\S]*?\n  \}\);\n",
    re.M,
)
replacement = """  it('uses confidence-adjusted market pricing for senior issuance', () => {
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
"""
correctness, count = first_two.subn(replacement, correctness, count=1)
if count != 1:
    raise SystemExit('could not migrate simulation correctness debt tests')
correctness_path.write_text(correctness)


share_path = Path('src/engine/sharePrice.test.ts')
share = share_path.read_text()
share = replace_once(
    share,
    "actions: [{ type: 'issueEquity', amount: 0.2e9 }],",
    "actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'cet1', targetAmount: 0.2e9, maxDiscount: 0.5 }],",
    'legacy equity dilution test',
)
share_path.write_text(share)


small_path = Path('src/engine/smallRetailBank.test.ts')
small = small_path.read_text()
small = replace_once(
    small,
    "actions: [{ type: 'setTreasuryPolicy', giltShareOfHqla: 0.4, giltDurationYears: 2 }],",
    "actions: [{ type: 'buySellAsset', productType: A.Gilts, amountDelta: 100e6, tenorMonths: 24 }],",
    'legacy treasury-policy test action',
)
small = replace_once(
    small,
    "    expect(out.behaviour.treasuryPolicy?.giltDurationYears).toBe(2);",
    "    expect(balance(out, A.Gilts)).toBeGreaterThan(gilts0);\n    expect((out.assetMaturityLadders?.[A.Gilts] ?? []).some(bucket => bucket.tenorMonths === 24)).toBe(true);",
    'legacy treasury-policy test assertion',
)
small = replace_once(
    small,
    "actions: [{ type: 'issueTier2', amount: 150e6, maturityMonths: 60 }],",
    "actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'tier2', targetAmount: 150e6, maxSpreadBps: 2500, tenorMonths: 60 }],",
    'legacy small-bank Tier 2 action',
)
small_path.write_text(small)


tier2_path = Path('src/engine/tier2Requirement.test.ts')
tier2 = tier2_path.read_text()
tier2 = replace_once(
    tier2,
    """    const result = engine.step({
      state: cloneBankState(initialState),
      config: quietConfig,
      actions: [{ type: 'issueTier2', amount, maturityMonths: 60 }],
      shocks: [],
    }).nextState;

    const metrics = result.risk.riskMetrics;
    const eligibleTier2 = eligibleTier2OwnFunds(result);""",
    """    const issuance = engine.step({
      state: cloneBankState(initialState),
      config: quietConfig,
      actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'tier2', targetAmount: amount, maxSpreadBps: 2500, tenorMonths: 60 }],
      shocks: [],
    });
    const result = issuance.nextState;
    const executedAmount = issuance.executions.capitalMarkets[0].executedAmount;

    const metrics = result.risk.riskMetrics;
    const eligibleTier2 = eligibleTier2OwnFunds(result);""",
    'first Tier 2 requirement issuance',
)
tier2 = replace_once(
    tier2,
    "    expect(eligibleTier2).toBeCloseTo(amount, 2);",
    "    expect(executedAmount).toBeGreaterThan(0);\n    expect(eligibleTier2).toBeCloseTo(executedAmount, 2);",
    'Tier 2 issuance amount assertion',
)
tier2 = replace_once(
    tier2,
    "actions: [{ type: 'issueTier2', amount: 500e6, maturityMonths: 60 }],",
    "actions: [{ type: 'launchCapitalMarketsTransaction', instrument: 'tier2', targetAmount: 500e6, maxSpreadBps: 2500, tenorMonths: 60 }],",
    'maturing Tier 2 issuance',
)
tier2_path.write_text(tier2)


# Fail before tests if deleted compatibility vocabulary remains anywhere in TS sources.
for token in ['issueDebt', 'issueEquity', 'issueTier2', 'setTreasuryPolicy', 'maturityYears', 'FundingMaturityBucket']:
    hits = [str(source) for source in Path('src').rglob('*.ts*') if token in source.read_text()]
    if hits:
        raise SystemExit(f'deleted compatibility token {token} remains in: {hits}')
