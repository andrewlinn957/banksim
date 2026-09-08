from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing expected source for {label}")
    return text.replace(old, new, 1)


app_path = Path('src/App.tsx')
app = app_path.read_text()

app = replace_once(app, "import TopMetricsPanel from './components/TopMetricsPanel';", "import RiskDashboard from './components/RiskDashboard';", 'risk dashboard import')
app = replace_once(app, "import ExogenousVariablesPanel from './components/ExogenousVariablesPanel';\n", '', 'exogenous panel import')
app = replace_once(app, "import HelpLink from './components/HelpLink';\n", '', 'help link import')
app = replace_once(app, "import { formatCurrency, formatPct, formatSignedPct } from './utils/formatters';", "import { formatCurrency, formatPct } from './utils/formatters';", 'formatter import')
app = replace_once(app, "  'Scenarios',\n", '', 'visible scenarios tab')
app = replace_once(app, "  Overview: 'Overview',", "  Overview: 'Risk dashboard',", 'overview label')
app = replace_once(app, "  Regulatory: 'Capital & liquidity',", "  Regulatory: 'Regulatory metrics',", 'regulatory label')

app, count = re.subn(
    r"\ninterface TabHelpLink \{.*?\n\};\n\n(?=interface TutorialStepView)",
    "\n",
    app,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove tab mechanics reference registry')

app = replace_once(app, "  const contextualHelpLinks = tabHelpLinks[activeTab] ?? [];\n", '', 'contextual help links')

old_breadcrumb = "      {activeTab !== 'Boardroom' && <div className=\"report-breadcrumb\"><button className=\"button ghost\" onClick={()=>setActiveTab('Boardroom')}>← Back to bank</button><span>{activeTab==='Scenarios'?'Scenario tools':activeTab==='Help'?'Reference library':`${activeTab} report`}</span>{['Loans','Regulatory','Accounts'].includes(activeTab)&&<button className=\"button\" onClick={()=>openDepartment(activeTab==='Loans'?'Lending':activeTab==='Costs'?'Treasury':'Capital')}>Manage {activeTab==='Loans'?'lending':activeTab==='Costs'?'treasury':'capital'} →</button>}</div>}"
new_breadcrumb = "      {activeTab !== 'Boardroom' && <div className=\"report-breadcrumb\"><button className=\"button ghost\" onClick={()=>setActiveTab('Boardroom')}>← Back to bank</button><span>{activeTab==='Help'?'Reference library':tabLabels[activeTab]??activeTab}</span>{['Loans','Regulatory','Accounts'].includes(activeTab)&&<button className=\"button\" onClick={()=>openDepartment(activeTab==='Loans'?'Lending':activeTab==='Costs'?'Treasury':'Capital')}>Manage {activeTab==='Loans'?'lending':activeTab==='Costs'?'treasury':'capital'} →</button>}</div>}"
app = replace_once(app, old_breadcrumb, new_breadcrumb, 'report breadcrumb')

app, count = re.subn(
    r"\n      \{activeTab !== 'Help' && contextualHelpLinks\.length > 0 && \(.*?\n      \)\}\n",
    "\n",
    app,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove mechanics reference strip')

app, count = re.subn(
    r"      \{activeTab === 'Overview' && \(.*?\n      \)\}\n\n      \{activeTab === 'Share Price' && \(",
    "      {activeTab === 'Overview' && (\n        <RiskDashboard state={bankState} config={simConfig} attribution={lastAttribution} />\n      )}\n\n      {activeTab === 'Share Price' && (",
    app,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not replace Overview with RiskDashboard')

app = app.replace("'Go to Overview and inspect Last step attribution.'", "'Go to Risk dashboard and inspect the last-close changes.'")
app = app.replace("'Open Overview after running one month.'", "'Open Risk dashboard after running one month.'")
app = app.replace("primaryActionLabel: 'Go to Overview'", "primaryActionLabel: 'Go to Risk dashboard'")
app = app.replace("          <h2>Regulatory Metrics</h2>", "          <h2>Regulatory metrics</h2>")
app = app.replace("\n        onNavigateHelp={openHelpSection}", '')

app_path.write_text(app)

risk_path = Path('src/components/RiskDashboard.tsx')
risk = risk_path.read_text()
risk = replace_once(risk, "import { formatCurrency, formatPct, formatSignedPct } from '../utils/formatters';", "import { formatCurrency, formatPct, formatSignedPct } from '../utils/formatters';\nimport './RiskDashboard.css';", 'risk dashboard stylesheet')
risk_path.write_text(risk)

reg_path = Path('src/components/RegMetricsPanel.tsx')
reg = reg_path.read_text()
reg = replace_once(
    reg,
    "export default function RegMetricsPanel({ state, history, config, onNavigateHelp, pendingRiskAppetite, onRiskAppetite }: Props) {",
    "export default function RegMetricsPanel({ state, history, config, pendingRiskAppetite, onRiskAppetite }: Props) {",
    'regulatory panel signature',
)
reg = replace_once(
    reg,
    '<div className="section-heading"><div><div className="eyebrow">Know your headroom</div><h2>Prudential dashboard</h2></div><button className="button ghost" onClick={() => onNavigateHelp?.(\'liquidity-ratios\')}>How to read this</button></div>',
    '<div className="section-heading"><div><div className="eyebrow">Regulatory metrics</div><h3>{labels[metric]}</h3></div></div>',
    'regulatory heading',
)
management_text = '<div className="policy-note"><strong>Management stress estimates</strong><p>LCR {formatPct(state.risk.riskMetrics.managementLcr ?? state.risk.riskMetrics.lcr)} · NSFR {formatPct(state.risk.riskMetrics.managementNsfr ?? state.risk.riskMetrics.nsfr)}</p><p>These apply behavioural assumptions. They are not the reported prudential ratios.</p></div><p className="muted">Inside the combined buffer, bank policy suspends distributions. The policy payout cap is not a calculation of the PRA maximum distributable amount.</p>'
reg = replace_once(reg, management_text, '', 'management stress copy')
reg_path.write_text(reg)

explainer_path = Path('src/components/AttributionMechanicExplainer.tsx')
explainer = explainer_path.read_text()
explainer = replace_once(explainer, "import HelpLink from './HelpLink';\n", '', 'attribution help import')
explainer = replace_once(explainer, "  onNavigateHelp?: (sectionId: string) => void;\n", '', 'attribution help prop')
explainer = replace_once(explainer, "const AttributionMechanicExplainer = ({ selection, onNavigateHelp }: Props) => {", "const AttributionMechanicExplainer = ({ selection }: Props) => {", 'attribution signature')
explainer, count = re.subn(
    r"      <div className=\"metric-help-actions\">\s*<span className=\"muted\">\s*Linked events: \{selection\.eventIds\.length\}\s*</span>\s*\{onNavigateHelp \? \(.*?\) : null\}\s*</div>",
    '      <div className="metric-help-actions"><span className="muted">Linked events: {selection.eventIds.length}</span></div>',
    explainer,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove attribution mechanic link')
explainer_path.write_text(explainer)

management_test_path = Path('src/ui/managementSurface.test.tsx')
test = management_test_path.read_text()
test = replace_once(test, "expect(html).toContain('Capital &amp; liquidity');", "expect(html).toContain('Risk dashboard');expect(html).toContain('Regulatory metrics');expect(html).not.toContain('>Scenarios<');", 'management navigation test')
management_test_path.write_text(test)
