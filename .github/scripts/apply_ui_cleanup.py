from pathlib import Path

app_path = Path('src/App.tsx')
app = app_path.read_text()
app = app.replace('<h2>Regulatory Metrics</h2>', '<h2>Regulatory metrics</h2>')
app = app.replace('\n              onNavigateHelp={openHelpSection}', '')
app_path.write_text(app)

reg_path = Path('src/components/RegMetricsPanel.tsx')
reg = reg_path.read_text()
reg = reg.replace(
    'interface Props { state: BankState; history: BankState[]; config: SimulationConfig; pendingRiskAppetite?:RiskAppetite|null; onRiskAppetite?:(t:RiskAppetite|null)=>void; attribution?: StepAttribution | null; onAttributionLineSelect?: (s: AttributionLineSelection) => void; onNavigateHelp?: (id: string) => void; }',
    'interface Props { state: BankState; history: BankState[]; config: SimulationConfig; pendingRiskAppetite?:RiskAppetite|null; onRiskAppetite?:(t:RiskAppetite|null)=>void; attribution?: StepAttribution | null; onAttributionLineSelect?: (s: AttributionLineSelection) => void; }',
)
reg = reg.replace(
    '2026 UK standardised bank assumptions. Ratios use prescribed factors; internal stress estimates are shown separately. Configured Pillar 2A enters minimum requirements; the PRA buffer is a separate supervisory target. Full regulatory returns are outside this model.',
    '2026 UK standardised bank assumptions. Ratios use prescribed factors. Configured Pillar 2A enters minimum requirements; the PRA buffer is a separate supervisory target. Full regulatory returns are outside this model.',
)
reg_path.write_text(reg)
