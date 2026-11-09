import DepartmentOffice from './components/DepartmentOffice';
import RiskAppetiteEditor, { RiskAppetite } from './components/RiskAppetiteEditor';
import PerformanceReport from './components/PerformanceReport';
import { Department } from './game/departments';
import { attentionReason, customerDeposits } from './game/management';
import Boardroom from './components/Boardroom';
import FunctionalNavigation from './components/FunctionalNavigation';
import FunctionalReportNavigation from './components/FunctionalReportNavigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { initialState } from './config/initialState';
import { baseConfig } from './config/baseConfig';
import { BankState } from './domain/bankState';
import { PlayerAction } from './domain/actions';
import {
  BalanceSheetSide,
} from './domain/enums';
import RiskDashboard from './components/RiskDashboard';
import type { ActionFormState, StepPreview } from './application/playerControls';
import type { CapitalMarketsPlanImpact } from './presentation/quotes';
import { buildPendingActionLabels, parseActionFormInputs } from './application/playerControls';
import { calculatePlayerNextCloseForecast } from './application/playerPreview';
import { createActionFormState } from './application/actionFormState';
import { useSimulationClock } from './ui/useSimulationClock';
import { prepareScenarioSession } from './application/scenarioSession';
import { useRunSession } from './ui/useRunSession';
import EventLog from './components/EventLog';
import ScenarioSelector from './components/ScenarioSelector';
import ScenarioBriefingPanel from './components/ScenarioBriefingPanel';
import { buildScenarioBriefing } from './game/scenarioBriefing';
import { scenarios } from './config/scenarios';
import { SimulationEvent } from './engine/simulation';
import { ComplianceStatus, RiskMetrics } from './domain/risks';
import RegMetricsPanel, { type RegulatoryMetric } from './components/RegMetricsPanel';
import LoansPanel from './components/LoansPanel';
import CreditLossesPanel from './components/CreditLossesPanel';
import CostsPanel from './components/CostsPanel';
import ReconciliationPanel from './components/ReconciliationPanel';
import { SimulationConfig } from './domain/config';
import { SimulationController } from './application/simulationController';
import AccountsPanel from './components/AccountsPanel';
import { formatCurrency, formatPct } from './utils/formatters';
import { buildScenarioProgressReport } from './presentation/reports/scenario';
import RunComparisonPanel from './components/RunComparisonPanel';
import { AttributionLineSelection, StepAttribution } from './domain/attribution';
import SharePricePanel from './components/SharePricePanel';
import HelpCenterPanel from './components/HelpCenterPanel';
import AttributionMechanicExplainer from './components/AttributionMechanicExplainer';
import { createDefaultThreeYearPlan } from './config/threeYearPlan';
import { buildCapitalMarketsPlanImpactText, buildPlayerCapitalMarketsQuote } from './presentation/quotes';
import { getCapitalMarketsInstrument } from './capitalMarkets/catalogue';
import { PRODUCTS } from './products/catalogue';
import { loanCarryingAmounts } from './products/loanBalances';
import { capitalReconciliation } from './engine/capitalReconciliation';
import { creditStageDiagnostics } from './engine/creditStageDiagnostics';
import { buildPlayerRunExtract } from './application/playerExport';
import { closePlayerSessionMonth, type PlayerSessionState } from './application/playerSession';
import { monthsForPlayerAdvance } from './application/playerTime';
import { SEED_SCHEME_VERSION } from './engine/seedScheme';

let fallbackRunIdSequence = 0;
const createBrowserRunId = (): string => `browser-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++fallbackRunIdSequence}`}`;


const App = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [simConfig, setSimConfig] = useState<SimulationConfig>(baseConfig);
  const controller = useMemo(() => new SimulationController(simConfig), [simConfig]);
  const [pendingRiskAppetite, setPendingRiskAppetite] = useState<RiskAppetite|null|undefined>();
  const [bankState, setBankState] = useState<BankState>(initialState);
  const [browserRunId, setBrowserRunId] = useState(createBrowserRunId);
  const [stateHistory, setStateHistory] = useState<BankState[]>([initialState]);
  const [eventLog, setEventLog] = useState<SimulationEvent[]>([]);
  const [actionForm, setActionForm] = useState<ActionFormState>(() => createActionFormState(initialState, baseConfig));
  const [capitalMarketsDraftArea, setCapitalMarketsDraftArea] = useState<'Capital' | 'Treasury' | null>(null);
  const parsedActionForm = useMemo(() => parseActionFormInputs(actionForm), [actionForm]);
  const clockTickRef = useRef<() => void>(() => {});
  const clock = useSimulationClock({
    canRun: !bankState.status.hasFailed && !parsedActionForm.hasErrors,
    onTick: () => clockTickRef.current(),
  });
  const { autoRemaining, clockRunning, clockSpeed, setClockSpeed, pauseReason, safetyPause, setSafetyPause } = clock;
  const [lastAttribution, setLastAttribution] = useState<StepAttribution | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Boardroom');
  const [regulatoryMetric, setRegulatoryMetric] = useState<RegulatoryMetric>('capital');
  const [reportOriginDepartment, setReportOriginDepartment] = useState<Department|null>(null);
  const [helpSectionFocus, setHelpSectionFocus] = useState<string | null>(null);
  const [highlightedEventIds, setHighlightedEventIds] = useState<string[]>([]);
  const [selectedAttributionLine, setSelectedAttributionLine] = useState<AttributionLineSelection | null>(null);
  const [extractStatus, setExtractStatus] = useState<'idle'|'copied'|'failed'>('idle');
  const responsibleDepartment:Department = bankState.risk.riskMetrics.internalCet1Headroom<0 || bankState.risk.riskMetrics.cet1Ratio<=bankState.risk.riskMetrics.cet1Requirement || bankState.risk.riskMetrics.praBufferBreached || bankState.risk.compliance.ownFundsBreached || bankState.risk.riskMetrics.leverageRatio<=Math.max(simConfig.riskLimits.minLeverageRatio,bankState.behaviour.riskAppetite?.leverage??simConfig.riskLimits.minLeverageRatio*1.05) ? 'Capital':'Treasury';
  const openDepartment = (department: Department) => { clock.stop('Paused for a policy decision.'); setReportOriginDepartment(null); setActiveDepartment(department); setIsActionsOpen(true); setActiveTab('Boardroom'); };
  const goToBoardroom = () => { clock.stop(); setReportOriginDepartment(null); setIsActionsOpen(false); setActiveTab('Boardroom'); };
  const openReport = (tab: string, metric?: RegulatoryMetric, origin: Department|null = null) => { setIsActionsOpen(false); setReportOriginDepartment(origin); if(tab==='Regulatory'&&metric)setRegulatoryMetric(metric); setActiveTab(tab); };

  const startClock = (months: number) => clock.start(months);
  const pauseClock = () => clock.pause();

  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [activeDepartment, setActiveDepartment] = useState<Department>('Customers');
  const [runPeriod, setRunPeriod] = useState<'month' | 'quarter' | 'year' | 'auto'>('quarter');
  const navigationDepartment: Department | null = activeTab==='Boardroom' ? (isActionsOpen ? activeDepartment : null) : ['Loans','Credit Losses'].includes(activeTab) ? 'Lending' : ['Performance','Accounts','Share Price','Costs'].includes(activeTab) ? 'Capital' : activeTab==='Regulatory' ? reportOriginDepartment : null;
  const pendingActions = buildPendingActionLabels(actionForm, pendingRiskAppetite);
  const runSession = useRunSession(controller, initialState);
  const { savedRuns, currentTimeline, currentSnapshots } = runSession;
  const threeYearPlanEnabled = Boolean(bankState.threeYearPlan?.enabled);
  const canToggleThreeYearPlan = activeScenarioId === null && bankState.time.step === stateHistory[0].time.step;
  const setThreeYearPlanMode = (enabled: boolean) => {
    if (!canToggleThreeYearPlan) return;
    const nextConfig: SimulationConfig = { ...simConfig, featureFlags: { ...(simConfig.featureFlags ?? {}), threeYearPlan: enabled } };
    const nextState: BankState = { ...bankState, threeYearPlan: enabled ? createDefaultThreeYearPlan(bankState) : undefined };
    setSimConfig(nextConfig); setBankState(nextState); setStateHistory([nextState]); setBrowserRunId(createBrowserRunId()); runSession.reset(nextState);
  };

  const totalEquity = useMemo(
    () =>
      bankState.financial.capital.cet1 +
      bankState.financial.capital.at1 +
      bankState.financial.capital.accumulatedOCI,
    [bankState.financial.capital]
  );
  const totalAssets = useMemo(
    () =>
      bankState.financial.balanceSheet.items
        .filter((i) => i.side === BalanceSheetSide.Asset)
        .reduce((sum, i) => sum + i.balance, 0),
    [bankState.financial.balanceSheet]
  );

  const roe = totalEquity > 0 ? bankState.financial.incomeStatement.netIncome * 12 / totalEquity : 0;
  const nim = totalAssets > 0 ? bankState.financial.incomeStatement.netInterestIncome * 12 / totalAssets : 0;

  const previousFranchiseStrength =
    stateHistory.length >= 2 ? stateHistory[stateHistory.length - 2].behaviour.depositFranchiseStrength : null;
  const franchiseDeltaMoM =
    previousFranchiseStrength === null
      ? null
      : bankState.behaviour.depositFranchiseStrength - previousFranchiseStrength;
  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) ?? null,
    [activeScenarioId]
  );
  const selectedScenario = useMemo(
    () => scenarios.find((s) => s.id === selectedScenarioId) ?? null,
    [selectedScenarioId]
  );
  const scenarioBriefing = useMemo(
    () => buildScenarioBriefing(selectedScenario ?? activeScenario),
    [activeScenario, selectedScenario]
  );

  const failureSummary = buildFailureSummary(bankState.risk.compliance, bankState.risk.riskMetrics);
  const capitalMarketsQuote = useMemo(() => {
    const instrument=actionForm.capitalMarketsInstrument;
    const target=parsedActionForm.values.capitalMarketsTargetAmount;
    if(instrument==='none'||parsedActionForm.hasErrors||target===undefined||target<=0) return undefined;
    const definition=getCapitalMarketsInstrument(instrument);
    return buildPlayerCapitalMarketsQuote(bankState,simConfig,{
      instrument,
      targetAmount:target,
      maxDiscount:definition.pricingKind==='discount'?parsedActionForm.values.capitalMarketsMaxDiscount:undefined,
      maxSpreadBps:definition.pricingKind==='spread'?parsedActionForm.values.capitalMarketsMaxSpreadBps:undefined,
      tenorMonths:definition.permittedTenorMonths?.length?parsedActionForm.values.capitalMarketsTenorMonths:undefined,
    });
  },[actionForm.capitalMarketsInstrument,bankState,parsedActionForm,simConfig]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const preview = useMemo<StepPreview | null>(() => {
    if (parsedActionForm.hasErrors || clockRunning || !(isActionsOpen && activeTab==='Boardroom')) return null;
    const forecast = calculatePlayerNextCloseForecast({
      actionForm,
      capitalMarketsDraftArea,
      pendingRiskAppetite,
      scenarioId: activeScenarioId,
      bankState,
      stateHistory,
    }, controller);
    if (!forecast.accepted) return null;
    return {
      baseline: forecast.baseline,
      stressed: forecast.stressed,
      breachProbability: forecast.breachProbability,
      pathCount: forecast.pathCount,
      deltas: forecast.deltas,
    };
  }, [activeScenarioId, actionForm, bankState, parsedActionForm, simConfig, isActionsOpen, activeTab, clockRunning, pendingRiskAppetite, capitalMarketsDraftArea, stateHistory, controller]);
  const capitalMarketsPlanImpact = useMemo<CapitalMarketsPlanImpact | undefined>(() => {
    if(!bankState.threeYearPlan?.enabled||actionForm.capitalMarketsInstrument==='none'||!preview?.baseline) return undefined;
    return {
      cet1Before:bankState.risk.riskMetrics.cet1Ratio,
      cet1After:preview.baseline.risk.riskMetrics.cet1Ratio,
      epsBefore:bankState.equityMarket.epsTtm,
      epsAfter:preview.baseline.equityMarket.epsTtm,
    };
  },[actionForm.capitalMarketsInstrument,bankState,preview]);

  const recommendations = useMemo(() => {
    return controller.recommend(bankState);
  }, [bankState, simConfig]);
  const scenarioReport = useMemo(
    () => buildScenarioProgressReport({
      scenario: activeScenario,
      state: bankState,
      openingStep: stateHistory[0].time.step,
      config: simConfig,
      attribution: lastAttribution,
      recommendationTitles: recommendations.map((rec) => rec.title),
    }),
    [activeScenario, bankState, lastAttribution, recommendations, simConfig, stateHistory]
  );
  const scenarioScore = scenarioReport?.score ?? null;
  const scenarioDebrief = scenarioReport?.debrief ?? null;
  const handleRunNextMonth = (automatic = false) => {
    if (!automatic) clock.stop();
    if (bankState.status.hasFailed) return;
    const currentSession: PlayerSessionState = {
      runId: browserRunId,
      revision: currentTimeline.length,
      seed: baseConfig.global.initialPortfolioSeed ?? 123456789,
      seedSchemeVersion: SEED_SCHEME_VERSION,
      scenarioId: activeScenarioId,
      config: simConfig,
      openingState: stateHistory[0],
      bankState,
      stateHistory,
      eventLog,
      lastAttribution,
      actionForm,
      capitalMarketsDraftArea,
      pendingRiskAppetite,
      timeline: currentTimeline,
      snapshots: currentSnapshots,
      safetyPause,
      status: bankState.status.hasFailed ? 'bank_failure' : 'active',
    };
    const close = closePlayerSessionMonth(currentSession, controller);
    if (close.accepted === false) {
      if (close.reason === 'terminal') return;
      setEventLog((prev) => [
        ...prev,
        {
          id: `ui-${Date.now()}`,
          severity: 'error',
          message: close.issues.length > 0
            ? `Cannot run step: ${close.issues[0].message}`
            : 'Cannot run step: fix action input validation errors first.',
          timestamp: Date.now(),
        },
      ]);
      return;
    }
    const { session, actions, shocks } = close;
    if (automatic) clock.afterAutomaticStep(session.bankState, simConfig);
    else clock.afterManualStep();
    setPendingRiskAppetite(undefined);
    setActionForm(session.actionForm);
    setCapitalMarketsDraftArea(session.capitalMarketsDraftArea ?? null);
    setBankState(session.bankState);
    setStateHistory(session.stateHistory);
    setEventLog(session.eventLog);
    setLastAttribution(close.attribution);
    setHighlightedEventIds([]);
    setSelectedAttributionLine(null);
    runSession.appendStep(session.bankState, actions, shocks);
  };

  clockTickRef.current = () => handleRunNextMonth(true);

  // Opening a department is a deliberate policy-decision pause; timer/visibility coordination lives in useSimulationClock.
  useEffect(() => { if (isActionsOpen) { clock.stop(); setActiveTab('Boardroom'); } }, [isActionsOpen, clock.stop]);

  const handleSaveCurrentRun = () => {
    const record = runSession.saveCurrent({
      runId: browserRunId,
      scenarioId: activeScenarioId,
      initialState: stateHistory[0],
      finalState: bankState,
    });
    if (!record) return;
    setEventLog((prev) => [
      ...prev,
      {
        id: `ui-save-${Date.now()}`,
        severity: 'info',
        message: `Saved run "${record.label}" with ${record.timeline.length} decisions.`,
        timestamp: Date.now(),
      },
    ]);
  };

  const handleExtractRun = async () => {
    const extract = buildPlayerRunExtract({ bankState, stateHistory, simConfig, timeline: currentTimeline, events: eventLog });
    const text = JSON.stringify(extract);
    try {
      await navigator.clipboard.writeText(text);
      setExtractStatus('copied');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      setExtractStatus(copied ? 'copied' : 'failed');
    }
    window.setTimeout(() => setExtractStatus('idle'), 2500);
  };

  const handleStartScenario = (scenarioId: string | null = selectedScenarioId) => {
    if (bankState.time.step > stateHistory[0].time.step) handleSaveCurrentRun();
    clock.reset();
    setActiveTab('Boardroom');
    setIsActionsOpen(false);
    const prepared = prepareScenarioSession(scenarioId);
    const scenarioConfig = prepared.config;
    const scenarioState = prepared.state;
    setSimConfig(scenarioConfig);
    setPendingRiskAppetite(undefined);
    setCapitalMarketsDraftArea(null);
    setBankState(scenarioState);
    setStateHistory([scenarioState]);
    setEventLog([]);
    setLastAttribution(null);
    setHighlightedEventIds([]);
    setSelectedAttributionLine(null);
    setActiveScenarioId(scenarioId);
    setSelectedScenarioId(scenarioId);
    setBrowserRunId(createBrowserRunId());
    runSession.reset(scenarioState);
    setActionForm(prepared.actionForm);
  };

  const openHelpSection = (sectionId: string) => {
    setHelpSectionFocus(sectionId);
    setActiveTab('Help');
  };


  return (
    <div className="app-shell">
      <header className="masthead">
        <button className="brand" onClick={goToBoardroom} aria-label="BankSim bank overview"><span className="brand-symbol">B</span><span>BANKSIM<small>BANK MANAGEMENT SIMULATOR</small></span></button>
        <div className="masthead-actions"><button className="button ghost" onClick={() => void handleExtractRun()}>{extractStatus==='copied'?'Copied JSON':extractStatus==='failed'?'Copy failed':'Export run'}</button><details className="settings-menu"><summary>Settings</summary><div><button className="button" onClick={handleSaveCurrentRun}>Save run</button><button className="button" onClick={() => handleStartScenario(null)}>Start a fresh bank</button><button className="button ghost" onClick={()=>openReport('Events')}>Event log</button><button className="button ghost" onClick={()=>openReport('Reconciliations')}>Reconciliations</button><button className="button ghost" onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>Use {theme==='light'?'dark':'light'} theme</button><label className="clock-safety"><input type="checkbox" checked={threeYearPlanEnabled} disabled={!canToggleThreeYearPlan} onChange={e=>setThreeYearPlanMode(e.target.checked)}/>Three-year plan mode</label><label>Speed<select value={clockSpeed} onChange={e=>setClockSpeed(Number(e.target.value))}><option value={1500}>1×</option><option value={450}>3×</option></select></label><label className="clock-safety"><input type="checkbox" checked={safetyPause} onChange={e=>setSafetyPause(e.target.checked)}/>Pause when buffers need attention</label></div></details></div>
      </header>
      <FunctionalNavigation
        activeTab={activeTab}
        activeDepartment={navigationDepartment}
        onBoardroom={goToBoardroom}
        onDepartment={openDepartment}
        onReport={openReport}
      />
      <section className="time-console compact-clock" aria-label="Simulation time controls">
       <div className="clock-date"><strong>Year {Math.floor((bankState.time.step-stateHistory[0].time.step)/12)+1} · Q{Math.floor((bankState.time.step-stateHistory[0].time.step)%12/3)+1}</strong><span>{bankState.time.date.toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'})}</span></div>
       <div className="clock-buttons"><button className="button" onClick={pauseClock} disabled={!clockRunning} aria-label="Pause simulation">Ⅱ Pause</button><label><span className="sr-only">Advance time</span><select aria-label="Advance time" value={runPeriod} disabled={clockRunning} onChange={e=>setRunPeriod(e.target.value as 'month' | 'quarter' | 'year' | 'auto')}><option value="month">One month</option><option value="quarter">To quarter end</option><option value="year">To year end</option><option value="auto">Continuous</option></select></label><button className="button primary" disabled={bankState.status.hasFailed||parsedActionForm.hasErrors||clockRunning} onClick={()=>startClock(runPeriod==='auto'?Infinity:monthsForPlayerAdvance(stateHistory[0].time.step,bankState.time.step,runPeriod))}>▶ Run</button></div>
       <div className="clock-status" role="status">{clockRunning?Number.isFinite(autoRemaining)?`Running · ${autoRemaining} months remaining`:'Running continuously':pauseReason}</div>
      </section>

      {stateHistory.length>1&&<nav className="post-close-links" aria-label="Review last close"><strong>Review last close</strong><button className="button ghost" onClick={()=>openReport('Events')}>Event log</button><button className="button ghost" onClick={()=>openReport('Reconciliations')}>Reconciliations</button></nav>}
      {attentionReason(bankState,simConfig)&&!bankState.status.hasFailed&&<div className="attention-banner"><div><strong>Needs your attention</strong><span>{attentionReason(bankState,simConfig)}</span></div><button className="button" onClick={()=>openDepartment(responsibleDepartment)}>Manage {responsibleDepartment.toLowerCase()} →</button></div>}


      {bankState.status.hasFailed && (
        <div className="alert danger">
          <div style={{ fontWeight: 700 }}>Your mandate has ended.</div>
          <div className="muted" style={{ marginTop: 6 }}>{failureSummary}</div>
          <div className="muted" style={{ marginTop: 8 }}>
            <strong>Final metrics:</strong> CET1 {formatPct(bankState.risk.riskMetrics.cet1Ratio)}, Leverage {formatPct(bankState.risk.riskMetrics.leverageRatio)}, LCR {formatPct(bankState.risk.riskMetrics.lcr)}, NSFR {formatPct(bankState.risk.riskMetrics.nsfr)}.
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            <strong>Recent events:</strong>
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              {eventLog.slice(-5).map((e) => (
                <li key={e.id}>[{e.severity.toUpperCase()}] {e.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <FunctionalReportNavigation activeTab={activeTab} activeDepartment={navigationDepartment} regulatoryMetric={regulatoryMetric} onReport={openReport} onManage={openDepartment}/>


      {activeTab === 'Boardroom' && <Boardroom attribution={lastAttribution} pendingActions={pendingActions} state={bankState} history={stateHistory} department={isActionsOpen?activeDepartment:null} hasErrors={parsedActionForm.hasErrors} onDepartment={openDepartment} onRisk={()=>openReport('Regulatory')} onClose={()=>setIsActionsOpen(false)} >
        <DepartmentOffice department={activeDepartment} state={bankState} history={stateHistory} form={actionForm} errors={parsedActionForm.errors} hasErrors={parsedActionForm.hasErrors} onChange={next=>{pauseClock();if(next.capitalMarketsInstrument==='none')setCapitalMarketsDraftArea(null);else if(actionForm.capitalMarketsInstrument==='none'&&(activeDepartment==='Capital'||activeDepartment==='Treasury'))setCapitalMarketsDraftArea(activeDepartment);setActionForm(next);}} onReport={openReport} onHelp={openHelpSection} estimate={preview?.baseline??null} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpactText={capitalMarketsPlanImpact?buildCapitalMarketsPlanImpactText(capitalMarketsPlanImpact):undefined}/>
        {activeDepartment==='Capital'&&<details className="department-advanced risk-appetite-disclosure"><summary>Board risk appetite</summary><RiskAppetiteEditor state={bankState} config={simConfig} pending={pendingRiskAppetite} onQueue={t=>{pauseClock();setPendingRiskAppetite(t);}}/></details>}
      </Boardroom>}
      {activeTab === 'Performance' && <PerformanceReport history={stateHistory}/>}

      {activeTab === 'Overview' && (
        <RiskDashboard state={bankState} config={simConfig} attribution={lastAttribution} />
      )}

      {activeTab === 'Share Price' && (
        <section className="stack">
          <h2>Share Price</h2>
          <SharePricePanel state={bankState} history={stateHistory} config={simConfig} />
        </section>
      )}

      {activeTab === 'Scenarios' && (
        <section className="scenario-screen stack">
          <header className="scenario-page-heading"><div><div className="eyebrow">Optional scenarios</div><h2>Choose the pressure</h2></div><span>Start a challenge from the bank simulator.</span></header>
          <div className="scenario-layout">
            <ScenarioSelector scenarios={scenarios} selectedId={selectedScenarioId} onSelect={setSelectedScenarioId}/>
            <ScenarioBriefingPanel
              scenario={selectedScenario ?? activeScenario}
              briefing={scenarioBriefing}
              isCurrent={!!activeScenario && (selectedScenario?.id ?? activeScenario.id) === activeScenario.id}
              hasSelection={!!selectedScenario}
              onStart={() => handleStartScenario(selectedScenarioId)}
            />
          </div>
          {activeScenario && <section className="scenario-run-card" aria-label={`Current run: ${activeScenario.name}`}>
            <div className="scenario-run-heading">
              <div><div className="eyebrow">Current run</div><h3>{activeScenario.name}</h3></div>
              {scenarioScore&&<div className="scenario-run-score"><strong>{(scenarioScore.completionPct*100).toFixed(0)}%</strong><span>Objective progress · {scenarioScore.passed?'On track':'At risk'}</span></div>}
            </div>
            {scenarioScore&&<>
              <div className="scenario-run-horizon">Month {scenarioReport?.month ?? 0} of {scenarioScore.horizonMonths}</div>
              <table className="data-table">
                <thead><tr><th>Objective</th><th className="numeric">Current</th><th className="numeric">Target</th><th className="numeric">Progress</th></tr></thead>
                <tbody>{scenarioReport?.objectiveRows.map((row)=><tr key={row.label}><td>{row.label}</td><td className="numeric">{row.current}</td><td className="numeric">{row.target}</td><td className="numeric">{row.progress}</td></tr>)}</tbody>
              </table>
            </>}
            {scenarioDebrief&&<div className={`alert ${scenarioDebrief.severity}`}><strong>{scenarioDebrief.title}</strong><p>{scenarioDebrief.summary}</p>{scenarioDebrief.topDrivers.length>0&&<p><strong>Top drivers:</strong> {scenarioDebrief.topDrivers.join(' · ')}</p>}{scenarioDebrief.recommendedLevers.length>0&&<p><strong>Try next:</strong> {scenarioDebrief.recommendedLevers.join(' · ')}</p>}</div>}
          </section>}
        </section>
      )}

      {activeTab === 'Accounts' && (
        <section className="stack">
          <h2>Accounts</h2>
          <AccountsPanel state={bankState} history={stateHistory} />
        </section>
      )}

      {activeTab === 'Regulatory' && (
        <section className="stack">
      <RegMetricsPanel
        state={bankState}
        history={stateHistory}
        config={simConfig}
        metric={regulatoryMetric}
        pendingRiskAppetite={pendingRiskAppetite}
        onRiskAppetite={t=>{pauseClock();setPendingRiskAppetite(t);}}
        attribution={lastAttribution}
        onAttributionLineSelect={(selection) => {
          setHighlightedEventIds(selection.eventIds);
          setSelectedAttributionLine(selection);
          if (selection.eventIds.length > 0) {
            setActiveTab('Events');
          }
        }}
      />
    </section>
  )}

      {activeTab === 'Loans' && (
        <section className="stack">
          <h2>Loans</h2>
          <LoansPanel
            items={bankState.financial.balanceSheet.items}
            loanCohorts={bankState.loanCohorts}
            loanPipelines={bankState.loanPipelines}
            workoutPipelines={bankState.workoutPipelines}
          />
        </section>
      )}

      {activeTab === 'Credit Losses' && <CreditLossesPanel history={stateHistory} />}

      {activeTab === 'Costs' && (
        <section className="stack">
          <h2>Costs</h2>
          <CostsPanel income={bankState.financial.incomeStatement} />
        </section>
      )}

      {activeTab === 'Events' && (
        <section className="stack">
          <h2>Event Log</h2>
          {selectedAttributionLine && (
            <AttributionMechanicExplainer
              selection={selectedAttributionLine}
            />
          )}
          <EventLog
            events={eventLog}
            highlightEventIds={highlightedEventIds}
            onClearHighlight={() => {
              setHighlightedEventIds([]);
              setSelectedAttributionLine(null);
            }}
          />
        </section>
      )}

      {activeTab === 'Reconciliations' && (
        <section className="stack">
          <h2>Reconciliations</h2>
          <ReconciliationPanel state={bankState} />
        </section>
      )}

      {activeTab === 'Past games' && (
        <section className="stack">
          <h2>Past games</h2>
          <RunComparisonPanel
            runs={savedRuns}
            currentSummary={{
              timelineLength: currentTimeline.length,
              snapshots: currentSnapshots.length,
            }}
            onReplay={(run) => {
              const replay = controller.replay(run.initialState, run.timeline, run.id);
              const final = replay.finalState;
              const mismatch =
                Math.abs(final.risk.riskMetrics.cet1Ratio - run.finalState.risk.riskMetrics.cet1Ratio) +
                Math.abs(final.risk.riskMetrics.lcr - run.finalState.risk.riskMetrics.lcr) +
                Math.abs(final.risk.riskMetrics.nsfr - run.finalState.risk.riskMetrics.nsfr);
              setEventLog((prev) => [
                ...prev,
                {
                  id: `ui-replay-${Date.now()}`,
                  severity: mismatch <= 1e-9 ? 'info' : 'warning',
                  message:
                    mismatch <= 1e-9
                      ? `Replay deterministic for "${run.label}".`
                      : `Replay mismatch for "${run.label}" (diff ${mismatch.toExponential(2)}).`,
                  timestamp: Date.now(),
                },
              ]);
            }}
          />
        </section>
      )}

      {activeTab === 'Help' && (
        <section className="stack">
          <h2>Help</h2>
          <HelpCenterPanel
            state={bankState}
            config={simConfig}
            focusSectionId={helpSectionFocus}
            onFocusHandled={() => setHelpSectionFocus(null)}
          />
        </section>
      )}


    </div>
  );
};

export default App;

const buildFailureSummary = (compliance: ComplianceStatus, risk: RiskMetrics): string => {
  if (!compliance) return '';
  if (compliance.lcrBreached) {
    return `Liquidity Coverage Ratio dropped below requirement; HQLA was insufficient versus net outflows (LCR=${formatPct(risk.lcr)}).`;
  }
  if (compliance.nsfrBreached) {
    return `Stable funding shortfall; NSFR dipped below 1.0 (NSFR=${formatPct(risk.nsfr)}).`;
  }
  if (compliance.cet1Breached) {
    return `CET1 ratio fell under the minimum buffer (CET1 ratio=${formatPct(risk.cet1Ratio)}).`;
  }
  if (compliance.leverageBreached) {
    return `Leverage backstop breached (Leverage ratio=${formatPct(risk.leverageRatio)}).`;
  }
  return `The bank failed due to unspecified breach.`;
};
