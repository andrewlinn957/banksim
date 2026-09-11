from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing expected block: {label}')
    return text.replace(old, new, 1)


# Preserve the non-finite transaction guardrail on the current capital-markets API.
capital_markets_path = Path('src/engine/capitalMarkets.ts')
capital_markets = capital_markets_path.read_text()
capital_markets = replace_once(
    capital_markets,
    '  const targetAmount = Math.max(0, order.targetAmount);',
    '  const targetAmount = Number.isFinite(order.targetAmount) ? Math.max(0, order.targetAmount) : 0;',
    'finite capital-markets target amount',
)
capital_markets_path.write_text(capital_markets)


transactions_path = Path('src/ui/transactions.test.ts')
transactions = transactions_path.read_text()
transactions = replace_once(
    transactions,
    "const actions:PlayerAction[]=[{type:'issueEquity',amount:10e6},{type:'enterHedge',direction:'payFixedReceiveFloat',notional:10e6,fixedRate:.03,maturityMonths:24},{type:'setCapitalPolicy',dividendPayoutRatio:0,at1CouponMode:'skip'}];",
    "const actions:PlayerAction[]=[{type:'launchCapitalMarketsTransaction',instrument:'cet1',targetAmount:10e6,maxDiscount:.5},{type:'enterHedge',direction:'payFixedReceiveFloat',notional:10e6,fixedRate:.03,maturityMonths:24},{type:'setCapitalPolicy',dividendPayoutRatio:0,at1CouponMode:'skip'}];",
    'autopilot equity action',
)
transactions = replace_once(
    transactions,
    "expect(result.timeline.flatMap(t=>t.actions).filter(a=>a.type==='issueEquity')).toHaveLength(1);",
    "expect(result.timeline.flatMap(t=>t.actions).filter(a=>a.type==='launchCapitalMarketsTransaction')).toHaveLength(1);",
    'autopilot equity timeline assertion',
)
transactions_path.write_text(transactions)


accounting_path = Path('src/engine/accountingIntegrity.test.ts')
accounting = accounting_path.read_text()
accounting = replace_once(
    accounting,
    "applyActions(s, baseConfig, [{ type: 'issueEquity', amount: Infinity }], []);",
    "applyActions(s, baseConfig, [{ type: 'launchCapitalMarketsTransaction', instrument: 'cet1', targetAmount: Infinity, maxDiscount: 0.5 }], []);",
    'non-finite equity transaction test',
)
accounting_path.write_text(accounting)


# The cleanup script should scan deleted action discriminants, not current UI field names
# such as issueEquityAmount / issueTier2Amount.
cleanup_path = Path('scripts/cleanup_legacy_compat.py')
cleanup = cleanup_path.read_text()
old_scan = """# Fail before tests if deleted compatibility vocabulary remains anywhere in TS sources.
for token in ['issueDebt', 'issueEquity', 'issueTier2', 'setTreasuryPolicy', 'maturityYears', 'FundingMaturityBucket']:
    hits = [str(source) for source in Path('src').rglob('*.ts*') if token in source.read_text()]
    if hits:
        raise SystemExit(f'deleted compatibility token {token} remains in: {hits}')
"""
new_scan = """# Fail before tests if deleted compatibility action discriminants or schema names remain.
deleted_action = re.compile(r\"type\\s*:\\s*['\\\"](?:issueDebt|issueEquity|issueTier2|setTreasuryPolicy)['\\\"]\")
action_hits = [str(source) for source in Path('src').rglob('*.ts*') if deleted_action.search(source.read_text())]
if action_hits:
    raise SystemExit(f'deleted compatibility actions remain in: {action_hits}')
for token in ['maturityYears', 'FundingMaturityBucket']:
    hits = [str(source) for source in Path('src').rglob('*.ts*') if token in source.read_text()]
    if hits:
        raise SystemExit(f'deleted compatibility token {token} remains in: {hits}')
"""
cleanup = replace_once(cleanup, old_scan, new_scan, 'compatibility vocabulary scan')
cleanup_path.write_text(cleanup)
