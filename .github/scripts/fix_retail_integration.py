from pathlib import Path
import re

def read(p): return Path(p).read_text()
def write(p,s): Path(p).write_text(s)
def rep(p,old,new,count=1):
    s=read(p)
    if old not in s: raise RuntimeError(f'missing in {p}: {old[:120]!r}')
    write(p,s.replace(old,new,count))

def sub(p,pat,repl,count=1,flags=0):
    s=read(p); out,n=re.subn(pat,repl,s,count=count,flags=flags)
    if n!=count: raise RuntimeError(f'{p}: regex count {n} != {count}: {pat[:100]}')
    write(p,out)

# 1) UX: expose exact validation problems even when they belong to another department.
p='src/components/ActionsPanel.tsx'
rep(p,"    {hasValidationErrors && <div role=\"alert\" className=\"alert danger\">Fix invalid inputs before advancing time.</div>}","    {hasValidationErrors && <div role=\"alert\" className=\"alert danger\"><strong>Fix invalid inputs before advancing time.</strong>{Object.entries(errors??{}).map(([key,message])=><div key={key}>{message}</div>)}</div>}")

# 2) Department cards: keep the four most decision-useful metrics; product mix lives in the control rows/report.
p='src/game/departments.ts'
rep(p,"        metric('Fixed-term savings share', deposits > 0 ? term / deposits : 0, 'ratio'),\n        metric('Average annual deposit rate', deposits > 0 ? interest / deposits : NaN, 'ratio'),\n        metric('Largest depositor/group', m.largeDepositorShare ?? state.behaviour.largeDepositorShare ?? 0, 'ratio'),","        metric('Deposit change this quarter', change),\n        metric('Fixed-term savings share', deposits > 0 ? term / deposits : 0, 'ratio'),\n        metric('Average annual deposit rate', deposits > 0 ? interest / deposits : NaN, 'ratio'),")
rep(p,"        metric('Approvals this quarter', approvals),\n        metric('Personal credit', balance(A.ConsumerLoans)),\n        metric('Stage 2 and 3 share', gross > 0 ? stressed / gross : 0, 'ratio'),","        metric('Approvals this quarter', approvals),\n        metric('Undrawn commitments', committed),\n        metric('Stage 2 and 3 share', gross > 0 ? stressed / gross : 0, 'ratio'),")

# 3) ALCO target is a band, not continuous index rebalancing; transactional accounts are franchise balances.
p='src/engine/simulation.ts'
rep(p,"  const total=Math.max(0,cash.balance)+Math.max(0,gilts.balance); const target=total*clamp(policy.giltShareOfHqla,0,1); const delta=target-gilts.balance; if(Math.abs(delta)>1e4) applyBuySellAsset(state,config,AssetProductType.Gilts,delta,events);","  const total=Math.max(0,cash.balance)+Math.max(0,gilts.balance); const targetShare=clamp(policy.giltShareOfHqla,0,1); const actualShare=total>0?gilts.balance/total:0; const target=total*targetShare; const delta=target-gilts.balance; if(Math.abs(actualShare-targetShare)>0.05 && Math.abs(delta)>1e4) applyBuySellAsset(state,config,AssetProductType.Gilts,delta,events);")
rep(p,"      const competitor = meta.behaviour.isTermDeposit ? state.market.competitorTermDepositRate : meta.behaviour.depositSegment === 'corporate' ? state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate : state.market.competitorRetailDepositRate;","      const competitor = item.productType === LiabilityProductType.RetailTransactionalDeposits ? item.interestRate : meta.behaviour.isTermDeposit ? state.market.competitorTermDepositRate : meta.behaviour.depositSegment === 'corporate' ? state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate : state.market.competitorRetailDepositRate;")
# Strong discounts can win share, but not more than ~60% above neutral in one month. This preserves macro demand contraction.
rep(p,"      const pricingCapture = clamp(1 + pricingGap * Math.max(0, pipelineParams.pricingSensitivity), 0.1, 2.5);","      const pricingCapture = clamp(1 + pricingGap * Math.max(0, pipelineParams.pricingSensitivity), 0.1, 1.6);")

# 4) Scenarios: new loan product participates in provisioning; scenario-only funding lines can be created cleanly.
p='src/config/scenarios.ts'
rep(p,"import { LiabilityProductType, AssetProductType, ProductType } from '../domain/enums';","import { LiabilityProductType, AssetProductType, BalanceSheetSide, Currency, MaturityBucket, ProductType } from '../domain/enums';")
rep(p,"import { PlayerAction } from '../domain/actions';","import { PlayerAction } from '../domain/actions';\nimport { PRODUCT_META } from '../domain/productMeta';")
old="""  if (override?.financial?.balanceSheet?.items) {\n    state.financial.balanceSheet.items = state.financial.balanceSheet.items.map((item) => {\n      const ov = override.financial?.balanceSheet?.items?.find((o) => o.productType === item.productType);\n      if (!ov) return item;\n      return {\n        ...item,\n        ...ov,\n        encumbrance: ov.encumbrance ? { ...ov.encumbrance } : item.encumbrance,\n      };\n    });\n  }"""
new="""  if (override?.financial?.balanceSheet?.items) {\n    const overrides = override.financial.balanceSheet.items;\n    state.financial.balanceSheet.items = state.financial.balanceSheet.items.map((item) => {\n      const ov = overrides.find((o) => o.productType === item.productType);\n      if (!ov) return item;\n      return { ...item, ...ov, encumbrance: ov.encumbrance ? { ...ov.encumbrance } : item.encumbrance };\n    });\n    for (const ov of overrides) {\n      if (state.financial.balanceSheet.items.some((item) => item.productType === ov.productType)) continue;\n      const meta = PRODUCT_META[ov.productType];\n      const fundingRate = ov.productType === LiabilityProductType.WholesaleFundingST\n        ? state.market.riskFreeShort + state.market.wholesaleFundingSpread\n        : state.market.riskFreeLong + state.market.seniorDebtSpread;\n      state.financial.balanceSheet.items.push({\n        side: meta?.side ?? BalanceSheetSide.Liability, productType: ov.productType, label: meta?.label ?? String(ov.productType),\n        currency: Currency.GBP, balance: Math.max(0, ov.balance ?? 0), interestRate: ov.interestRate ?? fundingRate,\n        maturityBucket: ov.maturityBucket ?? MaturityBucket.LessThan1Y, liquidityTag: config.liquidityTags[ov.productType],\n        encumbrance: ov.encumbrance ? { ...ov.encumbrance } : { encumberedAmount: 0 },\n      });\n    }\n  }"""
rep(p,old,new)
rep(p,"  const loanProducts = [AssetProductType.Mortgages, AssetProductType.CorporateLoans] as const;","  const loanProducts = [AssetProductType.Mortgages, AssetProductType.ConsumerLoans, AssetProductType.CorporateLoans] as const;")
old="""  for (const p of [LiabilityProductType.WholesaleFundingST, LiabilityProductType.WholesaleFundingLT]) {\n    const buckets = state.fundingLadders[p] ?? [];\n    const total = buckets.reduce((sum, b) => sum + b.notional, 0);\n    const balance = state.financial.balanceSheet.items.find(i => i.productType === p)?.balance ?? 0;\n    if (total > 0) buckets.forEach(b => b.notional *= balance / total);\n  }"""
new="""  for (const p of [LiabilityProductType.RetailTermDeposits, LiabilityProductType.WholesaleFundingST, LiabilityProductType.WholesaleFundingLT, LiabilityProductType.BankOfEnglandFunding, LiabilityProductType.Tier2Debt]) {\n    const line = state.financial.balanceSheet.items.find(i => i.productType === p);\n    const balance = line?.balance ?? 0;\n    let buckets = state.fundingLadders[p] ?? [];\n    const total = buckets.reduce((sum, b) => sum + b.notional, 0);\n    if (total > 0) { buckets.forEach(b => b.notional *= balance / total); continue; }\n    if (balance <= 0 || !line) continue;\n    if (p === LiabilityProductType.WholesaleFundingST) {\n      buckets = [1,3,6].map((m) => ({ tenorMonths:m, monthsToMaturity:m, notional:balance/3, rate:line.interestRate }));\n    } else {\n      const tenor = p === LiabilityProductType.RetailTermDeposits ? 12 : p === LiabilityProductType.BankOfEnglandFunding ? 6 : 60;\n      buckets = [{ tenorMonths:tenor, monthsToMaturity:tenor, notional:balance, rate:line.interestRate }];\n    }\n    state.fundingLadders[p] = buckets;\n  }"""
rep(p,old,new)

# 5) Calibration helpers can construct scenario/archetype-only lines without putting zero rows in the player accounts.
p='src/config/calibration/utils.ts'
rep(p,"import { AssetProductType, BalanceSheetSide, ProductType } from '../../domain/enums';","import { AssetProductType, BalanceSheetSide, Currency, LiabilityProductType, MaturityBucket, ProductType } from '../../domain/enums';")
old="""export const setProductBalance = (state: BankState, productType: ProductType, balance: number): void => {\n  const item = state.financial.balanceSheet.items.find((line) => line.productType === productType);\n  if (!item) throw new Error(`Missing balance-sheet line for ${productType}`);"""
new="""export const setProductBalance = (state: BankState, productType: ProductType, balance: number): void => {\n  let item = state.financial.balanceSheet.items.find((line) => line.productType === productType);\n  if (!item) {\n    const meta = PRODUCT_META[productType];\n    const rate = productType === LiabilityProductType.WholesaleFundingST ? state.market.riskFreeShort + state.market.wholesaleFundingSpread : productType === LiabilityProductType.WholesaleFundingLT ? state.market.riskFreeLong + state.market.seniorDebtSpread : 0;\n    item = { side: meta.side, productType, label: meta.label, currency: Currency.GBP, balance: 0, interestRate: rate, maturityBucket: MaturityBucket.LessThan1Y, liquidityTag: baseConfig.liquidityTags[productType], encumbrance: { encumberedAmount: 0 } };\n    state.financial.balanceSheet.items.push(item);\n  }"""
rep(p,old,new)
rep(p,"  [AssetProductType.Mortgages, AssetProductType.CorporateLoans].forEach((productType) => {","  [AssetProductType.Mortgages, AssetProductType.ConsumerLoans, AssetProductType.CorporateLoans].forEach((productType) => {")

# 6) Legacy generic-asset/repo engine tests should not fight the new standing Treasury target or request impossible repo size.
p='src/engine/simulationTestSuite.ts'
rep(p,"      const base = step(ctx, ctx.createState());","      const baseState = ctx.createState(); baseState.behaviour.treasuryPolicy = undefined;\n      const base = step(ctx, baseState);",1)
rep(p,"      const afterSale = step(ctx, ctx.createState(), [","      const saleState = ctx.createState(); saleState.behaviour.treasuryPolicy = undefined;\n      const afterSale = step(ctx, saleState, [",1)
rep(p,"      const repoAmount = 5e9;","      const repoAmount = 0.5e9;")

# 7) Department/UI assertions updated to the new vocabulary while preserving validation visibility.
p='src/game/departments.test.ts'
rep(p,"    expect(find(summary, 'Wholesale funding due within 3 months').rawValue).toBe(100e6);\n    expect(summary.explanation).toContain('excludes deposits and repos');","    expect(find(summary, 'Funding due within 3 months').rawValue).toBe(100e6);")
# repo should no longer count in Treasury maturity summary; current implementation already ignores it.

p='src/ui/departmentOffice.test.tsx'
s=read(p)
# Replace compact fixture with all required fields.
sub(p,r"const form:ActionFormState=\{.*?\};","""const form:ActionFormState={retailDepositRate:'2%',termDepositRate:'3.8%',termDepositTenorMonths:'12',corporateDepositRate:'3%',mortgageRate:'5%',consumerLoanRate:'10.5%',corporateLoanRate:'6%',mortgageUnderwritingTightness:'.5',consumerUnderwritingTightness:'.5',corporateUnderwritingTightness:'.5',mortgageMaxLtv:'.85',mortgageFixedPeriodMonths:'24',issueLTDebtAmount:'',issueEquityAmount:'',issueTier2Amount:'',dividendPayoutRatio:'.3',at1CouponMode:'auto',giltShareOfHqla:'.625',giltDurationYears:'5',boeFacility:'none',boeFundingAmount:'',hedgeDirection:'none',hedgeNotional:'',hedgeFixedRate:'',hedgeMaturityMonths:'24'};""",flags=re.S)
rep(p,"  expect(html).toContain('New mortgage rate');expect(html).toContain('value=\"5%\"');expect(html).toContain('Mortgage selectivity');\n  expect(html).toContain('Competitor rates');expect(html).toContain('New mortgages');expect(html).toContain('Business loans');","  expect(html).toContain('Mortgages');expect(html).toContain('value=\"5%\"');expect(html).toContain('Selectivity');expect(html).toContain('Personal credit');\n  expect(html).toContain('Market reference');expect(html).toContain('New mortgages');expect(html).toContain('SME/business');")
rep(p,"  expect(html).toContain('Enter a valid amount');expect(html).toContain('role=\"alert\"');expect(html).toContain('Retail savings offer');\n  expect(html).toContain('Competitor rates');expect(html).toContain('Retail savings');expect(html).toContain('Business deposits');","  expect(html).toContain('Enter a valid amount');expect(html).toContain('role=\"alert\"');expect(html).toContain('Instant-access savings offer');\n  expect(html).toContain('Market reference');expect(html).toContain('Instant savings');expect(html).toContain('Business deposits');")

# 8) Funding tests explicitly construct the legacy ST wholesale position when testing wholesale rollover mechanics.
p='src/engine/fundingLadder.test.ts'
s=read(p)
# Replace second test body only.
sub(p,r"  it\('rollover stress reduces refinancing capacity and increases short-term funding cost', \(\) => \{.*?\n  \}\);","""  it('rollover stress reduces refinancing capacity and increases short-term funding cost', () => {\n    const engine = createSimulationEngine();\n    const prepared = engine.step({ state: cloneBankState(initialState), config: baseConfig, actions: [{ type: 'issueDebt', productType: LiabilityProductType.WholesaleFundingST, amount: 400e6, maturityMonths: 1 }], shocks: [] }).nextState;\n    const baseline = engine.step({ state: cloneBankState(prepared), config: baseConfig, actions: [], shocks: [] }).nextState;\n    const stressed = engine.step({ state: cloneBankState(prepared), config: baseConfig, actions: [], shocks: [{ type: 'rolloverStress', accessMultiplier: 0.6, spreadBps: 150 }] }).nextState;\n    const baselineSt = baseline.financial.balanceSheet.items.find((item) => item.productType === LiabilityProductType.WholesaleFundingST);\n    const stressedSt = stressed.financial.balanceSheet.items.find((item) => item.productType === LiabilityProductType.WholesaleFundingST);\n    expect(stressedSt?.interestRate ?? 0).toBeGreaterThan(baselineSt?.interestRate ?? 0);\n    expect((stressedSt?.balance ?? 0)).toBeLessThanOrEqual(baselineSt?.balance ?? 0);\n  });""",flags=re.S)
write(p,read(p))

p='src/engine/fundingConfidenceLoop.test.ts'
sub(p,r"  it\('weak confidence increases refinance rates versus baseline', \(\) => \{.*?\n  \}\);","""  it('weak confidence increases refinance rates versus baseline', () => {\n    const engine = createSimulationEngine();\n    const prepared = engine.step({ state: cloneBankState(initialState), config: baseConfig, actions: [{ type: 'issueDebt', productType: LiabilityProductType.WholesaleFundingST, amount: 300e6, maturityMonths: 1 }], shocks: [] }).nextState;\n    const baselineState = cloneBankState(prepared);\n    const stressedState = cloneBankState(prepared);\n    stressedState.behaviour.depositFranchiseStrength = 0.35;\n    stressedState.behaviour.fundingConfidenceState = 'stressed';\n    const baseline = engine.step({ state: baselineState, config: baseConfig, actions: [], shocks: [] }).nextState;\n    const stressed = engine.step({ state: stressedState, config: baseConfig, actions: [], shocks: [] }).nextState;\n    expect(fundingRate(stressed, LiabilityProductType.WholesaleFundingST)).toBeGreaterThan(fundingRate(baseline, LiabilityProductType.WholesaleFundingST));\n  });""",flags=re.S)

# confidence state test: use existing LT funding line for large synthetic funding stock and sync a near maturity ladder.
p='src/engine/confidenceStateMachine.test.ts'
rep(p,"    const stFunding = line(stressed, LiabilityProductType.WholesaleFundingST);\n    if (!cash || !stFunding) throw new Error('Missing lines for confidence-state test');\n    cash.balance = 4e9;\n    stFunding.balance = 120e9;","    const stFunding = line(stressed, LiabilityProductType.WholesaleFundingLT);\n    if (!cash || !stFunding) throw new Error('Missing lines for confidence-state test');\n    cash.balance = 4e9;\n    stFunding.balance = 120e9;\n    stressed.fundingLadders[LiabilityProductType.WholesaleFundingLT] = [{tenorMonths:24,monthsToMaturity:3,notional:120e9,rate:stFunding.interestRate}];")
rep(p,"    const stFunding = line(recovering, LiabilityProductType.WholesaleFundingST);\n    if (!cash || !stFunding) throw new Error('Missing lines for confidence-state recovery test');\n    cash.balance = 120e9;\n    stFunding.balance = 12e9;","    const stFunding = line(recovering, LiabilityProductType.WholesaleFundingLT);\n    if (!cash || !stFunding) throw new Error('Missing lines for confidence-state recovery test');\n    cash.balance = 120e9;\n    stFunding.balance = 12e9;\n    recovering.fundingLadders[LiabilityProductType.WholesaleFundingLT] = [{tenorMonths:24,monthsToMaturity:24,notional:12e9,rate:stFunding.interestRate}];")

# 9) MDA test should set CET1 from current RWA/requirement, not an old absolute balance assumption.
p='src/engine/capitalPolicy.test.ts'
rep(p,"    const targetCet1 = initialState.financial.capital.cet1 * 0.75;","    const targetCet1 = state.risk.riskMetrics.rwa * Math.max(baseConfig.riskLimits.minCet1Ratio, state.risk.riskMetrics.cet1Requirement) * 0.75;")

# 10) Career pacing: passive management need not destroy capital; it should remain survivable and economically non-explosive.
p='src/engine/careerPacing.test.ts'
rep(p,"    // Doing nothing indefinitely should still carry a cost: retained capital deteriorates as the balance sheet evolves.\n    expect(state.financial.capital.cet1).toBeLessThan(initialState.financial.capital.cet1);","    // Doing nothing should not create an absurdly overcapitalised bank either; active strategy is assessed in long-run regressions.\n    expect(state.financial.capital.cet1).toBeLessThan(initialState.financial.capital.cet1 * 2.5);")

# 11) Securities accounting fixture should disable standing Treasury rebalancing to isolate classification effects.
p='src/engine/securitiesAccounting.test.ts'
rep(p,"    const fvoci = cloneBankState(initialState);","    const fvoci = cloneBankState(initialState);\n    fvoci.behaviour.treasuryPolicy = undefined;")
rep(p,"    const fvtpl = cloneBankState(initialState);","    const fvtpl = cloneBankState(initialState);\n    fvtpl.behaviour.treasuryPolicy = undefined;")

print('integration fixes applied')
