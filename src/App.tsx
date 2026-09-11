import DepartmentOffice from './components/DepartmentOffice';
import RiskAppetiteEditor, { RiskAppetite } from './components/RiskAppetiteEditor';
import PerformanceReport from './components/PerformanceReport';
import { Department } from './game/departments';
import { attentionReason, clockAfterStep, monthsToPeriodEnd } from './game/management';
import Boardroom from './components/Boardroom';
import { BoardDecision } from './game/boardroom';
import { useEffect, useMemo, useState } from 'react';
import { initialState } from './config/initialState';
import { baseConfig } from './config/baseConfig';
import { BankState } from './domain/bankState';
import type { ThreeYearPlanTarget } from './domain/threeYearPlan';
import { PlayerAction } from './domain/actions';
import {
  AssetProductType,
  LiabilityProductType,
  BalanceSheetSide,
} from './domain/enums';
import RiskDashboard from './components/RiskDashboard';
import { ActionFormState, type CapitalMarketsPlanImpact } from './components/ActionsPanel';
import EventLog from './components/EventLog';
import ScenarioSelector from './components/ScenarioSelector';
import {
  getScenarioInitialState,
  getScenarioStepPayload,
  scenarios,
  applyScenarioConfig,
  Scenario,
} from './config/scenarios';
import { SimulationEvent } from './engine/simulation';
import { ComplianceStatus, RiskMetrics } from './domain/risks';
import RegMetricsPanel from './components/RegMetricsPanel';
import LoansPanel from './components/LoansPanel';
import CostsPanel from './components/CostsPanel';
import ReconciliationPanel from './components/ReconciliationPanel';
import { SimulationConfig } from './domain/config';
import { calculateRiskMetrics, evaluateCompliance } from './engine/metrics';
import { SimulationController } from './ui/simulationController';
import AccountsPanel from './components/AccountsPanel';
import { formatCurrency, formatPct } from './utils/formatters';
import { parseMoneyInput, parseRateInput } from './utils/parsers';
import { evaluateScenarioGoals } from './engine/scoring';
import { ScenarioMetricKey, ScenarioScore } from './domain/scoring';
import { ActionTimelineEntry, RunRecord, RunSnapshot } from './domain/runHistory';
import RunComparisonPanel from './components/RunComparisonPanel';
import { AttributionLineSelection, StepAttribution } from './domain/attribution';
import SharePricePanel from './components/SharePricePanel';
import HelpCenterPanel from './components/HelpCenterPanel';
import AttributionMechanicExplainer from './components/AttributionMechanicExplainer';
import { createDefaultThreeYearPlan, createDefaultThreeYearPlanTargets, validateThreeYearPlanAgreement } from './config/threeYearPlan';
import { buildCapitalMarketsBook } from './engine/capitalMarkets';
import { getCapitalMarketsInstrument } from './capitalMarkets/catalogue';

const controller = new SimulationController(baseConfig);
const tabs = [
  'Boardroom',
  'Performance',
  'Overview',
  'Share Price',
  'Accounts',
  'Regulatory',
  'Loans',
  'Costs',
  'Events',
  'Reconciliations',
  'Past games',
  'Help',
];

const tabLabels: Record<string, string> = {
  Boardroom: 'Bank',
  Performance: 'Performance',
  Overview: 'Risk dashboard',
  'Share Price': 'Share price',
  Scenarios: 'Scenarios',
  Accounts: 'Accounts',
  Regulatory: 'Regulatory metrics',
  Loans: 'Loans',
  Costs: 'Costs',
  Events: 'Events',
  Reconciliations: 'Reconciliations',
  'Past games': 'Past games',
  Help: 'Help',
};


const formatRateInputPct = (rate: number | null | undefined): string => {
  if (rate === undefined || rate === null || !Number.isFinite(rate)) return '';
  return `${(rate * 100).toFixed(2)}%`;
};

const App = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [simConfig, setSimConfig] = useState<SimulationConfig>(baseConfig);
  const [pendingRiskAppetite, setPendingRiskAppetite] = useState<RiskAppetite|null|undefined>();
  const [bankState, setBankState] = useState<BankState>(initialState);
  const [stateHistory, setStateHistory] = useState<BankState[]>([initialState]);
  const [eventLog, setEventLog] = useState<SimulationEvent[]>([]);
  const [actionForm, setActionForm] = useState<ActionFormState>({
    retailCurrentAccountRate: formatRateInputPct(bankState.financial.balanceSheet.items.find(i=>i.productType===LiabilityProductType.RetailCurrentAccounts)?.interestRate ?? bankState.market.competitorRetailCurrentAccountRate),
    termDepositRate: formatRateInputPct(bankState.financial.balanceSheet.items.find(i=>i.productType===LiabilityProductType.RetailTermDeposits)?.interestRate ?? bankState.market.competitorTermDepositRate),
    termDepositTenorMonths: String(bankState.behaviour.termDepositTenorMonths ?? 12),
    corporateDepositRate: formatRateInputPct(getGroupDepositRate(bankState, 'corporate')),
    mortgageRate: formatRateInputPct(
      bankState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)
        ?.interestRate
    ),
    consumerLoanRate: formatRateInputPct(bankState.financial.balanceSheet.items.find(i=>i.productType===AssetProductType.ConsumerLoans)?.interestRate ?? bankState.market.competitorConsumerLoanRate),
    corporateLoanRate: formatRateInputPct(
      bankState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CorporateLoans)
        ?.interestRate
    ),
    mortgageUnderwritingTightness:
      (bankState.behaviour.underwritingTightness?.[AssetProductType.Mortgages] ?? 0).toString(),
    consumerUnderwritingTightness: (bankState.behaviour.underwritingTightness?.[AssetProductType.ConsumerLoans] ?? 0.35).toString(),
    corporateUnderwritingTightness:
      (bankState.behaviour.underwritingTightness?.[AssetProductType.CorporateLoans] ?? 0).toString(),
    mortgageMaxLtv: String(bankState.behaviour.mortgagePolicy?.maxLtv ?? .85),
    mortgageFixedPeriodMonths: String(bankState.behaviour.mortgagePolicy?.fixedPeriodMonths ?? 24),
    capitalMarketsInstrument: 'none',
    capitalMarketsTargetAmount: '',
    capitalMarketsMaxDiscount: '15%',
    capitalMarketsMaxSpreadBps: '1000',
    capitalMarketsTenorMonths: '60',
    dividendPayoutRatio: (
      bankState.behaviour.capitalPolicy?.dividendPayoutRatio ??
      baseConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio
    ).toString(),
    at1CouponMode: bankState.behaviour.capitalPolicy?.at1CouponMode ?? 'auto',
    giltTradeDirection: 'none',
    giltTradeAmount: '',
    giltDurationYears: String(bankState.behaviour.treasuryPolicy?.giltDurationYears ?? 5),
    boeFacility: 'none',
    boeFundingAmount: '',
    hedgeDirection: 'none',
    hedgeNotional: '',
    hedgeFixedRate: '',
    hedgeMaturityMonths: '24',
  });
  const [selectedDecisions, setSelectedDecisions] = useState<string[]>([]);
  const [pendingThreeYearPlanRenewal, setPendingThreeYearPlanRenewal] = useState<readonly ThreeYearPlanTarget[] | null>(null);
  const [lastAttribution, setLastAttribution] = useState<StepAttribution | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Boardroom');
  const [helpSectionFocus, setHelpSectionFocus] = useState<string | null>(null);
  const [highlightedEventIds, setHighlightedEventIds] = useState<string[]>([]);
  const [selectedAttributionLine, setSelectedAttributionLine] = useState<AttributionLineSelection | null>(null);
  const [autoRemaining, setAutoRemaining] = useState<number | null>(null);
  const [clockSpeed, setClockSpeed] = useState(1500);
  const [pauseReason, setPauseReason] = useState('Ready. Set your policy, then run a quarter.');
  const [safetyPause, setSafetyPause] = useState(true);
  const clockRunning = autoRemaining !== null;
  const responsibleDepartment:Department = bankState.risk.riskMetrics.internalCet1Headroom<0 || bankState.risk.riskMetrics.cet1Ratio<=bankState.risk.riskMetrics.cet1Requirement || bankState.risk.riskMetrics.praBufferBreached || bankState.risk.compliance.ownFundsBreached || bankState.risk.riskMetrics.leverageRatio<=Math.max(simConfig.riskLimits.minLeverageRatio,bankState.behaviour.riskAppetite?.leverage??simConfig.riskLimits.minLeverageRatio*1.05) ? 'Capital':'Treasury';
  const openDepartment = (department: Department) => { setAutoRemaining(null); setPauseReason('Paused for a policy decision.'); setActiveDepartment(department); setIsActionsOpen(true); setActiveTab('Boardroom'); };
  const openReport = (tab: string) => { setIsActionsOpen(false); setActiveTab(tab); };

  const startClock = (months: number) => { if (bankState.status.hasFailed || parsedActionForm.hasErrors || hasPlanAgreementErrors) return; setPauseReason(''); setAutoRemaining(months); };
  const pauseClock = () => { setAutoRemaining(null); setPauseReason('Paused. Your policies remain in force.'); };

  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [activeDepartment, setActiveDepartment] = useState<Department>('Customers');
  const [runPeriod, setRunPeriod] = useState('quarter');
  const [savedRuns, setSavedRuns] = useState<RunRecord[]>([]);
  const [currentTimeline, setCurrentTimeline] = useState<ActionTimelineEntry[]>([]);
  const [currentSnapshots, setCurrentSnapshots] = useState<RunSnapshot[]>([
    controller.createSnapshot(initialState),
  ]);
  const [runCounter, setRunCounter] = useState(1);
  const threeYearPlanEnabled = Boolean(bankState.threeYearPlan?.enabled);
  const canToggleThreeYearPlan = activeScenarioId === null && bankState.time.step === stateHistory[0].time.step;
  const canEditThreeYearPlan = activeScenarioId === null && Boolean(bankState.threeYearPlan?.enabled) && !bankState.threeYearPlan?.completed && bankState.time.step === bankState.threeYearPlan?.startStep;
  const canRenewThreeYearPlan = activeScenarioId === null && Boolean(bankState.threeYearPlan?.enabled && bankState.threeYearPlan?.completed);
  const planTargetsAwaitingAgreement = pendingThreeYearPlanRenewal ?? (canEditThreeYearPlan ? bankState.threeYearPlan?.targets ?? null : null);
  const threeYearPlanAgreementIssues = activeScenarioId === null && planTargetsAwaitingAgreement ? validateThreeYearPlanAgreement(bankState, planTargetsAwaitingAgreement) : [];
  const hasPlanAgreementErrors = threeYearPlanAgreementIssues.length > 0;
  const setThreeYearPlanMode = (enabled: boolean) => {
    if (!canToggleThreeYearPlan) return;
    const nextConfig: SimulationConfig = { ...simConfig, featureFlags: { ...(simConfig.featureFlags ?? {}), threeYearPlan: enabled } };
    const nextState: BankState = { ...bankState, threeYearPlan: enabled ? createDefaultThreeYearPlan(bankState) : undefined };
    controller.setConfig(nextConfig); setSimConfig(nextConfig); setBankState(nextState); setStateHistory([nextState]); setCurrentSnapshots([controller.createSnapshot(nextState)]);
  };

  const updateThreeYearPlanTargets = (targets: readonly ThreeYearPlanTarget[]) => {
    if (!canEditThreeYearPlan || !bankState.threeYearPlan?.enabled) return;
    const nextTargets = targets.map(target => ({
      ...target,
      milestones: target.milestones.map(milestone => ({ ...milestone })),
    }));
    const nextState: BankState = {
      ...bankState,
      threeYearPlan: {
        ...bankState.threeYearPlan,
        targets: nextTargets,
        currentEvaluation: undefined,
        reviewHistory: [],
        lastEvaluationStep: undefined,
        completed: false,
      },
    };
    setBankState(nextState);
    setStateHistory([nextState]);
    setCurrentSnapshots([controller.createSnapshot(nextState)]);
  };

  const beginThreeYearPlanRenewal = () => {
    if (!canRenewThreeYearPlan) return;
    pauseClock();
    setPendingThreeYearPlanRenewal(createDefaultThreeYearPlanTargets(bankState));
  };
  const updateThreeYearPlanRenewalDraft = (targets: readonly ThreeYearPlanTarget[]) => {
    if (!canRenewThreeYearPlan) return;
    setPendingThreeYearPlanRenewal(targets.map(target => ({ ...target, milestones: target.milestones.map(milestone => ({ ...milestone })) })));
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
  const scenarioScore = useMemo<ScenarioScore | null>(() => {
    if (!activeScenario?.goals) return null;
    return evaluateScenarioGoals(bankState, activeScenario.goals, {
      horizonRiskPenaltyWeight: simConfig.behaviour.horizonRiskPenaltyWeight,
    });
  }, [activeScenario, bankState, simConfig.behaviour.horizonRiskPenaltyWeight]);
  const scenarioBriefing = useMemo(
    () => buildScenarioBriefing(selectedScenario ?? activeScenario),
    [activeScenario, selectedScenario]
  );

  const failureSummary = buildFailureSummary(bankState.risk.compliance, bankState.risk.riskMetrics);
  const parsedActionForm = useMemo(() => parseActionFormInputs(actionForm), [actionForm]);
  const capitalMarketsQuote = useMemo(() => {
    const instrument=actionForm.capitalMarketsInstrument;
    const target=parsedActionForm.values.capitalMarketsTargetAmount;
    if(instrument==='none'||parsedActionForm.hasErrors||target===undefined||target<=0) return undefined;
    const definition=getCapitalMarketsInstrument(instrument);
    return buildCapitalMarketsBook(bankState,simConfig,{
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
    if (parsedActionForm.hasErrors || hasPlanAgreementErrors || clockRunning || !(isActionsOpen && activeTab==='Boardroom')) return null;
    const actions = buildActionsFromParsed(parsedActionForm, actionForm, bankState);
    if(pendingRiskAppetite!==undefined) actions.push({type:'setRiskAppetite',targets:pendingRiskAppetite});
    if(pendingThreeYearPlanRenewal) actions.push({type:'renewThreeYearPlan',targets:pendingThreeYearPlanRenewal.map(target=>({...target,milestones:target.milestones.map(milestone=>({...milestone}))}))});
    const scenarioStep = getScenarioStepPayload({
      scenarioId: activeScenarioId,
      stepNumber: bankState.time.step,
      state: bankState,
      actions,
    });

    controller.setConfig(simConfig);
    const summary = controller.preview(bankState, actions, scenarioStep.shocks);
    const baseline = summary.baseline;
    const stressed = summary.stressed;

    return {
      baseline,
      stressed,
      breachProbability: summary.breachProbability,
      pathCount: summary.pathCount,
      deltas: {
        cet1Ratio: baseline.risk.riskMetrics.cet1Ratio - bankState.risk.riskMetrics.cet1Ratio,
        lcr: baseline.risk.riskMetrics.lcr - bankState.risk.riskMetrics.lcr,
        nsfr: baseline.risk.riskMetrics.nsfr - bankState.risk.riskMetrics.nsfr,
        nim: calculateNim(baseline) - calculateNim(bankState),
      },
    };
  }, [activeScenarioId, actionForm, bankState, parsedActionForm, simConfig, isActionsOpen, activeTab, clockRunning, pendingRiskAppetite, pendingThreeYearPlanRenewal, hasPlanAgreementErrors]);
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
    controller.setConfig(simConfig);
    return controller.recommend(bankState);
  }, [bankState, simConfig]);
  const scenarioDebrief = useMemo(
    () =>
      buildScenarioDebrief({
        scenario: activeScenario,
        state: bankState,
        score: scenarioScore,
        attribution: lastAttribution,
        recommendations: recommendations.map((rec) => rec.title),
      }),
    [activeScenario, bankState, lastAttribution, recommendations, scenarioScore]
  );
  const milestoneEventsFromPayload = (payload: ReturnType<typeof getScenarioStepPayload>): SimulationEvent[] =>
    payload.milestones.map((milestone) => ({
      id: `milestone-${milestone.id}`,
      severity: milestone.severity,
      message: milestone.message,
      timestamp: Date.now(),
    }));

  const clearTransactions = () => {
    setPendingRiskAppetite(undefined);
    setPendingThreeYearPlanRenewal(null);
    setActionForm(prev => ({
      ...prev,
      giltTradeDirection: 'none',
      giltTradeAmount: '',
      capitalMarketsInstrument: 'none',
      capitalMarketsTargetAmount: '',
      capitalMarketsMaxDiscount: '15%',
      capitalMarketsMaxSpreadBps: '1000',
      capitalMarketsTenorMonths: '60',
      boeFacility: 'none',
      boeFundingAmount: '',
      hedgeDirection: 'none',
      hedgeNotional: '',
    }));
    setSelectedDecisions(prev => prev.filter(id => !['funding','capital','hedge'].includes(id)));
  };
  const backProposal = (decision: BoardDecision) => {
    pauseClock();
    setActionForm(prev => ({ ...prev, ...decision.changes }));
    setSelectedDecisions(prev => [...prev.filter(id => id !== decision.id && !(['growth', 'quality'].includes(id) && ['growth', 'quality'].includes(decision.id))), decision.id]);
  };
  const handleRunNextMonth = (automatic = false) => {
    if (!automatic) setAutoRemaining(null);
    if (bankState.status.hasFailed) return;
    if (parsedActionForm.hasErrors || hasPlanAgreementErrors) {
      setEventLog((prev) => [
        ...prev,
        {
          id: `ui-${Date.now()}`,
          severity: 'error',
          message: hasPlanAgreementErrors ? `Cannot run step: the board has not agreed the Three-Year Plan. ${threeYearPlanAgreementIssues[0]}` : 'Cannot run step: fix action input validation errors first.',
          timestamp: Date.now(),
        },
      ]);
      return;
    }
    const actions = buildActionsFromParsed(parsedActionForm, actionForm, bankState);
    if(pendingRiskAppetite!==undefined) actions.push({type:'setRiskAppetite',targets:pendingRiskAppetite});
    if(pendingThreeYearPlanRenewal) actions.push({type:'renewThreeYearPlan',targets:pendingThreeYearPlanRenewal.map(target=>({...target,milestones:target.milestones.map(milestone=>({...milestone}))}))});
    const scenarioStep = getScenarioStepPayload({
      scenarioId: activeScenarioId,
      stepNumber: bankState.time.step,
      state: bankState,
      actions,
    });

    controller.setConfig(simConfig);
    const { nextState, events, diagnostics } = controller.step(bankState, actions, scenarioStep.shocks);
    if (automatic) {
      const clock = clockAfterStep(autoRemaining, nextState, simConfig, safetyPause);
      setAutoRemaining(clock.remaining);
      setPauseReason(clock.reason);
    } else setPauseReason('Month closed. Review the position or continue your strategy.');
    const milestoneEvents = milestoneEventsFromPayload(scenarioStep);

    clearTransactions();
    setBankState(nextState);
    setStateHistory((prev) => [...prev, nextState]);
    setEventLog((prev) => [...prev, ...events, ...milestoneEvents]);
    setLastAttribution(diagnostics.attribution);
    setHighlightedEventIds([]);
    setSelectedAttributionLine(null);
    setCurrentTimeline((prev) => [
      ...prev,
      { step: nextState.time.step, actions: actions.map((a) => ({ ...a })), shocks: scenarioStep.shocks.map((s) => ({ ...s })) },
    ]);
    setCurrentSnapshots((prev) => [...prev, controller.createSnapshot(nextState)]);
  };

  useEffect(() => {
    if (!clockRunning || bankState.status.hasFailed || parsedActionForm.hasErrors || hasPlanAgreementErrors) return;
    const timer = window.setTimeout(() => handleRunNextMonth(true), clockSpeed);
    return () => window.clearTimeout(timer);
  }, [autoRemaining, bankState, actionForm, simConfig, activeScenarioId, clockSpeed, safetyPause, isActionsOpen, parsedActionForm.hasErrors, pendingRiskAppetite, pendingThreeYearPlanRenewal, hasPlanAgreementErrors]);

  // Leave the bank paused when returning from another tab or opening a modal.
  useEffect(() => {
    const hide = () => { if (document.hidden) pauseClock(); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  useEffect(() => { if (isActionsOpen) { setAutoRemaining(null); setActiveTab('Boardroom'); } }, [isActionsOpen]);

  const handleSaveCurrentRun = () => {
    if (currentTimeline.length === 0 || currentSnapshots.length === 0) return;
    const record = controller.toRunRecord({
      id: `run-${Date.now()}`,
      label: `${activeScenarioId ?? 'sandbox'} run ${runCounter}`,
      initialState: stateHistory[0],
      finalState: bankState,
      timeline: currentTimeline,
      snapshots: currentSnapshots,
    });
    setSavedRuns((prev) => [record, ...prev]);
    setRunCounter((prev) => prev + 1);
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

  const handleStartScenario = (scenarioId: string | null = selectedScenarioId) => {
    if (bankState.time.step > stateHistory[0].time.step) handleSaveCurrentRun();
    setAutoRemaining(null);
    setPauseReason('New bank ready. Set a policy and give it time.');
    setSelectedDecisions([]);
    setActiveTab('Boardroom');
    setIsActionsOpen(false);
    const scenarioConfig = applyScenarioConfig(baseConfig, scenarioId);
    const scenarioState = getScenarioInitialState(scenarioId, scenarioConfig);
    const metrics = calculateRiskMetrics({ state: scenarioState, config: scenarioConfig });
    scenarioState.risk.riskMetrics = metrics;
    scenarioState.risk.compliance = evaluateCompliance(metrics, scenarioConfig.riskLimits);
    scenarioState.board = {
      score: metrics.boardPressureScore,
      earningsVolatility: metrics.boardPressureVolatility,
      franchiseGap: metrics.boardPressureFranchiseGap,
      riskGap: metrics.boardPressureRiskGap,
    };
    controller.setConfig(scenarioConfig);
    setSimConfig(scenarioConfig);
    setPendingRiskAppetite(undefined);
    setPendingThreeYearPlanRenewal(null);
    setBankState(scenarioState);
    setStateHistory([scenarioState]);
    setEventLog([]);
    setLastAttribution(null);
    setHighlightedEventIds([]);
    setSelectedAttributionLine(null);
    setActiveScenarioId(scenarioId);
    setCurrentTimeline([]);
    setCurrentSnapshots([controller.createSnapshot(scenarioState)]);
    setActionForm({
      retailCurrentAccountRate: formatRateInputPct(scenarioState.financial.balanceSheet.items.find(i=>i.productType===LiabilityProductType.RetailCurrentAccounts)?.interestRate ?? scenarioState.market.competitorRetailCurrentAccountRate),
      termDepositRate: formatRateInputPct(scenarioState.financial.balanceSheet.items.find(i=>i.productType===LiabilityProductType.RetailTermDeposits)?.interestRate ?? scenarioState.market.competitorTermDepositRate),
      termDepositTenorMonths: String(scenarioState.behaviour.termDepositTenorMonths ?? 12),
      corporateDepositRate: formatRateInputPct(getGroupDepositRate(scenarioState, 'corporate')),
      mortgageRate: formatRateInputPct(
        scenarioState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)
          ?.interestRate
      ),
      consumerLoanRate: formatRateInputPct(scenarioState.financial.balanceSheet.items.find(i=>i.productType===AssetProductType.ConsumerLoans)?.interestRate ?? scenarioState.market.competitorConsumerLoanRate),
      corporateLoanRate: formatRateInputPct(
        scenarioState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CorporateLoans)
          ?.interestRate
      ),
      mortgageUnderwritingTightness:
        (scenarioState.behaviour.underwritingTightness?.[AssetProductType.Mortgages] ?? 0).toString(),
      consumerUnderwritingTightness: (scenarioState.behaviour.underwritingTightness?.[AssetProductType.ConsumerLoans] ?? 0.35).toString(),
      corporateUnderwritingTightness:
        (scenarioState.behaviour.underwritingTightness?.[AssetProductType.CorporateLoans] ?? 0).toString(),
      mortgageMaxLtv: String(scenarioState.behaviour.mortgagePolicy?.maxLtv ?? .85),
      mortgageFixedPeriodMonths: String(scenarioState.behaviour.mortgagePolicy?.fixedPeriodMonths ?? 24),
      capitalMarketsInstrument: 'none',
      capitalMarketsTargetAmount: '',
      capitalMarketsMaxDiscount: '15%',
      capitalMarketsMaxSpreadBps: '1000',
      capitalMarketsTenorMonths: '60',
      dividendPayoutRatio: (
        scenarioState.behaviour.capitalPolicy?.dividendPayoutRatio ??
        scenarioConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio
      ).toString(),
      at1CouponMode: scenarioState.behaviour.capitalPolicy?.at1CouponMode ?? 'auto',
      giltTradeDirection: 'none',
      giltTradeAmount: '',
      giltDurationYears: String(scenarioState.behaviour.treasuryPolicy?.giltDurationYears ?? 5),
      boeFacility: 'none',
      boeFundingAmount: '',
      hedgeDirection: 'none',
      hedgeNotional: '',
      hedgeFixedRate: '',
      hedgeMaturityMonths: '24',
    });
  };

  const openHelpSection = (sectionId: string) => {
    setHelpSectionFocus(sectionId);
    setActiveTab('Help');
  };


  return (
    <div className="app-shell">
      <header className="masthead">
        <button className="brand" onClick={() => setActiveTab('Boardroom')} aria-label="BankSim boardroom"><span className="brand-symbol">B</span><span>BANKSIM<small>BUILD A BANK THAT LASTS</small></span></button>
        <div className="masthead-actions"><details className="settings-menu"><summary>Game</summary><div><button className="button" onClick={handleSaveCurrentRun}>Save run</button><button className="button" onClick={() => handleStartScenario(null)}>Start a fresh bank</button><button className="button ghost" onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>Use {theme==='light'?'dark':'light'} theme</button><label className="clock-safety"><input type="checkbox" checked={threeYearPlanEnabled} disabled={!canToggleThreeYearPlan} onChange={e=>setThreeYearPlanMode(e.target.checked)}/>Three-year plan mode</label><label>Speed<select value={clockSpeed} onChange={e=>setClockSpeed(Number(e.target.value))}><option value={1500}>1×</option><option value={450}>3×</option></select></label><label className="clock-safety"><input type="checkbox" checked={safetyPause} onChange={e=>setSafetyPause(e.target.checked)}/>Pause when buffers need attention</label></div></details></div>
      </header>
      <nav className="tabs report-navigation" aria-label="Bank reports and tools">
        {tabs.map(tab=><button key={tab} className={`tab-button ${activeTab===tab?'active':''}`} aria-current={activeTab===tab?'page':undefined} onClick={()=>tab==='Boardroom'?setActiveTab('Boardroom'):openReport(tab)}>{tabLabels[tab]??tab}</button>)}
      </nav>
      <section className="time-console compact-clock" aria-label="Simulation time controls">
       <div className="clock-date"><strong>Year {Math.floor((bankState.time.step-stateHistory[0].time.step)/12)+1} · Q{Math.floor((bankState.time.step-stateHistory[0].time.step)%12/3)+1}</strong><span>{bankState.time.date.toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'})}</span></div>
       <div className="clock-buttons"><button className="button" onClick={pauseClock} disabled={!clockRunning} aria-label="Pause simulation">Ⅱ Pause</button><label><span className="sr-only">Advance time</span><select aria-label="Advance time" value={runPeriod} disabled={clockRunning} onChange={e=>setRunPeriod(e.target.value)}><option value="month">One month</option><option value="quarter">To quarter end</option><option value="year">To year end</option><option value="auto">Continuous</option></select></label><button className="button primary" disabled={bankState.status.hasFailed||parsedActionForm.hasErrors||hasPlanAgreementErrors||clockRunning} onClick={()=>startClock(runPeriod==='auto'?Infinity:runPeriod==='month'?1:monthsToPeriodEnd(bankState.time.step-stateHistory[0].time.step,runPeriod==='quarter'?3:12))}>▶ Run</button></div>
       <div className="clock-status" role="status">{clockRunning?Number.isFinite(autoRemaining)?`Running · ${autoRemaining} months remaining`:'Running continuously':pauseReason}</div>
      </section>
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

      {activeTab !== 'Boardroom' && <div className="report-breadcrumb"><button className="button ghost" onClick={()=>setActiveTab('Boardroom')}>← Back to bank</button><span>{activeTab==='Help'?'Reference library':tabLabels[activeTab]??activeTab}</span>{['Loans','Regulatory','Accounts'].includes(activeTab)&&<button className="button" onClick={()=>openDepartment(activeTab==='Loans'?'Lending':activeTab==='Costs'?'Treasury':'Capital')}>Manage {activeTab==='Loans'?'lending':activeTab==='Costs'?'treasury':'capital'} →</button>}</div>}


      {activeTab === 'Boardroom' && <Boardroom state={bankState} history={stateHistory} department={isActionsOpen?activeDepartment:null} hasErrors={parsedActionForm.hasErrors} onDepartment={openDepartment} onClose={()=>setIsActionsOpen(false)} onDecision={backProposal} selectedDecisions={selectedDecisions} canEditPlan={canEditThreeYearPlan && threeYearPlanEnabled} onPlanTargetsChange={updateThreeYearPlanTargets} canRenewPlan={canRenewThreeYearPlan} planRenewalDraft={pendingThreeYearPlanRenewal} planAgreementIssues={threeYearPlanAgreementIssues} onBeginPlanRenewal={beginThreeYearPlanRenewal} onPlanRenewalTargetsChange={updateThreeYearPlanRenewalDraft} onCancelPlanRenewal={()=>setPendingThreeYearPlanRenewal(null)}>
        <DepartmentOffice department={activeDepartment} state={bankState} history={stateHistory} form={actionForm} errors={parsedActionForm.errors} hasErrors={parsedActionForm.hasErrors} selected={selectedDecisions} onChange={next=>{pauseClock();setActionForm(next);setSelectedDecisions([]);}} onDecision={backProposal} onReport={openReport} onHelp={openHelpSection} estimate={preview?.baseline??null} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpact={capitalMarketsPlanImpact}/>
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
        <section className="stack">
          <h2>Scenarios</h2>
          <div className="grid-two">
            <ScenarioSelector
              scenarios={scenarios}
              selectedId={selectedScenarioId}
              onSelect={(id) => setSelectedScenarioId(id)}
              onStart={() => handleStartScenario()}
              description={scenarios.find((s) => s.id === selectedScenarioId)?.description}
            />
            <div className="card stack">
              <div className="eyebrow">What to expect</div>
              <p className="muted">
                Starting a scenario reloads the bank with tailored settings and scheduled shocks. You can still tweak pricing and
                funding in the Departments once the scenario is active.
              </p>
              <div className="muted" style={{ marginTop: 8 }}>
                {activeScenarioId ? `Currently running: ${activeScenarioId}` : 'No scenario running; sandbox mode active.'}
              </div>
              {scenarioBriefing && (
                <div className="scenario-guidance-block">
                  <div className="eyebrow">Briefing</div>
                  <div style={{ fontWeight: 700 }}>Likely pressure points</div>
                  <ul className="help-list">
                    {scenarioBriefing.riskMap.map((item) => (
                      <li key={`risk-${item}`}>{item}</li>
                    ))}
                  </ul>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>Likely failure modes</div>
                  <ul className="help-list">
                    {scenarioBriefing.failureModes.map((item) => (
                      <li key={`fail-${item}`}>{item}</li>
                    ))}
                  </ul>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>Suggested first-step focus</div>
                  <ul className="help-list">
                    {scenarioBriefing.firstStepFocus.map((item) => (
                      <li key={`focus-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {scenarioScore && (
                <div className="stack" style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700 }}>
                    Objective score: {(scenarioScore.completionPct * 100).toFixed(1)}% ({scenarioScore.score.toFixed(1)}/
                    {scenarioScore.maxScore.toFixed(1)})
                  </div>
                  <div className="muted">
                    Horizon month: {scenarioScore.horizonMonths} | Status: {scenarioScore.passed ? 'On track' : 'At risk'}
                  </div>
                  <div className="muted">
                    Raw objective score {scenarioScore.rawScore.toFixed(1)} / {scenarioScore.maxScore.toFixed(1)}.
                    Forward-risk penalty {formatPct(scenarioScore.qualityPenalty)} (franchise{' '}
                    {formatPct(scenarioScore.qualityPenaltyBreakdown.franchise)}, funding{' '}
                    {formatPct(scenarioScore.qualityPenaltyBreakdown.funding)}, liquidity{' '}
                    {formatPct(scenarioScore.qualityPenaltyBreakdown.liquidity)}).
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Objective</th>
                        <th className="numeric">Current</th>
                        <th className="numeric">Target</th>
                        <th className="numeric">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarioScore.details.map((detail) => (
                        <tr key={detail.label}>
                          <td>{detail.label}</td>
                          <td className="numeric">{formatScenarioMetric(detail.current, detail.metric)}</td>
                          <td className="numeric">{formatScenarioMetric(detail.target, detail.metric)}</td>
                          <td className="numeric">{(detail.completion * 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {scenarioDebrief && (
                <div className={`alert ${scenarioDebrief.severity}`}>
                  <div style={{ fontWeight: 700 }}>{scenarioDebrief.title}</div>
                  <div className="muted" style={{ marginTop: 4 }}>{scenarioDebrief.summary}</div>
                  {scenarioDebrief.topDrivers.length > 0 && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      <strong>Top drivers:</strong> {scenarioDebrief.topDrivers.join(' | ')}</div>
                  )}
                  {scenarioDebrief.recommendedLevers.length > 0 && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      <strong>Try next:</strong> {scenarioDebrief.recommendedLevers.join(' | ')}</div>
                  )}
                </div>
              )}
            </div>
          </div>
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
      <h2>Regulatory metrics</h2>
      <RegMetricsPanel
        state={bankState}
        history={stateHistory}
        config={simConfig}
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
              const replay = controller.replay(run.initialState, run.timeline);
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

interface ParsedActionFormInputs {
  values: Partial<Record<keyof ActionFormState, number>>;
  errors: Partial<Record<keyof ActionFormState, string>>;
  hasErrors: boolean;
}

interface StepPreview {
  baseline: BankState;
  stressed: BankState;
  breachProbability: number;
  pathCount: number;
  deltas: {
    cet1Ratio: number;
    lcr: number;
    nsfr: number;
    nim: number;
  };
}

const parseActionFormInputs = (state: ActionFormState): ParsedActionFormInputs => {
  const errors: Partial<Record<keyof ActionFormState, string>> = {};
  const values: Partial<Record<keyof ActionFormState, number>> = {};

  const rateFields: Array<keyof ActionFormState> = [
    'retailCurrentAccountRate', 'termDepositRate', 'corporateDepositRate', 'mortgageRate', 'consumerLoanRate', 'corporateLoanRate',
  ];
  rateFields.forEach((field) => {
    const parsed = parseRateInput(state[field]);
    if (parsed.error) {
      errors[field] = parsed.error;
      return;
    }
    if (parsed.value !== undefined) {
      values[field] = parsed.value;
    }
  });

  const underwritingFields: Array<keyof ActionFormState> = [
    'mortgageUnderwritingTightness', 'consumerUnderwritingTightness', 'corporateUnderwritingTightness',
  ];
  underwritingFields.forEach((field) => {
    const parsed = parseRateInput(state[field]);
    if (parsed.error) {
      errors[field] = parsed.error;
      return;
    }
    if (parsed.value !== undefined) {
      if (parsed.value < 0 || parsed.value > 1) {
        errors[field] = 'Underwriting tightness must be between 0 and 1';
        return;
      }
      values[field] = parsed.value;
    }
  });

  const amountFields: Array<keyof ActionFormState> = ['capitalMarketsTargetAmount','giltTradeAmount','boeFundingAmount','hedgeNotional'];
  amountFields.forEach((field) => {
    const parsed = parseMoneyInput(state[field]);
    if (parsed.error) {
      errors[field] = parsed.error;
      return;
    }
    if (parsed.value !== undefined) {
      values[field] = parsed.value;
    }
  });

  for (const field of ['mortgageMaxLtv'] as Array<keyof ActionFormState>) { const parsed=parseRateInput(state[field]); if(parsed.error) errors[field]=parsed.error; else if(parsed.value!==undefined){ if(parsed.value<0||parsed.value>1) errors[field]='Must be between 0 and 1'; else values[field]=parsed.value; } }
  for (const field of ['mortgageFixedPeriodMonths','termDepositTenorMonths','giltDurationYears'] as Array<keyof ActionFormState>) { const raw=Number(state[field]); if(!Number.isFinite(raw)||raw<=0) errors[field]='Must be a positive number'; else values[field]=raw; }
  if(state.giltTradeDirection!=='none' && (values.giltTradeAmount??0)<=0) errors.giltTradeAmount='Enter an amount for the selected gilt transaction';
  if(state.boeFacility!=='none' && (values.boeFundingAmount??0)<=0) errors.boeFundingAmount='Enter an amount for the selected Bank of England facility';
  if(state.capitalMarketsInstrument!=='none') {
    if((values.capitalMarketsTargetAmount??0)<=0) errors.capitalMarketsTargetAmount='Enter a positive target size for the transaction';
    const definition=getCapitalMarketsInstrument(state.capitalMarketsInstrument);
    if(definition.pricingKind==='discount') {
      const parsed=parseRateInput(state.capitalMarketsMaxDiscount);
      if(parsed.error) errors.capitalMarketsMaxDiscount=parsed.error;
      else if(parsed.value===undefined||parsed.value<0||parsed.value>0.5) errors.capitalMarketsMaxDiscount='Maximum discount must be between 0% and 50%';
      else values.capitalMarketsMaxDiscount=parsed.value;
    } else {
      const spread=Number(state.capitalMarketsMaxSpreadBps);
      if(!Number.isFinite(spread)||spread<=0||spread>5000) errors.capitalMarketsMaxSpreadBps='Maximum spread must be between 1 and 5,000 bp';
      else values.capitalMarketsMaxSpreadBps=spread;
    }
    if(definition.permittedTenorMonths?.length) {
      const tenor=Math.round(Number(state.capitalMarketsTenorMonths));
      if(!Number.isFinite(tenor)||!definition.permittedTenorMonths.includes(tenor)) errors.capitalMarketsTenorMonths='Select a permitted debt tenor';
      else values.capitalMarketsTenorMonths=tenor;
    }
  }

  const payoutParsed = parseRateInput(state.dividendPayoutRatio);
  if (payoutParsed.error) {
    errors.dividendPayoutRatio = payoutParsed.error;
  } else if (payoutParsed.value !== undefined) {
    if (payoutParsed.value < 0 || payoutParsed.value > 1) {
      errors.dividendPayoutRatio = 'Dividend payout ratio must be between 0 and 1';
    } else {
      values.dividendPayoutRatio = payoutParsed.value;
    }
  }

  const hedgeMaturityText = state.hedgeMaturityMonths.trim();
  if (hedgeMaturityText.length > 0) {
    const maturity = Number(hedgeMaturityText);
    if (!Number.isFinite(maturity) || maturity <= 0) {
      errors.hedgeMaturityMonths = 'Hedge maturity must be a positive number of months';
    } else {
      values.hedgeMaturityMonths = Math.round(maturity);
    }
  }

  if (state.hedgeDirection !== 'none' && (values.hedgeNotional ?? 0) <= 0) {
    errors.hedgeNotional = 'Hedge notional must be greater than zero';
  }

  return {
    values,
    errors,
    hasErrors: Object.keys(errors).length > 0,
  };
};

const buildActionsFromParsed = (
  parsed: ParsedActionFormInputs,
  formState: ActionFormState,
  currentState: BankState
): PlayerAction[] => {
  const actions: PlayerAction[] = [];
  const values = parsed.values;

  if (values.retailCurrentAccountRate !== undefined) {
    [LiabilityProductType.RetailCurrentAccounts].forEach(
      (productType) => {
        actions.push({
          type: 'adjustRate',
          productType,
          newRate: values.retailCurrentAccountRate!,
        });
      }
    );
  }
  if (values.termDepositRate !== undefined) actions.push({type:'adjustRate',productType:LiabilityProductType.RetailTermDeposits,newRate:values.termDepositRate});
  if (values.termDepositTenorMonths !== undefined) actions.push({type:'setTermDepositPolicy',tenorMonths:values.termDepositTenorMonths});
  if (values.corporateDepositRate !== undefined) {
    [
      LiabilityProductType.CorporateOperatingDeposits,
      LiabilityProductType.CorporateNonOperatingDeposits,
    ].forEach((productType) => {
      actions.push({
        type: 'adjustRate',
        productType,
        newRate: values.corporateDepositRate!,
      });
    });
  }
  if (values.mortgageRate !== undefined) {
    actions.push({
      type: 'adjustRate',
      productType: AssetProductType.Mortgages,
      newRate: values.mortgageRate,
    });
  }
  if (values.consumerLoanRate !== undefined) actions.push({type:'adjustRate',productType:AssetProductType.ConsumerLoans,newRate:values.consumerLoanRate});
  if (values.corporateLoanRate !== undefined) {
    actions.push({
      type: 'adjustRate',
      productType: AssetProductType.CorporateLoans,
      newRate: values.corporateLoanRate,
    });
  }
  if (values.mortgageUnderwritingTightness !== undefined) {
    actions.push({
      type: 'setUnderwriting',
      productType: AssetProductType.Mortgages,
      tightness: values.mortgageUnderwritingTightness,
    });
  }
  if (values.consumerUnderwritingTightness !== undefined) actions.push({type:'setUnderwriting',productType:AssetProductType.ConsumerLoans,tightness:values.consumerUnderwritingTightness});
  if (values.corporateUnderwritingTightness !== undefined) {
    actions.push({
      type: 'setUnderwriting',
      productType: AssetProductType.CorporateLoans,
      tightness: values.corporateUnderwritingTightness,
    });
  }
  if (values.mortgageMaxLtv!==undefined && values.mortgageFixedPeriodMonths!==undefined) actions.push({type:'setMortgagePolicy',maxLtv:values.mortgageMaxLtv,fixedPeriodMonths:values.mortgageFixedPeriodMonths});
  if (formState.giltTradeDirection!=='none' && values.giltTradeAmount!==undefined && values.giltTradeAmount>0) {
    actions.push({
      type:'buySellAsset',
      productType:AssetProductType.Gilts,
      amountDelta:formState.giltTradeDirection==='buy'?values.giltTradeAmount:-values.giltTradeAmount,
      tenorMonths:Math.round(values.giltDurationYears * 12),
    });
  }
  if (formState.boeFacility!=='none' && values.boeFundingAmount!==undefined && values.boeFundingAmount>0) actions.push({type:'drawBoeFunding',facility:formState.boeFacility,amount:values.boeFundingAmount});
  if (formState.capitalMarketsInstrument !== 'none' && values.capitalMarketsTargetAmount !== undefined && values.capitalMarketsTargetAmount > 0) {
    const definition=getCapitalMarketsInstrument(formState.capitalMarketsInstrument);
    actions.push({
      type: 'launchCapitalMarketsTransaction',
      instrument: formState.capitalMarketsInstrument,
      targetAmount: values.capitalMarketsTargetAmount,
      maxDiscount: definition.pricingKind === 'discount' ? values.capitalMarketsMaxDiscount : undefined,
      maxSpreadBps: definition.pricingKind === 'spread' ? values.capitalMarketsMaxSpreadBps : undefined,
      tenorMonths: definition.permittedTenorMonths?.length ? values.capitalMarketsTenorMonths : undefined,
    });
  }
  const fallbackPayout =
    currentState.behaviour.capitalPolicy?.dividendPayoutRatio ??
    baseConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio;
  const payoutRatio = values.dividendPayoutRatio ?? fallbackPayout;
  actions.push({
    type: 'setCapitalPolicy',
    dividendPayoutRatio: payoutRatio,
    at1CouponMode: 'auto',
  });
  if (
    formState.hedgeDirection !== 'none' &&
    values.hedgeNotional !== undefined &&
    values.hedgeNotional > 0
  ) {
    actions.push({
      type: 'enterHedge',
      direction: formState.hedgeDirection,
      notional: values.hedgeNotional,
      fixedRate: currentState.market.riskFreeShort,
      maturityMonths: values.hedgeMaturityMonths ? Math.max(1, Math.round(values.hedgeMaturityMonths)) : undefined,
    });
  }
  return actions;
};

const formatScenarioMetric = (value: number, metric: ScenarioMetricKey): string => {
  if (
    metric === 'cet1Ratio' ||
    metric === 'leverageRatio' ||
    metric === 'lcr' ||
    metric === 'nsfr' ||
    metric === 'roe' ||
    metric === 'nim'
  ) {
    return formatPct(value);
  }
  return formatCurrency(value);
};

const calculateNim = (state: BankState): number => {
  const assets = state.financial.balanceSheet.items
    .filter((item) => item.side === BalanceSheetSide.Asset)
    .reduce((sum, item) => sum + item.balance, 0);
  if (assets <= 0) return 0;
  return (state.financial.incomeStatement.netInterestIncome * 12) / assets;
};

const getGroupDepositRate = (state: BankState, segment: 'retail' | 'corporate'): number => {
  const productTypes: Array<LiabilityProductType> =
    segment === 'retail'
      ? [LiabilityProductType.RetailCurrentAccounts]
      : [
          LiabilityProductType.CorporateOperatingDeposits,
          LiabilityProductType.CorporateNonOperatingDeposits,
        ];
  const selected = state.financial.balanceSheet.items.filter((item) =>
    productTypes.includes(item.productType as LiabilityProductType)
  );
  const total = selected.reduce((sum, item) => sum + item.balance, 0);
  if (total <= 0) {
    return segment === 'retail'
      ? state.market.competitorRetailCurrentAccountRate
      : state.market.competitorCorporateDepositRate ?? state.market.competitorRetailCurrentAccountRate;
  }
  return selected.reduce((sum, item) => sum + item.balance * item.interestRate, 0) / total;
};

interface ScenarioBriefingView {
  riskMap: string[];
  failureModes: string[];
  firstStepFocus: string[];
}

interface ScenarioDebriefView {
  severity: 'danger' | 'warning' | 'info';
  title: string;
  summary: string;
  topDrivers: string[];
  recommendedLevers: string[];
}

const shockTypeDescription = (type: string): string | null => {
  if (type === 'idiosyncraticRun') {
    return 'Deposit outflows can accelerate quickly if confidence weakens.';
  }
  if (type === 'rolloverStress') {
    return 'Wholesale maturities may refinance only partially and at higher spreads.';
  }
  if (type === 'marketSpreadShock') {
    return 'Funding and credit spreads can widen, raising cost and liquidity pressure.';
  }
  if (type === 'macroDownturn') {
    return 'PD/LGD stress can increase provisions and erode capital buffers.';
  }
  if (type === 'depositCompetition') {
    return 'Competitor repricing can force faster deposit pass-through and margin pressure.';
  }
  if (type === 'counterpartyDefault') {
    return 'Concentrated counterparty losses can hit earnings and CET1 abruptly.';
  }
  return null;
};

const buildScenarioBriefing = (scenario: Scenario | null): ScenarioBriefingView | null => {
  if (!scenario) return null;

  const riskMap = Array.from(
    new Set(
      [
        ...scenario.scheduledShocks.map((entry) => shockTypeDescription(entry.shock.type)),
        ...(scenario.arcStages ?? []).flatMap((stage) => stage.shocks.map((shock) => shockTypeDescription(shock.type))),
      ].filter((line): line is string => Boolean(line))
    )
  ).slice(0, 3);

  const failureModes: string[] = [];
  const goals = scenario.goals?.objectives ?? [];
  if (goals.some((goal) => goal.metric === 'cet1Ratio')) {
    failureModes.push('CET1 buffer erosion after credit/provision shocks.');
  }
  if (goals.some((goal) => goal.metric === 'lcr' || goal.metric === 'nsfr')) {
    failureModes.push('Liquidity/funding squeeze from runoff and rollover stress.');
  }
  if (goals.some((goal) => goal.metric === 'leverageRatio')) {
    failureModes.push('Leverage backstop compression from asset growth and weak capital generation.');
  }
  if (goals.some((goal) => goal.metric === 'netIncome' || goal.metric === 'roe')) {
    failureModes.push('Earnings drag from higher funding cost and impairment charges.');
  }
  if (failureModes.length === 0) {
    failureModes.push('Mixed capital and liquidity constraints under scenario-triggered shocks.');
  }

  const firstStepFocus: string[] = [];
  if (riskMap.some((line) => line.includes('outflows') || line.includes('refinance'))) {
    firstStepFocus.push('Build liquidity headroom and reduce short-tenor funding dependence.');
  }
  if (riskMap.some((line) => line.includes('PD/LGD') || line.includes('counterparty'))) {
    firstStepFocus.push('Tighten underwriting and preserve CET1 via conservative payouts.');
  }
  if (firstStepFocus.length === 0) {
    firstStepFocus.push('Protect regulatory headroom first, then optimize earnings.');
  }

  return { riskMap, failureModes, firstStepFocus };
};

const buildScenarioDebrief = (args: {
  scenario: Scenario | null;
  state: BankState;
  score: ScenarioScore | null;
  attribution: StepAttribution | null;
  recommendations: string[];
}): ScenarioDebriefView | null => {
  const { scenario, state, score, attribution, recommendations } = args;
  if (!scenario) return null;

  const failed = state.status.hasFailed;
  const reachedHorizon = score ? state.time.step >= score.horizonMonths : false;
  if (!failed && !reachedHorizon) return null;

  const topDrivers = attribution
    ? (['cet1Ratio', 'lcr', 'nsfr'] as const)
        .map((metricKey) => {
          const metric = attribution.metrics[metricKey];
          const driverId = metric.topNegativeDriverId;
          if (!driverId) return null;
          const line = metric.lines.find((item) => item.id === driverId);
          if (!line) return null;
          return `${metric.label}: ${line.label}`;
        })
        .filter((item): item is string => Boolean(item))
        .slice(0, 3)
    : [];

  const recommendedLevers = recommendations.slice(0, 3);
  if (failed) {
    return {
      severity: 'danger',
      title: 'Scenario debrief: hard constraint breached',
      summary:
        'A regulatory hard limit was breached. Stabilize funding/capital buffers first before re-accelerating growth levers.',
      topDrivers,
      recommendedLevers,
    };
  }

  return {
    severity: score?.passed ? 'info' : 'warning',
    title: score?.passed
      ? 'Scenario debrief: horizon completed'
      : 'Scenario debrief: horizon reached but objectives at risk',
    summary: score
      ? `Completion ${(score.completionPct * 100).toFixed(1)}%, forward-risk penalty ${(score.qualityPenalty * 100).toFixed(1)}%.`
      : 'Horizon reached; review resilience and objective outcomes before next run.',
    topDrivers,
    recommendedLevers,
  };
};
