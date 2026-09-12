from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f"Could not find replacement target in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f"Could not find replacement target in {path}: {old[:120]!r}")
    write(path, text.replace(old, new))


# Department destinations, language and contextual teaching help.
path = 'src/components/DepartmentOffice.tsx'
replace_once(path,
"import { nelsonSiegelYield } from '../engine/ukMarketModel';\n",
"import { nelsonSiegelYield } from '../engine/ukMarketModel';\nimport type { RegulatoryMetric } from './RegMetricsPanel';\n")
replace_once(path,
" onReport:(tab:string)=>void; onHelp:(id:string)=>void; estimate:BankState|null;\n",
" onReport:(tab:string,metric?:RegulatoryMetric,origin?:Department)=>void; onHelp:(id:string)=>void; estimate:BankState|null;\n")
replace_once(path,
"const reportLinks:Partial<Record<Department,Array<[string,string]>>>={\n Lending:[['Loans','Loan portfolio']],\n Capital:[['Performance','Performance'],['Accounts','Accounts'],['Share Price','Share price'],['Costs','Costs']],\n Treasury:[['Regulatory','Liquidity & prudential detail']],\n};\n",
"const reportLinks:Partial<Record<Department,Array<[string,string,RegulatoryMetric?]>>>={\n Lending:[['Loans','Loan portfolio']],\n Capital:[['Performance','Performance'],['Accounts','Accounts'],['Share Price','Share price'],['Costs','Costs']],\n Treasury:[['Regulatory','Liquidity coverage','lcr'],['Regulatory','Stable funding','nsfr']],\n};\nconst helpLinks:Record<Department,[string,string]>={\n Customers:['deposit-behaviour','How deposit pricing works'],\n Lending:['loan-pipeline','How pricing and selectivity affect lending'],\n Treasury:['funding-ladder-and-rollover','How funding and maturities work'],\n Capital:['tier2-and-equity','How capital instruments differ'],\n};\n")
replace_once(path,
"export default function DepartmentOffice({department,state,history,form,errors,hasErrors,onChange,onReport,capitalMarketsQuote,capitalMarketsPlanImpact}:Props) {",
"export default function DepartmentOffice({department,state,history,form,errors,hasErrors,onChange,onReport,onHelp,capitalMarketsQuote,capitalMarketsPlanImpact}:Props) {")
replace_once(path,"['Instant savings',state.market.competitorRetailCurrentAccountRate],","['Retail current accounts',state.market.competitorRetailCurrentAccountRate],")
replace_once(path,
" const reports=reportLinks[department]??[];\n return <div className=\"department-office\">",
" const reports=reportLinks[department]??[];\n const [helpId,helpLabel]=helpLinks[department];\n return <div className=\"department-office\">")
replace_once(path,
"  <ActionsPanel department={department} state={form} onChange={onChange} disabled={state.status.hasFailed} errors={errors} hasValidationErrors={hasErrors} giltQuotedYield={giltQuotedYield} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpact={capitalMarketsPlanImpact}/>\n  {reports.length>0&&<nav className=\"area-report-links\" aria-label={`${labels[department]} reports`}><div><strong>Reports</strong><small>Open the detailed view when you need it.</small></div>{reports.map(([tab,label])=><button key={tab} className=\"button ghost\" onClick={()=>onReport(tab)}>{label} →</button>)}</nav>}\n",
"  <ActionsPanel department={department} state={form} onChange={onChange} disabled={state.status.hasFailed} errors={errors} hasValidationErrors={hasErrors} giltQuotedYield={giltQuotedYield} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpact={capitalMarketsPlanImpact}/>\n  <section className=\"department-guidance\" aria-label={`${labels[department]} decision guide`}><div><strong>Decision guide</strong><small>Open the relevant explanation without leaving this decision context behind.</small></div><button className=\"button ghost\" onClick={()=>onHelp(helpId)}>{helpLabel} →</button></section>\n  {reports.length>0&&<nav className=\"area-report-links\" aria-label={`${labels[department]} reports`}><div><strong>Reports</strong><small>Open the detailed view when you need it.</small></div>{reports.map(([tab,label,metric])=><button key={`${tab}-${metric??label}`} className=\"button ghost\" onClick={()=>onReport(tab,metric,department)}>{label} →</button>)}</nav>}\n")

# Controlled regulatory metric selection so Treasury deep-links land on the intended report.
path = 'src/components/RegMetricsPanel.tsx'
replace_once(path,"type Metric = 'capital' | 'rwa' | 'leverage' | 'lcr' | 'nsfr';","export type RegulatoryMetric = 'capital' | 'rwa' | 'leverage' | 'lcr' | 'nsfr';")
replace_once(path,
"interface Props { state: BankState; history: BankState[]; config: SimulationConfig; pendingRiskAppetite?:RiskAppetite|null; onRiskAppetite?:(t:RiskAppetite|null)=>void; attribution?: StepAttribution | null; onAttributionLineSelect?: (s: AttributionLineSelection) => void; }",
"interface Props { state: BankState; history: BankState[]; config: SimulationConfig; metric?:RegulatoryMetric; onMetricChange?:(metric:RegulatoryMetric)=>void; pendingRiskAppetite?:RiskAppetite|null; onRiskAppetite?:(t:RiskAppetite|null)=>void; attribution?: StepAttribution | null; onAttributionLineSelect?: (s: AttributionLineSelection) => void; }")
replace_all(path,"metric: Metric","metric: RegulatoryMetric")
replace_once(path,
"export default function RegMetricsPanel({ state, history, config, pendingRiskAppetite, onRiskAppetite }: Props) {\n  const [metric, setMetric] = useState<Metric>('capital');\n  const labels: Record<Metric, string> = { capital: 'Capital', rwa: 'Risk-weighted assets', leverage: 'Leverage', lcr: 'Liquidity coverage', nsfr: 'Stable funding' };",
"export default function RegMetricsPanel({ state, history, config, metric: controlledMetric, onMetricChange, pendingRiskAppetite, onRiskAppetite }: Props) {\n  const [internalMetric, setInternalMetric] = useState<RegulatoryMetric>('capital');\n  const metric=controlledMetric??internalMetric;\n  const setMetric=(next:RegulatoryMetric)=>{setInternalMetric(next);onMetricChange?.(next);};\n  const labels: Record<RegulatoryMetric, string> = { capital: 'Capital', rwa: 'Risk-weighted assets', leverage: 'Leverage', lcr: 'Liquidity coverage', nsfr: 'Stable funding' };")
replace_all(path,"as Metric[]","as RegulatoryMetric[]")

# LCR default detail is aggregated; raw contributions render only when expanded and use sensible units.
path = 'src/components/LcrDashboard.tsx'
replace_once(path,"import { BankState } from '../domain/bankState';","import { useState } from 'react';\nimport { BankState } from '../domain/bankState';")
old = "const contributionRows=(contributions:LcrContribution[]):[string,string][]=>contributions.map(c=>[\n `${c.corep} · ${c.label}${c.capClass?` · ${c.capClass}% cap`:''}`,\n `${formatCurrency(c.amount)} × ${formatPct(c.factor,0)} = ${formatCurrency(c.weighted)}`,\n]);\n"
new = "type ContributionAggregate={label:string;amount:number;factor:number;weighted:number;count:number};\nconst detailCurrency=(value:number):string=>{\n const abs=Math.abs(value);\n if(abs>=1e9)return `£${(value/1e9).toFixed(2)}bn`;\n if(abs>=1e6)return `£${(value/1e6).toFixed(abs>=1e8?0:1)}m`;\n if(abs>=1e3)return `£${(value/1e3).toFixed(abs>=1e5?0:1)}k`;\n return `£${value.toFixed(0)}`;\n};\nexport const aggregateContributions=(contributions:LcrContribution[]):ContributionAggregate[]=>{\n const grouped=new Map<string,ContributionAggregate>();\n contributions.forEach(c=>{\n  const label=`${c.corep} · ${c.label}${c.capClass?` · ${c.capClass}% cap`:''}`;\n  const key=`${label}|${c.factor}`;\n  const row=grouped.get(key);\n  if(row){row.amount+=c.amount;row.weighted+=c.weighted;row.count+=1;}\n  else grouped.set(key,{label,amount:c.amount,factor:c.factor,weighted:c.weighted,count:1});\n });\n return [...grouped.values()];\n};\nconst contributionRows=(contributions:LcrContribution[]):[string,string][]=>aggregateContributions(contributions).map(c=>[\n `${c.label}${c.count>1?` · ${c.count} contributions`:''}`,\n `${detailCurrency(c.amount)} × ${formatPct(c.factor,0)} = ${detailCurrency(c.weighted)}`,\n]);\nconst underlyingContributionRows=(contributions:LcrContribution[]):[string,string][]=>contributions.map(c=>[\n `${c.corep} · ${c.label} · ${c.sourceLabel}${c.capClass?` · ${c.capClass}% cap`:''}`,\n `${detailCurrency(c.amount)} × ${formatPct(c.factor,0)} = ${detailCurrency(c.weighted)}`,\n]);\n"
replace_once(path, old, new)
replace_once(path,
"function DetailTable({title,rows}:{title:string;rows:[string,string][]}) {return <section className=\"lcr-detail-group\"><h4>{title}</h4><table><tbody>{rows.map(([label,value],i)=><tr key={`${label}-${i}`}><th scope=\"row\">{label}</th><td>{value}</td></tr>)}</tbody></table></section>;}\n",
"function DetailTable({title,rows}:{title:string;rows:[string,string][]}) {return <section className=\"lcr-detail-group\"><h4>{title}</h4><table><tbody>{rows.map(([label,value],i)=><tr key={`${label}-${i}`}><th scope=\"row\">{label}</th><td>{value}</td></tr>)}</tbody></table></section>;}\nfunction ContributionDetailTable({title,contributions,totalLabel,totalValue}:{title:string;contributions:LcrContribution[];totalLabel?:string;totalValue?:number}) {\n const [expanded,setExpanded]=useState(false);\n const rows=contributionRows(contributions);\n if(totalLabel&&totalValue!==undefined)rows.push([totalLabel,detailCurrency(totalValue)]);\n return <section className=\"lcr-contribution-detail\"><DetailTable title={title} rows={rows}/><details onToggle={event=>setExpanded(event.currentTarget.open)}><summary>Show {contributions.length} underlying contributions</summary>{expanded&&<DetailTable title={`${title} — underlying contributions`} rows={underlyingContributionRows(contributions)}/>}</details></section>;\n}\n")
replace_once(path,
"   <div className=\"capital-amounts\"><div><b>{formatCurrency(d.hqla.total)}</b><span>C76 liquidity buffer</span></div><div><b>{formatCurrency(d.required)}</b><span>HQLA required</span></div><div><b className=\"capital-gap\">{signed(d.surplus)}</b><span>Liquidity surplus</span></div></div><p className=\"muted\">Liquidity buffer ÷ C76 30-day net liquidity outflow.</p>\n",
"   <div className=\"capital-amounts\"><div><b>{formatCurrency(d.hqla.total)}</b><span>C76 liquidity buffer</span></div><div><b>{formatCurrency(d.required)}</b><span>HQLA required</span></div><div><b className=\"capital-gap\">{signed(d.surplus)}</b><span>Liquidity surplus</span></div></div><div className=\"lcr-headline-history\"><h4>LCR over time</h4><div style={{height:180}}><TimeSeriesChart data={history.map(s=>({step:s.time.step,value:s.risk.riskMetrics.lcr}))} xLabel=\"Month\" yLabel=\"LCR (%)\"/></div></div><p className=\"muted\">Liquidity buffer ÷ C76 30-day net liquidity outflow.</p>\n")
replace_once(path,
"  <DetailTable title=\"C72 — Liquid assets\" rows={contributionRows(d.report.liquidAssets)}/>\n  <DetailTable title=\"C73 — Outflows\" rows={[...contributionRows(d.report.outflows),['Total weighted outflows',formatCurrency(d.outgoing)]]}/>\n  <DetailTable title=\"C74 — Inflows\" rows={[...contributionRows(d.report.inflows),['Total weighted inflows',formatCurrency(d.incoming)]]}/>\n",
"  <ContributionDetailTable title=\"C72 — Liquid assets\" contributions={d.report.liquidAssets}/>\n  <ContributionDetailTable title=\"C73 — Outflows\" contributions={d.report.outflows} totalLabel=\"Total weighted outflows\" totalValue={d.outgoing}/>\n  <ContributionDetailTable title=\"C74 — Inflows\" contributions={d.report.inflows} totalLabel=\"Total weighted inflows\" totalValue={d.incoming}/>\n")
replace_once(path,
" <section className=\"capital-card lcr-history\"><h3>LCR over time</h3><div style={{height:270}}><TimeSeriesChart data={history.map(s=>({step:s.time.step,value:s.risk.riskMetrics.lcr}))} xLabel=\"Month\" yLabel=\"LCR (%)\"/></div><p className=\"muted\">Management stress estimate: {ratioText(state.risk.riskMetrics.managementLcr??state.risk.riskMetrics.lcr)}. This uses behavioural stress assumptions and is separate from the reported COR011 LCR.</p></section>\n",
" <section className=\"capital-card lcr-history-note\"><h3>Management stress view</h3><p className=\"muted\">Management stress estimate: {ratioText(state.risk.riskMetrics.managementLcr??state.risk.riskMetrics.lcr)}. This uses behavioural stress assumptions and is separate from the reported COR011 LCR.</p></section>\n")

# App navigation consistency, report deep-links, per-session controller and contextual review routes.
path = 'src/App.tsx'
replace_once(path,"import RegMetricsPanel from './components/RegMetricsPanel';","import RegMetricsPanel, { type RegulatoryMetric } from './components/RegMetricsPanel';")
replace_once(path,"const controller = new SimulationController(baseConfig);\n","")
replace_once(path,
"  const [simConfig, setSimConfig] = useState<SimulationConfig>(baseConfig);\n",
"  const [simConfig, setSimConfig] = useState<SimulationConfig>(baseConfig);\n  const controller = useMemo(() => new SimulationController(simConfig), [simConfig]);\n")
replace_once(path,
"  const [activeTab, setActiveTab] = useState<string>('Boardroom');\n",
"  const [activeTab, setActiveTab] = useState<string>('Boardroom');\n  const [regulatoryMetric, setRegulatoryMetric] = useState<RegulatoryMetric>('capital');\n  const [reportOriginDepartment, setReportOriginDepartment] = useState<Department|null>(null);\n")
replace_once(path,
"  const openDepartment = (department: Department) => { setAutoRemaining(null); setPauseReason('Paused for a policy decision.'); setActiveDepartment(department); setIsActionsOpen(true); setActiveTab('Boardroom'); };\n  const openReport = (tab: string) => { setIsActionsOpen(false); setActiveTab(tab); };\n",
"  const openDepartment = (department: Department) => { setAutoRemaining(null); setPauseReason('Paused for a policy decision.'); setReportOriginDepartment(null); setActiveDepartment(department); setIsActionsOpen(true); setActiveTab('Boardroom'); };\n  const goToBoardroom = () => { setAutoRemaining(null); setReportOriginDepartment(null); setIsActionsOpen(false); setActiveTab('Boardroom'); };\n  const openReport = (tab: string, metric?: RegulatoryMetric, origin: Department|null = null) => { setIsActionsOpen(false); setReportOriginDepartment(origin); if(tab==='Regulatory'&&metric)setRegulatoryMetric(metric); setActiveTab(tab); };\n")
replace_all(path,"    controller.setConfig(simConfig);\n","")
replace_once(path,"    controller.setConfig(scenarioConfig);\n    setSimConfig(scenarioConfig);","    setSimConfig(scenarioConfig);")
replace_once(path,"    controller.setConfig(nextConfig); setSimConfig(nextConfig);","    setSimConfig(nextConfig);")
replace_once(path,
"        <button className=\"brand\" onClick={() => setActiveTab('Boardroom')} aria-label=\"BankSim boardroom\">",
"        <button className=\"brand\" onClick={goToBoardroom} aria-label=\"BankSim boardroom\">")
replace_once(path,
"        onBoardroom={()=>{setIsActionsOpen(false);setActiveTab('Boardroom');}}\n",
"        onBoardroom={goToBoardroom}\n")
replace_once(path,
"      </section>\n      {attentionReason(bankState,simConfig)&&!bankState.status.hasFailed&&<div className=\"attention-banner\">",
"      </section>\n      {stateHistory.length>1&&<nav className=\"post-close-links\" aria-label=\"Review last close\"><strong>Review last close</strong><button className=\"button ghost\" onClick={()=>openReport('Events')}>Event log</button><button className=\"button ghost\" onClick={()=>openReport('Reconciliations')}>Reconciliations</button></nav>}\n      {attentionReason(bankState,simConfig)&&!bankState.status.hasFailed&&<div className=\"attention-banner\">")
replace_once(path,
"      {activeTab !== 'Boardroom' && <div className=\"report-breadcrumb\"><button className=\"button ghost\" onClick={()=>{setIsActionsOpen(false);setActiveTab('Boardroom');}}>← Back to bank</button><span>{activeTab==='Help'?'Reference library':tabLabels[activeTab]??activeTab}</span></div>}\n",
"      {activeTab !== 'Boardroom' && <div className=\"report-breadcrumb\"><button className=\"button ghost\" onClick={()=>reportOriginDepartment?openDepartment(reportOriginDepartment):goToBoardroom()}>← Back to {reportOriginDepartment??'bank'}</button><span>{activeTab==='Help'?'Reference library':tabLabels[activeTab]??activeTab}</span></div>}\n")
replace_once(path,
"      {activeTab === 'Regulatory' && (\n        <section className=\"stack\">\n      <h2>Regulatory metrics</h2>\n      <RegMetricsPanel\n        state={bankState}\n        history={stateHistory}\n        config={simConfig}\n",
"      {activeTab === 'Regulatory' && (\n        <section className=\"stack\">\n      <RegMetricsPanel\n        state={bankState}\n        history={stateHistory}\n        config={simConfig}\n        metric={regulatoryMetric}\n        onMetricChange={setRegulatoryMetric}\n")

# CI calibration coverage and Pages deployment gating.
replace_once('.github/workflows/ci.yml','        suite: [fast, regression]\n','        suite: [fast, regression, calibration]\n')
replace_once('.github/workflows/deploy.yml','      - run: npm ci\n      - run: npm run build\n','      - run: npm ci\n      - run: npm run test\n      - run: npm run typecheck\n      - run: npm run build\n')

# Layout and detail affordances. Appended overrides keep this change isolated from the existing visual system.
styles = read('src/styles.css')
styles += """

/* Review pass: prioritise decision space once a department is open. */
@media(min-width:1151px) {
  .bank-workspace.with-department { grid-template-columns:minmax(280px,.55fr) minmax(620px,1.45fr); }
  .with-department .bank-map { min-height:500px; }
  .with-department .bank-map-heading { padding:22px 24px; }
  .with-department .bank-map-heading h1 { font-size:28px; margin:8px 0; }
  .with-department .bank-map-heading p { display:none; }
  .with-department .bank-departments { margin:42px 16px 16px; gap:8px; }
  .with-department .department-building { padding:12px; }
  .with-department .department-building>strong,
  .with-department .department-building>small,
  .with-department .department-status { display:none; }
  .with-department .department-name { margin-bottom:2px; }
  .with-department .department-job { margin-top:2px; }
}
.department-guidance,.post-close-links { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 12px; border:1px solid var(--border); background:var(--bg-2); }
.department-guidance>div { display:flex; flex:1; min-width:220px; flex-direction:column; gap:2px; }
.department-guidance small { color:var(--muted); }
.post-close-links { margin:-8px 0 18px; font-size:13px; }
.post-close-links strong { margin-right:4px; }
.lcr-contribution-detail>details { margin:-8px 0 16px; padding:0 10px 10px; border:1px solid var(--border); border-top:0; border-radius:0 0 7px 7px; }
.lcr-contribution-detail>details>summary { cursor:pointer; color:var(--accent); font-weight:650; padding:8px 0 2px; }
.lcr-contribution-detail>details .lcr-detail-group { margin:10px 0 0; }
.lcr-headline-history { margin-top:16px; padding-top:12px; border-top:1px solid var(--border); }
.lcr-headline-history h4 { margin-top:0; }
.lcr-history-note { grid-column:1/-1; }
"""
write('src/styles.css', styles)

# Refresh the department test and add event-handler coverage for Treasury deep links.
write('src/ui/departmentOffice.test.tsx', """import { describe,it,expect,vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DepartmentOffice from '../components/DepartmentOffice';
import { ActionFormState } from '../components/ActionsPanel';
import { initialState } from '../config/initialState';

const form:ActionFormState={
 retailCurrentAccountRate:'2%',termDepositRate:'3.8%',termDepositTenorMonths:'12',corporateDepositRate:'3%',mortgageRate:'5%',consumerLoanRate:'10.5%',corporateLoanRate:'6%',
 mortgageUnderwritingTightness:'.5',consumerUnderwritingTightness:'.5',corporateUnderwritingTightness:'.5',mortgageMaxLtv:'.85',mortgageFixedPeriodMonths:'24',
 capitalMarketsInstrument:'none',capitalMarketsTargetAmount:'',capitalMarketsMaxDiscount:'15%',capitalMarketsMaxSpreadBps:'1000',capitalMarketsTenorMonths:'60',
 dividendPayoutRatio:'.3',at1CouponMode:'auto',giltTradeDirection:'buy',giltTradeAmount:'250m',giltDurationYears:'5',boeFacility:'none',boeFundingAmount:'',hedgeDirection:'none',hedgeNotional:'',hedgeFixedRate:'',hedgeMaturityMonths:'24'
};
const noop=()=>{};
const props={state:initialState,history:[initialState],form,errors:{},hasErrors:false,onChange:noop,onReport:noop,onHelp:noop,estimate:null};

const findButton=(node:ReactNode,text:string):ReactElement|null=>{
 if(!node||typeof node==='string'||typeof node==='number'||typeof node==='boolean')return null;
 if(Array.isArray(node)){for(const child of node){const found=findButton(child,text);if(found)return found;}return null;}
 const element=node as ReactElement<{children?:ReactNode;onClick?:()=>void}>;
 const label=renderToStaticMarkup(element).replace(/<[^>]+>/g,'');
 if(element.type==='button'&&label.includes(text))return element;
 return findButton(element.props.children,text);
};

describe('Department decision destinations',()=>{
 it('keeps lending controls and market references while providing contextual help',()=>{
  const html=renderToStaticMarkup(<DepartmentOffice department="Lending" {...props}/>);
  expect(html).toContain('Undrawn commitments');expect(html).toContain('Approvals this quarter');
  expect(html).toContain('Mortgages');expect(html).toContain('value="5%"');expect(html).toContain('Selectivity');
  expect(html).toContain('Competitor rates');expect(html).toContain('New mortgages');expect(html).toContain('SME/business');
  expect(html).toContain('How pricing and selectivity affect lending');
 });
 it('uses current-account language for the retail sight-deposit market reference',()=>{
  const html=renderToStaticMarkup(<DepartmentOffice department="Customers" {...props}/>);
  expect(html).toContain('Retail current accounts');expect(html).not.toContain('Instant savings');
 });
 it('routes Treasury liquidity buttons to their intended regulatory metrics',()=>{
  const onReport=vi.fn();
  const tree=DepartmentOffice({department:'Treasury',...props,onReport});
  const lcr=findButton(tree,'Liquidity coverage');
  const nsfr=findButton(tree,'Stable funding');
  expect(lcr).not.toBeNull();expect(nsfr).not.toBeNull();
  lcr!.props.onClick?.();nsfr!.props.onClick?.();
  expect(onReport).toHaveBeenNthCalledWith(1,'Regulatory','lcr','Treasury');
  expect(onReport).toHaveBeenNthCalledWith(2,'Regulatory','nsfr','Treasury');
 });
 it('shows gilt investment as an explicit one-off trade with a live curve yield',()=>{
  const html=renderToStaticMarkup(<DepartmentOffice department="Treasury" {...props}/>);
  expect(html).toContain('Gilt transaction');expect(html).toContain('Buy gilts');expect(html).toContain('Sell gilts');
  expect(html).toContain('Gilt trade amount (£)');expect(html).toContain('Current simulated gilt yield:');
 });
});
""")

# LCR aggregation unit test protects the compact default representation.
write('src/ui/lcrDashboardAggregation.test.ts', """import { describe,it,expect } from 'vitest';
import { aggregateContributions } from '../components/LcrDashboard';
import type { LcrContribution } from '../domain/lcr';

describe('LCR dashboard contribution aggregation',()=>{
 it('groups repeated regulatory rows with the same factor while preserving totals',()=>{
  const rows:LcrContribution[]=[
   {template:'C74',corep:'C74 1.1',label:'Loan inflow',sourceLabel:'Cohort A',amount:2_000_000,factor:.5,weighted:1_000_000,capClass:'75'},
   {template:'C74',corep:'C74 1.1',label:'Loan inflow',sourceLabel:'Cohort B',amount:3_000_000,factor:.5,weighted:1_500_000,capClass:'75'},
   {template:'C74',corep:'C74 1.1',label:'Loan inflow',sourceLabel:'Cohort C',amount:1_000_000,factor:1,weighted:1_000_000,capClass:'75'},
  ];
  const grouped=aggregateContributions(rows);
  expect(grouped).toHaveLength(2);
  expect(grouped[0]).toMatchObject({amount:5_000_000,weighted:2_500_000,count:2,factor:.5});
  expect(grouped.reduce((sum,row)=>sum+row.weighted,0)).toBe(3_500_000);
 });
});
""")

print('Review recommendations applied successfully.')
