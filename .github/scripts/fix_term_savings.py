from pathlib import Path

def rep(path, old, new, count=1):
    p=Path(path); text=p.read_text()
    if old not in text: raise RuntimeError(f'pattern not found {path}: {old[:160]!r}')
    p.write_text(text.replace(old,new,count))

p='src/engine/simulation.ts'
rep(p,
"      const rawDesiredDelta = desiredBalance - before;\n      const desiredDelta = meta.behaviour.isTermDeposit ? Math.max(0, rawDesiredDelta) : rawDesiredDelta;",
"      const rawDesiredDelta = desiredBalance - before;\n      let desiredDelta = rawDesiredDelta;\n      if (meta.behaviour.isTermDeposit) {\n        // Fixed-term savings are a flow market, not a perpetually compounding stock.\n        // A competitive offer should replenish the monthly slice that matures even if\n        // the contractual stock has temporarily run down. Target the share of retail\n        // savings that customers choose to lock, then acquire toward that target at\n        // no more than roughly one maturity-ladder slice per month.\n        const instantSavings = Math.max(0, findItem(state.financial.balanceSheet, LiabilityProductType.RetailSavingsDeposits)?.balance ?? 0);\n        const rateAdvantage = laggedRate - competitor;\n        const targetTermShare = clamp(0.23 + 5 * rateAdvantage, 0.05, 0.45);\n        const targetTermStock = instantSavings * targetTermShare / Math.max(0.05, 1 - targetTermShare);\n        const tenor = Math.max(6, state.behaviour.termDepositTenorMonths ?? 12);\n        const acquisitionCapacity = targetTermStock / tenor * dtMonths * 1.25;\n        const gapToTarget = Math.max(0, targetTermStock - before);\n        desiredDelta = Math.min(gapToTarget, acquisitionCapacity);\n      }")

p='src/engine/smallRetailBank.test.ts'
rep(p,
"  it('lets Treasury change HQLA composition without creating assets', () => {",
"  it('replenishes competitively priced fixed-term savings as contractual buckets mature', () => {\n    let state = cloneBankState(initialState);\n    for (let month = 0; month < 18; month++) {\n      state = engine.step({\n        state, config: baseConfig, shocks: [],\n        actions: [\n          { type: 'adjustRate', productType: L.RetailTermDeposits, newRate: state.market.competitorTermDepositRate },\n          { type: 'setTermDepositPolicy', tenorMonths: 12 },\n        ],\n      }).nextState;\n    }\n    expect(balance(state, L.RetailTermDeposits)).toBeGreaterThan(0.8e9);\n    expect(balance(state, L.RetailTermDeposits)).toBeLessThan(2.5e9);\n    expect((state.fundingLadders[L.RetailTermDeposits] ?? []).length).toBeGreaterThan(5);\n  });\n\n  it('lets Treasury change HQLA composition without creating assets', () => {")

p='src/engine/modelRegression.test.ts'
rep(p,
"    expect(finalDeposits).toBeGreaterThan(openingDeposits * 0.6);",
"    expect(finalDeposits).toBeGreaterThan(openingDeposits * 0.6);\n    expect(productBalance(finalState, LiabilityProductType.RetailTermDeposits)).toBeGreaterThan(0.5e9);", count=1)
rep(p,
"    expect(finalDeposits).toBeGreaterThan(openingDeposits * 0.55);",
"    expect(finalDeposits).toBeGreaterThan(openingDeposits * 0.55);\n    expect(productBalance(finalState, LiabilityProductType.RetailTermDeposits)).toBeGreaterThan(0.35e9);", count=1)

print('fixed-term savings replenishment patch applied')
