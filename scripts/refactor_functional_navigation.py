from pathlib import Path
import re


def require_sub(pattern: str, repl: str, text: str, label: str, flags=0) -> str:
    out, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise RuntimeError(f'{label}: expected one replacement, got {n}')
    return out

# App routing/navigation
path = Path('src/App.tsx')
text = path.read_text()
text = text.replace("import Boardroom from './components/Boardroom';\n", "import Boardroom from './components/Boardroom';\nimport FunctionalNavigation from './components/FunctionalNavigation';\nimport FunctionalReportNavigation from './components/FunctionalReportNavigation';\n")
text = require_sub(r"const tabs = \[.*?\];\n\n", "", text, 'remove legacy tabs', re.S)
text = text.replace("  Overview: 'Risk dashboard',", "  Overview: 'Risk overview',")
text = text.replace("  Regulatory: 'Regulatory metrics',", "  Regulatory: 'Regulatory detail',")

legacy_nav = r'''      <nav className="tabs report-navigation" aria-label="Bank reports and tools">\n        \{tabs\.map\(tab=><button key=\{tab\} className=\{`tab-button \$\{activeTab===tab\?'active':''\}`\} aria-current=\{activeTab===tab\?'page':undefined\} onClick=\{\(\)=>tab==='Boardroom'\?setActiveTab\('Boardroom'\):openReport\(tab\)\}>\{tabLabels\[tab\]\?\?tab\}</button>\)\}\n      </nav>'''
new_nav = '''      <FunctionalNavigation\n        activeTab={activeTab}\n        activeDepartment={activeTab==='Boardroom'&&isActionsOpen?activeDepartment:null}\n        onBoardroom={()=>{setIsActionsOpen(false);setActiveTab('Boardroom');}}\n        onDepartment={openDepartment}\n        onReport={openReport}\n      />'''
text = require_sub(legacy_nav, new_nav, text, 'replace primary navigation')

old_breadcrumb = r'''      \{activeTab !== 'Boardroom' && <div className="report-breadcrumb"><button className="button ghost" onClick=\{\(\)=>setActiveTab\('Boardroom'\)\}>← Back to bank</button><span>\{activeTab==='Help'\?'Reference library':tabLabels\[activeTab\]\?\?activeTab\}</span>\{\['Loans','Regulatory','Accounts'\]\.includes\(activeTab\)&&<button className="button" onClick=\{\(\)=>openDepartment\(activeTab==='Loans'\?'Lending':activeTab==='Costs'\?'Treasury':'Capital'\)\}>Manage \{activeTab==='Loans'\?'lending':activeTab==='Costs'\?'treasury':'capital'\} →</button>\}</div>\}'''
new_breadcrumb = '''      {activeTab !== 'Boardroom' && <div className="report-breadcrumb"><button className="button ghost" onClick={()=>{setIsActionsOpen(false);setActiveTab('Boardroom');}}>← Back to bank</button><span>{activeTab==='Help'?'Reference library':tabLabels[activeTab]??activeTab}</span></div>}\n      <FunctionalReportNavigation activeTab={activeTab} onReport={openReport} onManage={openDepartment}/>'''
text = require_sub(old_breadcrumb, new_breadcrumb, text, 'simplify breadcrumb')

old_boardroom = "onDepartment={openDepartment} onClose={()=>setIsActionsOpen(false)}"
new_boardroom = "onDepartment={openDepartment} onRisk={()=>openReport('Regulatory')} onClose={()=>setIsActionsOpen(false)}"
if old_boardroom not in text:
    raise RuntimeError('Boardroom props anchor missing')
text = text.replace(old_boardroom, new_boardroom, 1)

old_game = '<button className="button" onClick={() => handleStartScenario(null)}>Start a fresh bank</button><button className="button ghost" onClick={()=>setTheme(t=>t===\'light\'?\'dark\':\'light\')}>Use {theme===\'light\'?\'dark\':\'light\'} theme</button>'
new_game = '<button className="button" onClick={() => handleStartScenario(null)}>Start a fresh bank</button><button className="button ghost" onClick={()=>openReport(\'Events\')}>Event log</button><button className="button ghost" onClick={()=>openReport(\'Reconciliations\')}>Reconciliations</button><button className="button ghost" onClick={()=>setTheme(t=>t===\'light\'?\'dark\':\'light\')}>Use {theme===\'light\'?\'dark\':\'light\'} theme</button>'
if old_game not in text:
    raise RuntimeError('Game menu anchor missing')
text = text.replace(old_game, new_game, 1)
path.write_text(text)

# Split capital-market ownership between Finance & Capital and Treasury & Funding.
path = Path('src/components/ActionsPanel.tsx')
text = path.read_text()
text = text.replace(
"const CapitalMarketsTicket = ({state,update,disabled,errors,quote,planImpact}:{state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;errors?:Partial<Record<keyof ActionFormState,string>>;quote?:CapitalMarketsBookbuildResult;planImpact?:CapitalMarketsPlanImpact}) => {\n  const instrument = state.capitalMarketsInstrument;",
"const CapitalMarketsTicket = ({state,update,disabled,errors,quote,planImpact,allowedInstruments,title}:{state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;errors?:Partial<Record<keyof ActionFormState,string>>;quote?:CapitalMarketsBookbuildResult;planImpact?:CapitalMarketsPlanImpact;allowedInstruments:CapitalMarketsInstrument[];title:string}) => {\n  const queuedInstrument = state.capitalMarketsInstrument;\n  const instrument = queuedInstrument !== 'none' && allowedInstruments.includes(queuedInstrument) ? queuedInstrument : 'none';\n  const queuedElsewhere = queuedInstrument !== 'none' && instrument === 'none';"
)
text = text.replace('<div className="policy-section-title"><h3>Capital markets</h3><small>One transaction ticket. Market demand and clearing terms determine what actually settles.</small></div>', '<div className="policy-section-title"><h3>{title}</h3><small>One transaction ticket. Market demand and clearing terms determine what actually settles.</small></div>')
text = text.replace('{CAPITAL_MARKETS_INSTRUMENT_ORDER.map(key => { const item=getCapitalMarketsInstrument(key); return <option key={key} value={key}>{item.label}</option>; })}', '{CAPITAL_MARKETS_INSTRUMENT_ORDER.filter(key=>allowedInstruments.includes(key)).map(key => { const item=getCapitalMarketsInstrument(key); return <option key={key} value={key}>{item.label}</option>; })}')
text = text.replace('    </div>\n    {definition&&quote&&<div', '    </div>\n    {queuedElsewhere&&<div className="muted">A capital-markets transaction is queued in the other management area.</div>}\n    {definition&&quote&&<div', 1)
old_ticket = "    {(department==='Capital'||department==='Treasury')&&<CapitalMarketsTicket state={state} update={update} disabled={disabled} errors={errors} quote={capitalMarketsQuote} planImpact={capitalMarketsPlanImpact}/>} "
new_ticket = "    {department==='Capital'&&<CapitalMarketsTicket state={state} update={update} disabled={disabled} errors={errors} quote={capitalMarketsQuote} planImpact={capitalMarketsPlanImpact} allowedInstruments={['cet1']} title=\"Equity issuance\"/>}\n    {department==='Treasury'&&<CapitalMarketsTicket state={state} update={update} disabled={disabled} errors={errors} quote={capitalMarketsQuote} planImpact={capitalMarketsPlanImpact} allowedInstruments={['at1','tier2','senior']} title=\"Wholesale funding markets\"/>} "
if old_ticket not in text:
    raise RuntimeError('capital markets ticket anchor missing')
text = text.replace(old_ticket, new_ticket, 1)
path.write_text(text)

# Navigation styling: keep the existing visual language, but group the hierarchy.
path = Path('src/styles.css')
text = path.read_text()
text = text.replace('.bank-departments { display:grid; grid-template-columns:repeat(4,minmax(0,1fr));', '.bank-departments { display:grid; grid-template-columns:repeat(5,minmax(0,1fr));', 1)
text = text.replace('.with-department .bank-departments { grid-template-columns:repeat(2,minmax(0,1fr));', '.with-department .bank-departments { grid-template-columns:repeat(2,minmax(0,1fr));', 1)
text = text.replace('@media(max-width:1150px) { .bank-workspace.with-department { grid-template-columns:minmax(0,1fr); } .with-department .bank-map { position:relative; top:auto; min-height:390px; } .with-department .bank-departments { grid-template-columns:repeat(4,minmax(0,1fr));', '@media(max-width:1150px) { .bank-workspace.with-department { grid-template-columns:minmax(0,1fr); } .with-department .bank-map { position:relative; top:auto; min-height:390px; } .with-department .bank-departments { grid-template-columns:repeat(3,minmax(0,1fr));', 1)
append = r'''

/* Functional information architecture */
.functional-navigation {
  display:flex;
  align-items:stretch;
  gap:6px;
  flex-wrap:wrap;
  padding:7px 8px;
  border:1px solid var(--border);
  border-radius:var(--radius);
  background:var(--panel);
  box-shadow:var(--card-shadow);
}
.functional-nav-group { display:flex; align-items:center; gap:4px; padding-right:6px; border-right:1px solid var(--border); }
.functional-nav-group:last-child { border-right:0; padding-right:0; }
.functional-nav-group-secondary { margin-left:auto; }
.functional-nav-label { color:var(--dim); font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; margin-right:2px; }
.functional-nav-button { border:1px solid transparent; background:transparent; color:var(--text); padding:6px 8px; font:inherit; font-weight:600; cursor:pointer; border-radius:6px; }
.functional-nav-button:hover { background:var(--ghost-bg); border-color:var(--border); }
.functional-nav-button.active { background:var(--accent); border-color:var(--accent); color:#fff; }
.functional-report-navigation,.area-report-links { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:8px 10px; border:1px solid var(--border); background:var(--bg-3); }
.functional-report-navigation strong,.area-report-links>div:first-child { margin-right:4px; }
.area-report-links>div:first-child { display:flex; flex-direction:column; }
.area-report-links small { color:var(--muted); }
.risk-area-building { background:#123746e8; }
@media(max-width:980px) { .functional-nav-group-secondary { margin-left:0; } .functional-navigation { align-items:flex-start; } .functional-nav-group { flex-wrap:wrap; } .bank-departments { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media(max-width:760px) { .functional-navigation { display:grid; grid-template-columns:1fr; } .functional-nav-group { border-right:0; border-bottom:1px solid var(--border); padding:3px 0 7px; } .functional-nav-group:last-child { border-bottom:0; } }
'''
if '/* Functional information architecture */' not in text:
    text += append
path.write_text(text)

# Update management-surface assertions to the new hierarchy.
path = Path('src/ui/managementSurface.test.tsx')
text = path.read_text()
text = text.replace(" expect(html).toContain('Bank reports and tools');expect(html).toContain('Manage a department');\n expect(html).toContain('Risk dashboard');expect(html).toContain('Regulatory metrics');expect(html).not.toContain('>Scenarios<');expect(html).not.toContain('<summary>Reports</summary>');",
" expect(html).toContain('Bank areas');expect(html).toContain('Bank functional areas');\n expect(html).toContain('Deposits');expect(html).toContain('Treasury &amp; Funding');expect(html).toContain('Finance &amp; Capital');expect(html).toContain('Risk &amp; Regulatory');\n expect(html).toContain('>Scenarios<');expect(html).not.toContain('Bank reports and tools');")
path.write_text(text)

# Boardroom tests: risk is now a fifth functional area.
path = Path('src/game/boardroom.test.tsx')
text = path.read_text()
text = text.replace('department={null} hasErrors onDepartment={noop} onClose={noop}', 'department={null} hasErrors onDepartment={noop} onRisk={noop} onClose={noop}')
text = text.replace('department={null} hasErrors={false} onDepartment={noop} onClose={noop}', 'department={null} hasErrors={false} onDepartment={noop} onRisk={noop} onClose={noop}')
text = text.replace("    expect(markup).toContain('Manage a department');\n    expect(markup.match(/class=\"department-building/g)).toHaveLength(4);", "    expect(markup).toContain('Bank functional areas');\n    expect(markup).toContain('Risk &amp; Regulatory');\n    expect(markup.match(/class=\"department-building/g)).toHaveLength(5);")
path.write_text(text)

# Capital-markets UI tests should reflect desk ownership.
path = Path('src/components/ActionsPanel.capitalMarkets.test.tsx')
text = path.read_text()
text = text.replace("expect(html).toContain('CET1 equity');", "expect(html).toContain('Equity issuance');\n    expect(html).toContain('CET1 equity');")
path.write_text(text)

print('functional navigation refactor applied')
