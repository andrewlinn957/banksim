from pathlib import Path

# App.tsx
p = Path('src/App.tsx')
s = p.read_text()

s = s.replace("import { ActionFormState } from './components/ActionsPanel';", "import { ActionFormState, type CapitalMarketsPlanImpact } from './components/ActionsPanel';", 1)
s = s.replace("import { createDefaultThreeYearPlan } from './config/threeYearPlan';", "import { createDefaultThreeYearPlan } from './config/threeYearPlan';\nimport { buildCapitalMarketsBook } from './engine/capitalMarkets';", 1)

old_form = """    issueLTDebtAmount: '',\n    issueEquityAmount: '',\n    issueTier2Amount: '',"""
new_form = """    capitalMarketsInstrument: 'none',\n    capitalMarketsTargetAmount: '',\n    capitalMarketsMaxDiscount: '15%',\n    capitalMarketsMaxSpreadBps: '1000',\n    capitalMarketsTenorMonths: '60',"""
assert old_form in s
s = s.replace(old_form, new_form, 1)
old_scenario_form = """      issueLTDebtAmount: '',\n      issueEquityAmount: '',\n      issueTier2Amount: '',"""
new_scenario_form = """      capitalMarketsInstrument: 'none',\n      capitalMarketsTargetAmount: '',\n      capitalMarketsMaxDiscount: '15%',\n      capitalMarketsMaxSpreadBps: '1000',\n      capitalMarketsTenorMonths: '60',"""
assert old_scenario_form in s
s = s.replace(old_scenario_form, new_scenario_form, 1)

old_clear = """      issueLTDebtAmount: '',\n      issueEquityAmount: '',\n      issueTier2Amount: '',"""
new_clear = """      capitalMarketsInstrument: 'none',\n      capitalMarketsTargetAmount: '',"""
assert old_clear in s
s = s.replace(old_clear, new_clear, 1)

old_amounts = """  const amountFields: Array<keyof ActionFormState> = ['issueLTDebtAmount','issueEquityAmount','issueTier2Amount','giltTradeAmount','boeFundingAmount','hedgeNotional'];"""
new_amounts = """  const amountFields: Array<keyof ActionFormState> = ['capitalMarketsTargetAmount','giltTradeAmount','boeFundingAmount','hedgeNotional'];"""
assert old_amounts in s
s = s.replace(old_amounts, new_amounts, 1)

anchor = """  if(state.boeFacility!=='none' && (values.boeFundingAmount??0)<=0) errors.boeFundingAmount='Enter an amount for the selected Bank of England facility';\n\n  const payoutParsed"""
insert = """  if(state.boeFacility!=='none' && (values.boeFundingAmount??0)<=0) errors.boeFundingAmount='Enter an amount for the selected Bank of England facility';\n  if(state.capitalMarketsInstrument!=='none') {\n    if((values.capitalMarketsTargetAmount??0)<=0) errors.capitalMarketsTargetAmount='Enter a positive target size for the transaction';\n    if(state.capitalMarketsInstrument==='cet1') {\n      const parsed=parseRateInput(state.capitalMarketsMaxDiscount);\n      if(parsed.error) errors.capitalMarketsMaxDiscount=parsed.error;\n      else if(parsed.value===undefined||parsed.value<0||parsed.value>0.5) errors.capitalMarketsMaxDiscount='Maximum discount must be between 0% and 50%';\n      else values.capitalMarketsMaxDiscount=parsed.value;\n    } else {\n      const spread=Number(state.capitalMarketsMaxSpreadBps);\n      if(!Number.isFinite(spread)||spread<=0||spread>5000) errors.capitalMarketsMaxSpreadBps='Maximum spread must be between 1 and 5,000 bp';\n      else values.capitalMarketsMaxSpreadBps=spread;\n    }\n    if(state.capitalMarketsInstrument==='tier2'||state.capitalMarketsInstrument==='senior') {\n      const tenor=Number(state.capitalMarketsTenorMonths);\n      if(!Number.isFinite(tenor)||tenor<=0) errors.capitalMarketsTenorMonths='Select a positive debt tenor';\n      else values.capitalMarketsTenorMonths=Math.round(tenor);\n    }\n  }\n\n  const payoutParsed"""
assert anchor in s
s = s.replace(anchor, insert, 1)

old_issuance = """  if (values.issueTier2Amount!==undefined && values.issueTier2Amount>0) actions.push({type:'issueTier2',amount:values.issueTier2Amount,maturityMonths:60});\n  if (values.issueLTDebtAmount !== undefined && values.issueLTDebtAmount > 0) {\n    actions.push({\n      type: 'issueDebt',\n      productType: LiabilityProductType.WholesaleFundingLT,\n      amount: values.issueLTDebtAmount,\n    });\n  }\n  if (values.issueEquityAmount !== undefined && values.issueEquityAmount > 0) {\n    actions.push({\n      type: 'issueEquity',\n      amount: values.issueEquityAmount,\n    });\n  }"""
new_issuance = """  if (formState.capitalMarketsInstrument !== 'none' && values.capitalMarketsTargetAmount !== undefined && values.capitalMarketsTargetAmount > 0) {\n    actions.push({\n      type: 'launchCapitalMarketsTransaction',\n      instrument: formState.capitalMarketsInstrument,\n      targetAmount: values.capitalMarketsTargetAmount,\n      maxDiscount: formState.capitalMarketsInstrument === 'cet1' ? values.capitalMarketsMaxDiscount : undefined,\n      maxSpreadBps: formState.capitalMarketsInstrument === 'cet1' ? undefined : values.capitalMarketsMaxSpreadBps,\n      tenorMonths: formState.capitalMarketsInstrument === 'tier2' || formState.capitalMarketsInstrument === 'senior' ? values.capitalMarketsTenorMonths : undefined,\n    });\n  }"""
assert old_issuance in s
s = s.replace(old_issuance, new_issuance, 1)

quote_anchor = """  const parsedActionForm = useMemo(() => parseActionFormInputs(actionForm), [actionForm]);\n\n  useEffect"""
quote_insert = """  const parsedActionForm = useMemo(() => parseActionFormInputs(actionForm), [actionForm]);\n  const capitalMarketsQuote = useMemo(() => {\n    const instrument=actionForm.capitalMarketsInstrument;\n    const target=parsedActionForm.values.capitalMarketsTargetAmount;\n    if(instrument==='none'||parsedActionForm.hasErrors||target===undefined||target<=0) return undefined;\n    return buildCapitalMarketsBook(bankState,simConfig,{\n      instrument,\n      targetAmount:target,\n      maxDiscount:instrument==='cet1'?parsedActionForm.values.capitalMarketsMaxDiscount:undefined,\n      maxSpreadBps:instrument==='cet1'?undefined:parsedActionForm.values.capitalMarketsMaxSpreadBps,\n      tenorMonths:instrument==='tier2'||instrument==='senior'?parsedActionForm.values.capitalMarketsTenorMonths:undefined,\n    });\n  },[actionForm.capitalMarketsInstrument,bankState,parsedActionForm,simConfig]);\n\n  useEffect"""
assert quote_anchor in s
s = s.replace(quote_anchor, quote_insert, 1)

preview_anchor = """  }, [activeScenarioId, actionForm, bankState, parsedActionForm, simConfig, isActionsOpen, activeTab, clockRunning, pendingRiskAppetite]);\n\n  const recommendations"""
preview_insert = """  }, [activeScenarioId, actionForm, bankState, parsedActionForm, simConfig, isActionsOpen, activeTab, clockRunning, pendingRiskAppetite]);\n  const capitalMarketsPlanImpact = useMemo<CapitalMarketsPlanImpact | undefined>(() => {\n    if(!bankState.threeYearPlan?.enabled||actionForm.capitalMarketsInstrument==='none'||!preview?.baseline) return undefined;\n    return {\n      cet1Before:bankState.risk.riskMetrics.cet1Ratio,\n      cet1After:preview.baseline.risk.riskMetrics.cet1Ratio,\n      epsBefore:bankState.equityMarket.epsTtm,\n      epsAfter:preview.baseline.equityMarket.epsTtm,\n    };\n  },[actionForm.capitalMarketsInstrument,bankState,preview]);\n\n  const recommendations"""
assert preview_anchor in s
s = s.replace(preview_anchor, preview_insert, 1)

old_office = """<DepartmentOffice department={activeDepartment} state={bankState} history={stateHistory} form={actionForm} errors={parsedActionForm.errors} hasErrors={parsedActionForm.hasErrors} selected={selectedDecisions} onChange={next=>{pauseClock();setActionForm(next);setSelectedDecisions([]);}} onDecision={backProposal} onReport={openReport} onHelp={openHelpSection} estimate={preview?.baseline??null}/>"""
new_office = """<DepartmentOffice department={activeDepartment} state={bankState} history={stateHistory} form={actionForm} errors={parsedActionForm.errors} hasErrors={parsedActionForm.hasErrors} selected={selectedDecisions} onChange={next=>{pauseClock();setActionForm(next);setSelectedDecisions([]);}} onDecision={backProposal} onReport={openReport} onHelp={openHelpSection} estimate={preview?.baseline??null} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpact={capitalMarketsPlanImpact}/>"""
assert old_office in s
s = s.replace(old_office, new_office, 1)

p.write_text(s)

# Board proposals now queue the common market transaction rather than legacy direct issuance.
p = Path('src/game/boardroom.ts')
s = p.read_text()
old = """      issueEquityAmount: String(\n        Math.ceil(Math.max(25e6, -s.risk.riskMetrics.internalCet1Headroom * s.risk.riskMetrics.rwa + 25e6))\n      ),\n      dividendPayoutRatio: '0',"""
new = """      capitalMarketsInstrument: 'cet1',\n      capitalMarketsTargetAmount: String(\n        Math.ceil(Math.max(25e6, -s.risk.riskMetrics.internalCet1Headroom * s.risk.riskMetrics.rwa + 25e6))\n      ),\n      capitalMarketsMaxDiscount: '20%',\n      dividendPayoutRatio: '0',"""
assert old in s
s = s.replace(old, new, 1)
old = """        issueLTDebtAmount: String(Math.round(Math.max(50e6, s.risk.riskMetrics.fundingMaturing3m * .5))),\n        dividendPayoutRatio: '0',"""
new = """        capitalMarketsInstrument: 'senior',\n        capitalMarketsTargetAmount: String(Math.round(Math.max(50e6, s.risk.riskMetrics.fundingMaturing3m * .5))),\n        capitalMarketsMaxSpreadBps: '750',\n        capitalMarketsTenorMonths: '36',\n        dividendPayoutRatio: '0',"""
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)

# Update the proposal test to expect the common market ticket.
p = Path('src/game/boardroom.test.tsx')
s = p.read_text()
old = """    expect(Number(rescue?.changes.issueEquityAmount)).toBeGreaterThan(0);"""
new = """    expect(rescue?.changes.capitalMarketsInstrument).toBe('cet1');\n    expect(Number(rescue?.changes.capitalMarketsTargetAmount)).toBeGreaterThan(0);"""
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)
