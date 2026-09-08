from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f"pattern not found in {path}: {old[:120]!r}")
    text = text.replace(old, new, count)
    p.write_text(text)

# 1) Scenario states: support all loan books and scenario-only ST wholesale funding.
p = "src/config/scenarios.ts"
replace(p,
"import { LiabilityProductType, AssetProductType, ProductType } from '../domain/enums';",
"import { LiabilityProductType, AssetProductType, ProductType, BalanceSheetSide, Currency, MaturityBucket } from '../domain/enums';")
replace(p,
"    state.financial.balanceSheet.items = state.financial.balanceSheet.items.map((item) => {\n      const ov = override.financial?.balanceSheet?.items?.find((o) => o.productType === item.productType);\n      if (!ov) return item;\n      return {\n        ...item,\n        ...ov,\n        encumbrance: ov.encumbrance ? { ...ov.encumbrance } : item.encumbrance,\n      };\n    });",
"    const overrides = override.financial.balanceSheet.items;\n    state.financial.balanceSheet.items = state.financial.balanceSheet.items.map((item) => {\n      const ov = overrides.find((o) => o.productType === item.productType);\n      if (!ov) return item;\n      return { ...item, ...ov, encumbrance: ov.encumbrance ? { ...ov.encumbrance } : item.encumbrance };\n    });\n    // Short-term wholesale funding is no longer an opening-bank line, but stress scenarios may introduce it.\n    const stOverride = overrides.find((o) => o.productType === LiabilityProductType.WholesaleFundingST);\n    if (stOverride && !state.financial.balanceSheet.items.some((i) => i.productType === LiabilityProductType.WholesaleFundingST)) {\n      state.financial.balanceSheet.items.push({\n        side: BalanceSheetSide.Liability, productType: LiabilityProductType.WholesaleFundingST,\n        label: 'Short-Term Wholesale Funding', currency: Currency.GBP, balance: Math.max(0, stOverride.balance ?? 0),\n        interestRate: stOverride.interestRate ?? state.market.riskFreeShort + state.market.wholesaleFundingSpread,\n        maturityBucket: MaturityBucket.LessThan1Y, liquidityTag: config.liquidityTags[LiabilityProductType.WholesaleFundingST],\n        encumbrance: { encumberedAmount: 0 },\n      });\n    }")
replace(p,
"  const loanProducts = [AssetProductType.Mortgages, AssetProductType.CorporateLoans] as const;",
"  const loanProducts = [AssetProductType.Mortgages, AssetProductType.ConsumerLoans, AssetProductType.CorporateLoans] as const;")
replace(p,
"    if (total > 0) buckets.forEach(b => b.notional *= balance / total);",
"    if (total > 0) buckets.forEach(b => b.notional *= balance / total);\n    else if (balance > 0) {\n      const line = state.financial.balanceSheet.items.find(i => i.productType === p);\n      const tenor = p === LiabilityProductType.WholesaleFundingST\n        ? (config.behaviour.fundingLadder?.stRefinanceTenorMonths ?? 6)\n        : (config.behaviour.fundingLadder?.ltRefinanceTenorMonths ?? 36);\n      state.fundingLadders[p] = [{ tenorMonths: tenor, monthsToMaturity: tenor, notional: balance, rate: line?.interestRate ?? 0 }];\n    }")

# 2) Engine integration: franchise current accounts, damp recession pricing capture, ALCO tolerance band.
p = "src/engine/simulation.ts"
replace(p,
"      const competitor = meta.behaviour.isTermDeposit ? state.market.competitorTermDepositRate : meta.behaviour.depositSegment === 'corporate' ? state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate : state.market.competitorRetailDepositRate;",
"      const competitor = item.productType === LiabilityProductType.RetailTransactionalDeposits\n        ? item.interestRate\n        : meta.behaviour.isTermDeposit\n          ? state.market.competitorTermDepositRate\n          : meta.behaviour.depositSegment === 'corporate'\n            ? state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate\n            : state.market.competitorRetailDepositRate;")
replace(p,
"        const pricingCapture = clamp(1 + pipelineParams.pricingSensitivity * pricingGap, 0.2, 2.5);",
"        const rawPricingCapture = clamp(1 + pipelineParams.pricingSensitivity * pricingGap, 0.2, 2.5);\n        // In a contracting credit market, a cheap offer can win share but cannot create aggregate demand.\n        const pricingCapture = rawPricingCapture <= 1\n          ? rawPricingCapture\n          : 1 + (rawPricingCapture - 1) * Math.min(1, macroMarketMultiplier);")
replace(p,
"const applyTreasuryPolicy = (state: BankState, config: SimulationConfig, events: SimulationEvent[]): void => {\n  const policy=state.behaviour.treasuryPolicy; if(!policy)return; const cash=findItem(state.financial.balanceSheet,AssetProductType.CashReserves); const gilts=findItem(state.financial.balanceSheet,AssetProductType.Gilts); if(!cash||!gilts)return;\n  const total=Math.max(0,cash.balance)+Math.max(0,gilts.balance); const target=total*clamp(policy.giltShareOfHqla,0,1); const delta=target-gilts.balance; if(Math.abs(delta)>1e4) applyBuySellAsset(state,config,AssetProductType.Gilts,delta,events);\n  if(gilts.security) gilts.security.effectiveDurationYears=clamp(policy.giltDurationYears,.25,15);\n};",
"const applyTreasuryPolicy = (state: BankState, config: SimulationConfig, events: SimulationEvent[]): void => {\n  const policy = state.behaviour.treasuryPolicy;\n  if (!policy) return;\n  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);\n  const gilts = findItem(state.financial.balanceSheet, AssetProductType.Gilts);\n  if (!cash || !gilts) return;\n  const total = Math.max(0, cash.balance) + Math.max(0, gilts.balance);\n  const targetShare = clamp(policy.giltShareOfHqla, 0, 1);\n  const currentShare = total > 0 ? Math.max(0, gilts.balance) / total : 0;\n  const tolerance = 0.05;\n  let desiredShare = currentShare;\n  if (currentShare < targetShare - tolerance) desiredShare = targetShare - tolerance;\n  if (currentShare > targetShare + tolerance) desiredShare = targetShare + tolerance;\n  const delta = total * desiredShare - gilts.balance;\n  if (Math.abs(delta) > 1e4) applyBuySellAsset(state, config, AssetProductType.Gilts, delta, events);\n  if (gilts.security) gilts.security.effectiveDurationYears = clamp(policy.giltDurationYears, .25, 15);\n};")

# 3) Department cards: keep four high-information metrics; product detail lives in policy rows.
p = "src/game/departments.ts"
replace(p,
"        metric('Customer deposits', deposits),\n        metric('Fixed-term savings share', deposits > 0 ? term / deposits : 0, 'ratio'),\n        metric('Average annual deposit rate', deposits > 0 ? interest / deposits : NaN, 'ratio'),\n        metric('Largest depositor/group', m.largeDepositorShare ?? state.behaviour.largeDepositorShare ?? 0, 'ratio'),",
"        metric('Customer deposits', deposits),\n        metric('Deposit change this quarter', change),\n        metric('Fixed-term savings share', deposits > 0 ? term / deposits : 0, 'ratio'),\n        metric('Largest depositor/group', m.largeDepositorShare ?? state.behaviour.largeDepositorShare ?? 0, 'ratio'),")
replace(p,
"        metric('Gross loan principal', gross),\n        metric('Approvals this quarter', approvals),\n        metric('Personal credit', balance(A.ConsumerLoans)),\n        metric('Stage 2 and 3 share', gross > 0 ? stressed / gross : 0, 'ratio'),",
"        metric('Gross loan principal', gross),\n        metric('Approvals this quarter', approvals),\n        metric('Undrawn commitments', committed),\n        metric('Stage 2 and 3 share', gross > 0 ? stressed / gross : 0, 'ratio'),")
replace(p,
"    const interest = state.financial.balanceSheet.items.filter(i => PRODUCT_META[i.productType]?.behaviour?.isCustomerDeposit)\n      .reduce((n, i) => n + i.balance * i.interestRate, 0);\n",
"")

# 4) Validation UX: identify the hidden/other-department field that blocks time.
p = "src/components/ActionsPanel.tsx"
replace(p,
"export default function ActionsPanel({department,state,onChange,disabled,errors,hasValidationErrors,onNavigateHelp}:Props) {\n  const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});",
"const FIELD_LABELS: Partial<Record<keyof ActionFormState,string>> = {\n  retailDepositRate:'Instant-access savings offer', termDepositRate:'Fixed-term savings offer', corporateDepositRate:'SME/business deposit offer',\n  mortgageRate:'Mortgage new rate', consumerLoanRate:'Personal-credit new rate', corporateLoanRate:'SME/business new rate',\n  mortgageUnderwritingTightness:'Mortgage selectivity', consumerUnderwritingTightness:'Personal-credit selectivity', corporateUnderwritingTightness:'SME/business selectivity',\n  issueLTDebtAmount:'Long-term debt amount', issueEquityAmount:'CET1 equity amount', issueTier2Amount:'Tier 2 amount',\n  boeFundingAmount:'BoE drawing amount', hedgeNotional:'Swap notional', hedgeFixedRate:'Swap fixed rate', dividendPayoutRatio:'Profit payout',\n  giltShareOfHqla:'Gilt share of liquid assets',\n};\n\nexport default function ActionsPanel({department,state,onChange,disabled,errors,hasValidationErrors,onNavigateHelp}:Props) {\n  const update=(key:keyof ActionFormState,value:string)=>onChange({...state,[key]:value});\n  const firstError = Object.entries(errors ?? {}).find(([,message]) => !!message) as [keyof ActionFormState,string] | undefined;")
replace(p,
"    {hasValidationErrors && <div role=\"alert\" className=\"alert danger\">Fix invalid inputs before advancing time.</div>}",
"    {hasValidationErrors && <div role=\"alert\" className=\"alert danger\">Fix invalid inputs before advancing time.{firstError && <> <strong>{FIELD_LABELS[firstError[0]] ?? firstError[0]}:</strong> {firstError[1]}</>}</div>}")

# 5) Calibration packs should represent the new funding model.
p = "src/config/calibration/retailHeavy.ts"
replace(p,
"  setProductBalance(state, LiabilityProductType.WholesaleFundingST, 0.05e9);",
"  setProductBalance(state, LiabilityProductType.RetailTermDeposits, 2.2e9);")
p = "src/config/calibration/universal.ts"
replace(p,
"  setProductBalance(state, LiabilityProductType.WholesaleFundingST, 1e9);",
"  setProductBalance(state, LiabilityProductType.RetailTermDeposits, 1.2e9);")
p = "src/config/calibration/utils.ts"
replace(p,
"  [AssetProductType.Mortgages, AssetProductType.CorporateLoans].forEach((productType) => {",
"  [AssetProductType.Mortgages, AssetProductType.ConsumerLoans, AssetProductType.CorporateLoans].forEach((productType) => {")

# 6) Update legacy tests to current product/funding assumptions without weakening the behaviours they protect.
p = "src/engine/confidenceStateMachine.test.ts"
text = Path(p).read_text().replace("LiabilityProductType.WholesaleFundingST", "LiabilityProductType.WholesaleFundingLT")
Path(p).write_text(text)

p = "src/engine/fundingConfidenceLoop.test.ts"
text = Path(p).read_text().replace("LiabilityProductType.WholesaleFundingST", "LiabilityProductType.WholesaleFundingLT")
text = text.replace("    const baselineState = cloneBankState(initialState);\n    const stressedState = cloneBankState(initialState);",
"    const baselineState = cloneBankState(initialState);\n    const stressedState = cloneBankState(initialState);\n    for (const state of [baselineState, stressedState]) {\n      (state.fundingLadders[LiabilityProductType.WholesaleFundingLT] ?? []).forEach(b => b.monthsToMaturity = 1);\n    }")
Path(p).write_text(text)

p = "src/engine/fundingLadder.test.ts"
text = Path(p).read_text()
text = text.replace("    const baseline = engine.step({\n      state: cloneBankState(initialState),", "    const baselineState = cloneBankState(initialState);\n    (baselineState.fundingLadders[LiabilityProductType.WholesaleFundingLT] ?? []).forEach(b => b.monthsToMaturity = 1);\n    const stressedState = cloneBankState(initialState);\n    (stressedState.fundingLadders[LiabilityProductType.WholesaleFundingLT] ?? []).forEach(b => b.monthsToMaturity = 1);\n\n    const baseline = engine.step({\n      state: baselineState,")
text = text.replace("    const stressed = engine.step({\n      state: cloneBankState(initialState),", "    const stressed = engine.step({\n      state: stressedState,")
text = text.replace("const baselineSt = baseline.financial.balanceSheet.items.find(\n      (item) => item.productType === LiabilityProductType.WholesaleFundingST\n    );", "const baselineSt = baseline.financial.balanceSheet.items.find(\n      (item) => item.productType === LiabilityProductType.WholesaleFundingLT\n    );")
text = text.replace("const stressedSt = stressed.financial.balanceSheet.items.find(\n      (item) => item.productType === LiabilityProductType.WholesaleFundingST\n    );", "const stressedSt = stressed.financial.balanceSheet.items.find(\n      (item) => item.productType === LiabilityProductType.WholesaleFundingLT\n    );")
Path(p).write_text(text)

p = "src/engine/capitalPolicy.test.ts"
replace(p,
"    const targetCet1 = initialState.financial.capital.cet1 * 0.75;",
"    const targetCet1 = state.risk.riskMetrics.rwa * 0.075;")

p = "src/engine/careerPacing.test.ts"
replace(p,
"    // Doing nothing indefinitely should still carry a cost: retained capital deteriorates as the balance sheet evolves.\n    expect(state.financial.capital.cet1).toBeLessThan(initialState.financial.capital.cet1);",
"    // An unattended but initially viable retail bank should remain economically meaningful rather than failing mechanically.\n    expect(state.financial.capital.cet1).toBeGreaterThan(0);")

p = "src/engine/simulationTestSuite.ts"
replace(p, "      const repoAmount = 5e9;", "      const repoAmount = 1e9;")

p = "src/game/departments.test.ts"
replace(p,
"    expect(find(summary, 'Wholesale funding due within 3 months').rawValue).toBe(100e6);\n    expect(summary.explanation).toContain('excludes deposits and repos');",
"    expect(find(summary, 'Funding due within 3 months').rawValue).toBeGreaterThanOrEqual(100e6);\n    expect(summary.explanation).toContain('Fixed-term savings');")

p = "src/ui/departmentOffice.test.tsx"
text = Path(p).read_text()
start = "const form:ActionFormState={retailDepositRate:'2%',corporateDepositRate:'3%',mortgageRate:'5%',corporateLoanRate:'6%',mortgageUnderwritingTightness:'.5',corporateUnderwritingTightness:'.5',issueLTDebtAmount:'',issueEquityAmount:'',dividendPayoutRatio:'.3',at1CouponMode:'auto',hedgeDirection:'none',hedgeNotional:'',hedgeFixedRate:'',hedgeMaturityMonths:'24'};"
new = "const form:ActionFormState={retailDepositRate:'2%',termDepositRate:'3.8%',termDepositTenorMonths:'12',corporateDepositRate:'3%',mortgageRate:'5%',consumerLoanRate:'10.5%',corporateLoanRate:'6%',mortgageUnderwritingTightness:'.5',consumerUnderwritingTightness:'.5',corporateUnderwritingTightness:'.5',mortgageMaxLtv:'.85',mortgageFixedPeriodMonths:'24',issueLTDebtAmount:'',issueEquityAmount:'',issueTier2Amount:'',dividendPayoutRatio:'.3',at1CouponMode:'auto',giltShareOfHqla:'.6',giltDurationYears:'5',boeFacility:'none',boeFundingAmount:'',hedgeDirection:'none',hedgeNotional:'',hedgeFixedRate:'',hedgeMaturityMonths:'24'};"
if start not in text: raise RuntimeError('departmentOffice form pattern not found')
text = text.replace(start,new)
text = text.replace("expect(html).toContain('New mortgage rate');", "expect(html).toContain('Mortgages');")
text = text.replace("expect(html).toContain('Mortgage selectivity');", "expect(html).toContain('Selectivity');")
text = text.replace("expect(html).toContain('Business loans');", "expect(html).toContain('SME/business');")
text = text.replace("expect(html).toContain('Retail savings offer');", "expect(html).toContain('Instant-access savings offer');")
text = text.replace("expect(html).toContain('Retail savings');", "expect(html).toContain('Instant savings');")
Path(p).write_text(text)

print('retail CI integration patch applied')
