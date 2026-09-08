from pathlib import Path


def rep(path, old, new, count=1):
    p=Path(path); text=p.read_text()
    if old not in text: raise RuntimeError(f'pattern not found {path}: {old[:120]!r}')
    p.write_text(text.replace(old,new,count))

# App compile fix: buildActionsFromParsed receives formState, not state.
rep('src/App.tsx', "if (state.boeFacility!=='none' && values.boeFundingAmount!==undefined && values.boeFundingAmount>0) actions.push({type:'drawBoeFunding',facility:state.boeFacility,amount:values.boeFundingAmount});", "if (formState.boeFacility!=='none' && values.boeFundingAmount!==undefined && values.boeFundingAmount>0) actions.push({type:'drawBoeFunding',facility:formState.boeFacility,amount:values.boeFundingAmount});")

# Funding confidence: make the new depositor-composition inputs typed and consequential.
p='src/engine/metrics.ts'
rep(p,
"  depositQualityIndex: number;\n  asf: number;\n  fundingMaturing12m: number;",
"  depositQualityIndex: number;\n  insuredRetailDepositShare: number;\n  largeDepositorShare: number;\n  termDepositShare: number;\n  asf: number;\n  fundingMaturing12m: number;")
rep(p,
"  const maturityStress = Math.max(0, args.fundingMaturing12m / Math.max(1, args.asf) - 0.42);\n\n  const fundingStressIndex =\n    liquidityStress * 0.28 +\n    nsfrStress * 0.2 +\n    capitalStress * 0.2 +\n    franchiseStress * 0.16 +\n    qualityStress * 0.1 +\n    maturityStress * 0.06;",
"  const maturityStress = Math.max(0, args.fundingMaturing12m / Math.max(1, args.asf) - 0.42);\n  const uninsuredStress = Math.max(0, 0.85 - clamp(args.insuredRetailDepositShare, 0, 1)) / 0.85;\n  const concentrationStress = clamp((args.largeDepositorShare - 0.05) / 0.15, 0, 1);\n  const termFundingRelief = clamp(args.termDepositShare / 0.25, 0, 1) * 0.025;\n\n  const fundingStressIndex = Math.max(0,\n    liquidityStress * 0.28 +\n    nsfrStress * 0.2 +\n    capitalStress * 0.2 +\n    franchiseStress * 0.16 +\n    qualityStress * 0.1 +\n    maturityStress * 0.06 +\n    uninsuredStress * 0.04 +\n    concentrationStress * 0.05 -\n    termFundingRelief\n  );")

# Recalibrate the 10-year regression around the redesigned product set and UI decisions.
p='src/engine/modelRegression.test.ts'
rep(p,
"const totalLoans = (state: BankState): number =>\n  productBalance(state, AssetProductType.Mortgages) + productBalance(state, AssetProductType.CorporateLoans);",
"const totalLoans = (state: BankState): number =>\n  productBalance(state, AssetProductType.Mortgages) +\n  productBalance(state, AssetProductType.ConsumerLoans) +\n  productBalance(state, AssetProductType.CorporateLoans);")
rep(p,
"  productBalance(state, LiabilityProductType.RetailSavingsDeposits) +\n  productBalance(state, LiabilityProductType.CorporateOperatingDeposits) +",
"  productBalance(state, LiabilityProductType.RetailSavingsDeposits) +\n  productBalance(state, LiabilityProductType.RetailTermDeposits) +\n  productBalance(state, LiabilityProductType.CorporateOperatingDeposits) +")
rep(p,
"  pricing: { mortgageDiscount?: number; corporateDiscount?: number } = {}\n): PlayerAction[] => {\n  const mortgageDiscount = pricing.mortgageDiscount ?? 0.004;\n  const corporateDiscount = pricing.corporateDiscount ?? 0.006;",
"  pricing: { mortgageDiscount?: number; consumerDiscount?: number; corporateDiscount?: number } = {}\n): PlayerAction[] => {\n  const mortgageDiscount = pricing.mortgageDiscount ?? 0.004;\n  const consumerDiscount = pricing.consumerDiscount ?? 0.0075;\n  const corporateDiscount = pricing.corporateDiscount ?? 0.006;")
rep(p,
"    {\n      type: 'adjustRate',\n      productType: AssetProductType.CorporateLoans,",
"    {\n      type: 'adjustRate',\n      productType: AssetProductType.ConsumerLoans,\n      newRate: Math.max(0, state.market.competitorConsumerLoanRate - consumerDiscount),\n    },\n    {\n      type: 'adjustRate',\n      productType: AssetProductType.CorporateLoans,", count=1)
rep(p,
"    { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: 0.15 },\n    { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: 0.15 },\n    { type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'auto' },",
"    { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: 0.15 },\n    { type: 'setUnderwriting', productType: AssetProductType.ConsumerLoans, tightness: 0.25 },\n    { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: 0.15 },\n    { type: 'setCapitalPolicy', dividendPayoutRatio: 0.2, at1CouponMode: 'auto' },")
rep(p,
"    actions.push(\n      { type: 'adjustRate', productType: LiabilityProductType.RetailTransactionalDeposits, newRate: retailRate },\n      { type: 'adjustRate', productType: LiabilityProductType.RetailSavingsDeposits, newRate: retailRate },",
"    const termRate = Math.max(0, state.market.competitorTermDepositRate + offset);\n    actions.push(\n      { type: 'adjustRate', productType: LiabilityProductType.RetailSavingsDeposits, newRate: retailRate },\n      { type: 'adjustRate', productType: LiabilityProductType.RetailTermDeposits, newRate: termRate },\n      { type: 'setTermDepositPolicy', tenorMonths: 12 },")
rep(p,
"        managementPolicy(state, monthIndex, { corporateDiscount: 0.015 }),",
"        managementPolicy(state, monthIndex, { corporateDiscount: 0.0075 }),")
# Add rich diagnostics and broader anti-degeneracy checks to the managed 10-year run.
rep(p,
"    const loanDepositRatio = finalDeposits > 0 ? finalLoans / finalDeposits : 0;\n\n    expect(finalState.status.hasFailed).toBe(false);",
"    const loanDepositRatio = finalDeposits > 0 ? finalLoans / finalDeposits : 0;\n    const finalAssets = finalState.financial.balanceSheet.items.filter(i => i.side === 'Asset').reduce((s,i)=>s+i.balance,0);\n    const liquidAssets = productBalance(finalState, AssetProductType.CashReserves) + productBalance(finalState, AssetProductType.Gilts);\n    console.log('TEN_YEAR_MANAGED=' + JSON.stringify({\n      step: finalState.time.step, loans: finalLoans, mortgages: productBalance(finalState,AssetProductType.Mortgages),\n      consumer: productBalance(finalState,AssetProductType.ConsumerLoans), corporate: finalCorporateLoans, deposits: finalDeposits,\n      termDeposits: productBalance(finalState,LiabilityProductType.RetailTermDeposits), cash: productBalance(finalState,AssetProductType.CashReserves),\n      gilts: productBalance(finalState,AssetProductType.Gilts), cet1: finalState.financial.capital.cet1, cet1Ratio: finalState.risk.riskMetrics.cet1Ratio,\n      leverage: finalState.risk.riskMetrics.leverageRatio, lcr: finalState.risk.riskMetrics.lcr, nsfr: finalState.risk.riskMetrics.nsfr,\n      fundingConfidence: finalState.risk.riskMetrics.fundingConfidenceScore, loanDepositRatio, liquidAssetShare: finalAssets>0?liquidAssets/finalAssets:0,\n      stateBuckets: totalLoanStateBuckets(finalState), sharePrice: finalState.equityMarket.sharePrice\n    }));\n\n    expect(finalState.status.hasFailed).toBe(false);")
rep(p,
"    expect(loanDepositRatio).toBeGreaterThan(0.3);\n    expect(totalLoanStateBuckets(finalState)).toBeLessThan(6000);",
"    expect(loanDepositRatio).toBeGreaterThan(0.35);\n    expect(finalAssets > 0 ? liquidAssets / finalAssets : 1).toBeLessThan(0.55);\n    expect(finalState.risk.riskMetrics.cet1Ratio).toBeLessThan(0.35);\n    expect(finalState.risk.riskMetrics.lcr).toBeLessThan(5);\n    expect(finalState.risk.riskMetrics.nsfr).toBeLessThan(4);\n    expect(totalLoanStateBuckets(finalState)).toBeLessThan(6000);")
# Insert a no-action 40-quarter trajectory before the competitive-pricing test.
marker="  it('competitive lending prices materially increase loan volumes', () => {"
insert="""  it('an unmanaged ten-year run does not collapse into a cash-only bank', () => {\n    const openingLoans = totalLoans(initialState);\n    const openingDeposits = totalCustomerDeposits(initialState);\n    const finalState = runMonths(120, { state: initialState, config: baseConfig });\n    const finalLoans = totalLoans(finalState);\n    const finalDeposits = totalCustomerDeposits(finalState);\n    const assets = finalState.financial.balanceSheet.items.filter(i => i.side === 'Asset').reduce((s,i)=>s+i.balance,0);\n    const liquid = productBalance(finalState,AssetProductType.CashReserves)+productBalance(finalState,AssetProductType.Gilts);\n    console.log('TEN_YEAR_DEFAULT=' + JSON.stringify({\n      step: finalState.time.step, failed: finalState.status.hasFailed, loans: finalLoans, mortgages: productBalance(finalState,AssetProductType.Mortgages),\n      consumer: productBalance(finalState,AssetProductType.ConsumerLoans), corporate: productBalance(finalState,AssetProductType.CorporateLoans),\n      deposits: finalDeposits, termDeposits: productBalance(finalState,LiabilityProductType.RetailTermDeposits),\n      cash: productBalance(finalState,AssetProductType.CashReserves), gilts: productBalance(finalState,AssetProductType.Gilts),\n      cet1Ratio: finalState.risk.riskMetrics.cet1Ratio, leverage: finalState.risk.riskMetrics.leverageRatio, lcr: finalState.risk.riskMetrics.lcr,\n      nsfr: finalState.risk.riskMetrics.nsfr, fundingConfidence: finalState.risk.riskMetrics.fundingConfidenceScore,\n      loanDepositRatio: finalDeposits>0?finalLoans/finalDeposits:0, liquidAssetShare: assets>0?liquid/assets:0,\n      stateBuckets: totalLoanStateBuckets(finalState), sharePrice: finalState.equityMarket.sharePrice\n    }));\n    expect(finalState.status.hasFailed).toBe(false);\n    expect(finalLoans).toBeGreaterThan(openingLoans * 0.5);\n    expect(finalLoans).toBeLessThan(openingLoans * 1.8);\n    expect(finalDeposits).toBeGreaterThan(openingDeposits * 0.55);\n    expect(finalDeposits).toBeLessThan(openingDeposits * 1.8);\n    expect(assets > 0 ? liquid / assets : 1).toBeLessThan(0.6);\n    expect(totalLoanStateBuckets(finalState)).toBeLessThan(6000);\n  });\n\n"""
text=Path(p).read_text()
if marker not in text: raise RuntimeError('competitive marker missing')
Path(p).write_text(text.replace(marker,insert+marker,1))
# Competitive-price comparison now also exercises personal credit.
text=Path(p).read_text()
text=text.replace("{ mortgageDiscount: 0, corporateDiscount: 0 }", "{ mortgageDiscount: 0, consumerDiscount: 0, corporateDiscount: 0 }",1)
text=text.replace("{ mortgageDiscount: 0.005, corporateDiscount: 0.0075 }", "{ mortgageDiscount: 0.005, consumerDiscount: 0.01, corporateDiscount: 0.0075 }",1)
Path(p).write_text(text)

print('final retail calibration patch applied')
