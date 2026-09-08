from pathlib import Path

def rep(path, old, new, count=1):
    p=Path(path); text=p.read_text()
    if old not in text: raise RuntimeError(f'pattern not found {path}: {old[:180]!r}')
    p.write_text(text.replace(old,new,count))

# New one-off transactions must clear after a monthly close just like equity, LT debt and swaps.
rep('src/App.tsx',
"    setActionForm(prev => ({ ...prev, issueLTDebtAmount: '', issueEquityAmount: '', hedgeDirection: 'none', hedgeNotional: '' }));",
"    setActionForm(prev => ({\n      ...prev,\n      issueLTDebtAmount: '',\n      issueEquityAmount: '',\n      issueTier2Amount: '',\n      boeFacility: 'none',\n      boeFundingAmount: '',\n      hedgeDirection: 'none',\n      hedgeNotional: '',\n    }));")

# Do not manufacture a zero-balance ST wholesale line in the ordinary retail bank.
p='src/engine/simulation.ts'
rep(p,
"const ensureFundingLadderCoverage = (\n  state: BankState,\n  config: SimulationConfig,\n  productType: FundingProduct\n): void => {\n  const line = ensureLineItem(\n    state,\n    BalanceSheetSide.Liability,\n    productType,\n    getFundingLineLabel(productType),\n    productType === LiabilityProductType.WholesaleFundingST\n      ? state.market.riskFreeShort + state.market.wholesaleFundingSpread\n      : state.market.riskFreeLong + state.market.seniorDebtSpread,\n    config\n  );\n  const buckets = getFundingLadderBuckets(state, productType);",
"const ensureFundingLadderCoverage = (\n  state: BankState,\n  config: SimulationConfig,\n  productType: FundingProduct\n): void => {\n  const buckets = getFundingLadderBuckets(state, productType);\n  const existingLine = findItem(state.financial.balanceSheet, productType);\n  if (!existingLine && buckets.length === 0) return;\n  const line = existingLine ?? ensureLineItem(\n    state,\n    BalanceSheetSide.Liability,\n    productType,\n    getFundingLineLabel(productType),\n    productType === LiabilityProductType.WholesaleFundingST\n      ? state.market.riskFreeShort + state.market.wholesaleFundingSpread\n      : state.market.riskFreeLong + state.market.seniorDebtSpread,\n    config\n  );")

# Permanent engine regression for the uncluttered default funding structure.
p='src/engine/smallRetailBank.test.ts'
rep(p,
"  it('replenishes competitively priced fixed-term savings as contractual buckets mature', () => {",
"  it('does not add an unused short-term wholesale line during an ordinary close', () => {\n    const out = engine.step({ state: cloneBankState(initialState), config: baseConfig, shocks: [], actions: [] }).nextState;\n    expect(out.financial.balanceSheet.items.some(i => i.productType === L.WholesaleFundingST)).toBe(false);\n  });\n\n  it('replenishes competitively priced fixed-term savings as contractual buckets mature', () => {")

print('browser playthrough findings patched')
