import DepartmentOffice from './components/DepartmentOffice';
import RiskAppetiteEditor, { RiskAppetite } from './components/RiskAppetiteEditor';
import PerformanceReport from './components/PerformanceReport';
import { Department } from './game/departments';
import { attentionReason, customerDeposits, monthsToPeriodEnd } from './game/management';
import Boardroom from './components/Boardroom';
import FunctionalNavigation from './components/FunctionalNavigation';
import FunctionalReportNavigation from './components/FunctionalReportNavigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { initialState } from './config/initialState';
import { baseConfig } from './config/baseConfig';
import { BankState } from './domain/bankState';
import { PlayerAction } from './domain/actions';
import {
  AssetProductType,
  LiabilityProductType,
  BalanceSheetSide,
} from './domain/enums';
import RiskDashboard from './components/RiskDashboard';
import { ActionFormState, type CapitalMarketsPlanImpact } from './components/ActionsPanel';
import { createActionFormState, clearOneOffTransactions } from './ui/actionFormState';
import { useSimulationClock } from './ui/useSimulationClock';
import { prepareScenarioSession } from './ui/scenarioSession';
import { useRunSession } from './ui/useRunSession';
import EventLog from './components/EventLog';
import ScenarioSelector from './components/ScenarioSelector';
import ScenarioBriefingPanel from './components/ScenarioBriefingPanel';
import { buildScenarioBriefing } from './game/scenarioBriefing';
import {
  getScenarioStepPayload,
  scenarios,
  Scenario,
} from './config/scenarios';
import { SimulationEvent } from './engine/simulation';
import { ComplianceStatus, RiskMetrics } from './domain/risks';
import RegMetricsPanel, { type RegulatoryMetric } from './components/RegMetricsPanel';
import LoansPanel from './components/LoansPanel';
import CostsPanel from './components/CostsPanel';
import ReconciliationPanel from './components/ReconciliationPanel';
import { SimulationConfig } from './domain/config';
import { SimulationController } from './ui/simulationController';
import AccountsPanel from './components/AccountsPanel';
import { formatCurrency, formatPct } from './utils/formatters';
import { parseMoneyInput, parseRateInput } from './utils/parsers';
import { evaluateScenarioGoals } from './engine/scoring';
import { ScenarioMetricKey, ScenarioScore } from './domain/scoring';
import RunComparisonPanel from './components/RunComparisonPanel';
import { AttributionLineSelection, StepAttribution } from './domain/attribution';
import SharePricePanel from './components/SharePricePanel';
import HelpCenterPanel from './components/HelpCenterPanel';
import AttributionMechanicExplainer from './components/AttributionMechanicExplainer';
import { createDefaultThreeYearPlan } from './config/threeYearPlan';
import { buildCapitalMarketsBook } from './engine/capitalMarkets';
import { getCapitalMarketsInstrument } from './capitalMarkets/catalogue';
import { PRODUCTS } from './products/catalogue';
import { loanCarryingAmounts } from './products/loanBalances';
import { capitalReconciliation } from './engine/capitalReconciliation';
import { creditStageDiagnostics } from './engine/creditStageDiagnostics';



const App = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [simConfig, setSimConfig] = useState<SimulationConfig>(baseConfig);
  const controller = useMemo(() => new SimulationController(simConfig), [simConfig]);
  const [pendingRiskAppetite, setPendingRiskAppetite] = useState<RiskAppetite|null|undefined>();
  const [bankState, setBankState] = useState<BankState>(initialState);
  const [stateHistory, setStateHistory] = useState<BankState[]>([initialState]);
  const [eventLog, setEventLog] = useState<SimulationEvent[]>([]);
  const [actionForm, setActionForm] = useState<ActionFormState>(() => createActionFormState(initialState, baseConfig));
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
  const [runPeriod, setRunPeriod] = useState('quarter');
  const navigationDepartment: Department | null = activeTab==='Boardroom' ? (isActionsOpen ? activeDepartment : null) : activeTab==='Loans' ? 'Lending' : ['Performance','Accounts','Share Price','Costs'].includes(activeTab) ? 'Capital' : activeTab==='Regulatory' ? reportOriginDepartment : null;
  const pendingActions = [
    actionForm.capitalMarketsInstrument!=='none' ? `${getCapitalMarketsInstrument(actionForm.capitalMarketsInstrument).label}: ${actionForm.capitalMarketsTargetAmount || 'amount required'}` : null,
    actionForm.giltTradeDirection!=='none' ? `${actionForm.giltTradeDirection==='buy'?'Buy':'Sell'} gilts: ${actionForm.giltTradeAmount || 'amount required'}` : null,
    actionForm.boeFacility!=='none' ? `${actionForm.boeFacility} drawing: ${actionForm.boeFundingAmount || 'amount required'}` : null,
    actionForm.hedgeDirection!=='none' ? `${actionForm.hedgeDirection==='payFixedReceiveFloat'?'Pay fixed':'Receive fixed'} swap: ${actionForm.hedgeNotional || 'notional required'}` : null,
    pendingRiskAppetite!==undefined ? 'Update internal risk appetite' : null,
  ].filter((item):item is string=>item!==null);
  const runSession = useRunSession(controller, initialState);
  const { savedRuns, currentTimeline, currentSnapshots } = runSession;
  const threeYearPlanEnabled = Boolean(bankState.threeYearPlan?.enabled);
  const canToggleThreeYearPlan = activeScenarioId === null && bankState.time.step === stateHistory[0].time.step;
  const setThreeYearPlanMode = (enabled: boolean) => {
    if (!canToggleThreeYearPlan) return;
    const nextConfig: SimulationConfig = { ...simConfig, featureFlags: { ...(simConfig.featureFlags ?? {}), threeYearPlan: enabled } };
    const nextState: BankState = { ...bankState, threeYearPlan: enabled ? createDefaultThreeYearPlan(bankState) : undefined };
    setSimConfig(nextConfig); setBankState(nextState); setStateHistory([nextState]); runSession.reset(nextState);
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
    if (parsedActionForm.hasErrors || clockRunning || !(isActionsOpen && activeTab==='Boardroom')) return null;
    const actions = buildActionsFromParsed(parsedActionForm, actionForm, bankState);
    if(pendingRiskAppetite!==undefined) actions.push({type:'setRiskAppetite',targets:pendingRiskAppetite});
    const scenarioStep = getScenarioStepPayload({
      scenarioId: activeScenarioId,
      stepNumber: bankState.time.step,
      state: bankState,
      actions,
    });

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
  }, [activeScenarioId, actionForm, bankState, parsedActionForm, simConfig, isActionsOpen, activeTab, clockRunning, pendingRiskAppetite]);
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
    setActionForm(clearOneOffTransactions);
  };
  const handleRunNextMonth = (automatic = false) => {
    if (!automatic) clock.stop();
    if (bankState.status.hasFailed) return;
    if (parsedActionForm.hasErrors) {
      setEventLog((prev) => [
        ...prev,
        {
          id: `ui-${Date.now()}`,
          severity: 'error',
          message: 'Cannot run step: fix action input validation errors first.',
          timestamp: Date.now(),
        },
      ]);
      return;
    }
    const actions = buildActionsFromParsed(parsedActionForm, actionForm, bankState);
    if(pendingRiskAppetite!==undefined) actions.push({type:'setRiskAppetite',targets:pendingRiskAppetite});
    const scenarioStep = getScenarioStepPayload({
      scenarioId: activeScenarioId,
      stepNumber: bankState.time.step,
      state: bankState,
      actions,
    });

    const { nextState, events, diagnostics } = controller.step(bankState, actions, scenarioStep.shocks);
    if (automatic) clock.afterAutomaticStep(nextState, simConfig);
    else clock.afterManualStep();
    const milestoneEvents = milestoneEventsFromPayload(scenarioStep);

    clearTransactions();
    setBankState(nextState);
    setStateHistory((prev) => [...prev, nextState]);
    setEventLog((prev) => [...prev, ...events, ...milestoneEvents]);
    setLastAttribution(diagnostics.attribution);
    setHighlightedEventIds([]);
    setSelectedAttributionLine(null);
    runSession.appendStep(nextState, actions, scenarioStep.shocks);
  };

  clockTickRef.current = () => handleRunNextMonth(true);

  // Opening a department is a deliberate policy-decision pause; timer/visibility coordination lives in useSimulationClock.
  useEffect(() => { if (isActionsOpen) { clock.stop(); setActiveTab('Boardroom'); } }, [isActionsOpen, clock.stop]);

  const handleSaveCurrentRun = () => {
    const record = runSession.saveCurrent({
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
    const round = (value: number) => Math.round(value * 100) / 100;
    const roundPrecise = (value: number) => Math.round(value * 10_000) / 10_000;
    const roundPerShare = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
    const millions = (value: number) => round(value / 1_000_000);
    const loanBalanceHistory = stateHistory.map(loanCarryingAmounts);
    const flowValue = (state: BankState, key: keyof NonNullable<BankState['periodFlows']>, product?: string): number => {
      const flow = state.periodFlows;
      if (!flow || product === undefined) return 0;
      const field = flow[key];
      return typeof field === 'object' && field !== null && product in field
        ? Number((field as Record<string, unknown>)[product] ?? 0)
        : 0;
    };
    const periodProductKeys = [...new Set(stateHistory.flatMap((state) => {
      const flow = state.periodFlows;
      if (!flow) return [];
      return [
        ...Object.keys(flow.interestIncomeByProduct),
        ...Object.keys(flow.fundingCostByProduct),
        ...Object.keys(flow.newLendingByProduct),
        ...Object.keys(flow.renewalsByProduct),
        ...Object.keys(flow.scheduledRepaymentsByProduct),
        ...Object.keys(flow.prepaymentsByProduct),
        ...Object.keys(flow.defaultsByProduct),
        ...Object.keys(flow.recoveriesByProduct),
        ...Object.keys(flow.provisionBridge?.fundedAllowanceMovementByProduct ?? {}),
        ...Object.keys(flow.provisionBridge?.workoutWriteoffsByProduct ?? {}),
        ...Object.keys(flow.provisionBridge?.oneOffLoanWriteDownsByProduct ?? {}),
      ];
    }))].filter((product) => stateHistory.some((state) => {
      const flow = state.periodFlows;
      if (!flow) return false;
      return [
        flow.interestIncomeByProduct[product as keyof typeof flow.interestIncomeByProduct],
        flow.fundingCostByProduct[product as keyof typeof flow.fundingCostByProduct],
        flow.newLendingByProduct[product as keyof typeof flow.newLendingByProduct],
        flow.renewalsByProduct[product as keyof typeof flow.renewalsByProduct],
        flow.scheduledRepaymentsByProduct[product as keyof typeof flow.scheduledRepaymentsByProduct],
        flow.prepaymentsByProduct[product as keyof typeof flow.prepaymentsByProduct],
        flow.defaultsByProduct[product as keyof typeof flow.defaultsByProduct],
        flow.recoveriesByProduct[product as keyof typeof flow.recoveriesByProduct],
        flow.provisionBridge?.fundedAllowanceMovementByProduct[product as keyof typeof flow.provisionBridge.fundedAllowanceMovementByProduct],
        flow.provisionBridge?.workoutWriteoffsByProduct[product as keyof typeof flow.provisionBridge.workoutWriteoffsByProduct],
        flow.provisionBridge?.oneOffLoanWriteDownsByProduct[product as keyof typeof flow.provisionBridge.oneOffLoanWriteDownsByProduct],
      ].some((value) => Math.abs(value ?? 0) > 0.01);
    })).sort();
    const loanProductKeys = periodProductKeys.filter((product) => Boolean(PRODUCTS[product as keyof typeof PRODUCTS]?.behaviour?.isLoan));
    const sumMap = (map: Partial<Record<string, number>> | undefined) => Object.values(map ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);
    const alignedFlowSeries = (metric: keyof NonNullable<BankState['periodFlows']>, product?: string) =>
      stateHistory.map((state, index) => index === 0 || !state.periodFlows
        ? null
        : millions(flowValue(state, metric, product)));
    const vintageTotals = new Map<string, { product: string; vintage: string; originations: number; defaults: number; recoveries: number; realizedLosses: number }>();
    const vintageLabel = (originationStep: number | null, fallbackDate: Date) => {
      if (originationStep === null || originationStep <= (stateHistory[0]?.time.step ?? 0)) return 'pre-run';
      const origination = stateHistory.find((state) => state.time.step === originationStep)?.time.date ?? fallbackDate;
      return String(origination.getUTCFullYear());
    };
    const vintageTotal = (product: string, vintage: string) => {
      const key = `${product}|${vintage}`;
      let value = vintageTotals.get(key);
      if (!value) {
        value = { product, vintage, originations: 0, defaults: 0, recoveries: 0, realizedLosses: 0 };
        vintageTotals.set(key, value);
      }
      return value;
    };
    stateHistory.slice(1).forEach((state) => {
      const flow = state.periodFlows;
      if (!flow) return;
      const originatedProducts = new Set([
        ...Object.keys(flow.newLendingByProduct),
        ...Object.keys(flow.renewalsByProduct),
      ]);
      originatedProducts.forEach((product) => {
        const total = vintageTotal(product, vintageLabel(state.time.step, state.time.date));
        total.originations += (flow.newLendingByProduct[product as keyof typeof flow.newLendingByProduct] ?? 0) +
          (flow.renewalsByProduct[product as keyof typeof flow.renewalsByProduct] ?? 0);
      });
      flow.defaultsByVintage.forEach((row) => {
        vintageTotal(row.productType, vintageLabel(row.originationStep, state.time.date)).defaults += row.amount;
      });
      flow.recoveriesByVintage.forEach((row) => {
        vintageTotal(row.productType, vintageLabel(row.originationStep, state.time.date)).recoveries += row.amount;
      });
      flow.realizedLossesByVintage.forEach((row) => {
        vintageTotal(row.productType, vintageLabel(row.originationStep, state.time.date)).realizedLosses += row.amount;
      });
    });
    Object.entries(loanBalanceHistory[0].byProduct).forEach(([product, amounts]) => {
      vintageTotal(product, 'pre-run').originations = amounts.gross;
    });
    const creditVintages = [...vintageTotals.values()]
      .sort((a, b) => a.vintage.localeCompare(b.vintage) || a.product.localeCompare(b.product))
      .map((row) => [
        row.product,
        row.vintage,
        millions(row.originations),
        millions(row.defaults),
        millions(row.recoveries),
        millions(row.realizedLosses),
        row.originations > 0 ? round((row.defaults / row.originations) * 100) : null,
      ]);
    const productFlows = Object.fromEntries(periodProductKeys.map((product) => {
      const isLoan = Boolean(PRODUCTS[product as keyof typeof PRODUCTS]?.behaviour?.isLoan);
      const hasInterestIncome = stateHistory.some((state) => Math.abs(flowValue(state, 'interestIncomeByProduct', product)) > 0.01);
      const hasFundingCost = stateHistory.some((state) => Math.abs(flowValue(state, 'fundingCostByProduct', product)) > 0.01);
      const row: Record<string, (number | null)[]> = {};
      if (hasInterestIncome) row.ii = alignedFlowSeries('interestIncomeByProduct', product);
      if (hasFundingCost) row.fc = alignedFlowSeries('fundingCostByProduct', product);
      if (isLoan) {
        row.nl = alignedFlowSeries('newLendingByProduct', product);
        row.rn = alignedFlowSeries('renewalsByProduct', product);
        row.sp = alignedFlowSeries('scheduledRepaymentsByProduct', product);
        row.pp = alignedFlowSeries('prepaymentsByProduct', product);
        row.df = alignedFlowSeries('defaultsByProduct', product);
        row.og = stateHistory.map((state, index) => index === 0 || !state.periodFlows ? null : millions(state.periodFlows.openingLoanExposureByProduct[product as keyof typeof state.periodFlows.openingLoanExposureByProduct] ?? 0));
        row.dr = stateHistory.map((state, index) => {
          if (index === 0 || !state.periodFlows) return null;
          const defaults = flowValue(state, 'defaultsByProduct', product);
          const openingExposure = state.periodFlows.openingLoanExposureByProduct[product as keyof typeof state.periodFlows.openingLoanExposureByProduct] ?? 0;
          return openingExposure > 0 ? round((defaults / openingExposure) * 100) : null;
        });
        row.rc = alignedFlowSeries('recoveriesByProduct', product);
        row.al = stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
          ? null
          : millions(state.periodFlows.provisionBridge.fundedAllowanceMovementByProduct[product as keyof typeof state.periodFlows.provisionBridge.fundedAllowanceMovementByProduct] ?? 0));
        row.wo = stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
          ? null
          : millions(state.periodFlows.provisionBridge.workoutWriteoffsByProduct[product as keyof typeof state.periodFlows.provisionBridge.workoutWriteoffsByProduct] ?? 0));
        row.xd = stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
          ? null
          : millions(state.periodFlows.provisionBridge.oneOffLoanWriteDownsByProduct[product as keyof typeof state.periodFlows.provisionBridge.oneOffLoanWriteDownsByProduct] ?? 0));
      }
      return [product, row];
    }));
    const capitalBridgeHistory = stateHistory.map(state => capitalReconciliation(state, simConfig));
    const nullableRound = (value: number | null) => value === null ? null : roundPrecise(value);
    const summarizeCapital = (state: BankState) => {
      const c = capitalReconciliation(state, simConfig);
      return {
        capturedAtClose: c.captured,
        capitalM: Object.fromEntries(['coreCet1', 'accumulatedOCI', 'includedOCI', 'excludedOCI', 'regulatoryDeductions', 'otherAdjustments', 'regulatoryCet1', 'at1', 'eligibleTier2', 'tier1', 'totalCapital', 'creditRwa', 'commitmentRwa', 'operationalRiskRwa', 'counterpartyRiskRwa', 'otherRwa', 'rwa', 'leverageExposure'].map(key => {
          const value = c[key as keyof typeof c] as number | null;
          return [key, value === null ? null : roundPrecise(value / 1_000_000)];
        })),
        ociInclusionRate: c.ociInclusionRate,
        reportedCet1Pct: roundPrecise(c.reportedCet1Ratio * 100),
        recalculatedCet1Pct: c.recalculatedCet1Ratio === null ? null : roundPrecise(c.recalculatedCet1Ratio * 100),
        ratioDifferencePp: c.cet1RatioDifference === null ? null : roundPrecise(c.cet1RatioDifference * 100),
        book: { accountingEquityM: roundPrecise(c.accountingEquity / 1_000_000), at1M: roundPrecise(c.at1 / 1_000_000), commonBookEquityM: roundPrecise(c.commonBookEquity / 1_000_000), capitalLedgerCommonEquityM: roundPrecise(c.capitalLedgerCommonEquity / 1_000_000), bookEquityDifferenceM: roundPrecise(c.bookEquityDifference / 1_000_000), sharesM: roundPrecise(c.sharesOutstanding / 1_000_000), calculatedBvps: nullableRound(c.calculatedBvps), reportedBvps: nullableRound(c.reportedBvps), calculatedPb: nullableRound(c.calculatedPriceToBook), reportedPb: nullableRound(c.reportedPriceToBook) },
      };
    };
    const summarizeState = (state: BankState) => {
      const byProduct = (side: BalanceSheetSide) => state.financial.balanceSheet.items
        .filter((item) => item.side === side)
        .reduce<Record<string, number>>((totals, item) => {
          totals[item.productType] = round((totals[item.productType] ?? 0) + item.balance / 1_000_000);
          return totals;
        }, {});
      const total = (side: BalanceSheetSide) => millions(state.financial.balanceSheet.items
        .filter((item) => item.side === side)
        .reduce((sum, item) => sum + item.balance, 0));
      const loanAmounts = loanCarryingAmounts(state);
      const loanAmountsM = (amounts: typeof loanAmounts.total) => Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, roundPrecise(value / 1_000_000)]));
      const risk = state.risk.riskMetrics;
      return {
        date: state.time.date.toISOString().slice(0, 10),
        step: state.time.step,
        balanceSheetM: { assets: total(BalanceSheetSide.Asset), liabilities: total(BalanceSheetSide.Liability), loansGross: millions(loanAmounts.total.gross), loansFundedAllowance: millions(loanAmounts.total.fundedAllowance), loansNet: millions(loanAmounts.total.net), deposits: millions(customerDeposits(state)), assetsByProduct: byProduct(BalanceSheetSide.Asset), liabilitiesByProduct: byProduct(BalanceSheetSide.Liability) },
        loanCarryingAmountsM: { total: loanAmountsM(loanAmounts.total), byProduct: Object.fromEntries(Object.entries(loanAmounts.byProduct).map(([product, amounts]) => [product, loanAmountsM(amounts)])) },
        capitalReconciliation: summarizeCapital(state),
        capitalM: { coreCet1: millions(state.financial.capital.cet1), at1: millions(state.financial.capital.at1), tier2: millions(state.financial.capital.tier2 ?? 0), oci: millions(state.financial.capital.accumulatedOCI), rwa: millions(risk.rwa) },
        ratiosPct: { cet1: round(risk.cet1Ratio * 100), cet1Requirement: round(risk.cet1Requirement * 100), leverage: round(risk.leverageRatio * 100), lcr: round(risk.lcr * 100), nsfr: round(risk.nsfr * 100) },
        lastMonthPnLM: { nii: millions(state.financial.incomeStatement.netInterestIncome), fees: millions(state.financial.incomeStatement.feeIncome), provisions: millions(state.financial.incomeStatement.provisionCharge), expenses: millions(state.financial.incomeStatement.operatingExpenses), net: millions(state.financial.incomeStatement.netIncome) },
        share: { price: roundPerShare(state.equityMarket.sharePrice), fairValue: round(state.equityMarket.fairValuePerShare ?? state.equityMarket.sharePrice), marketCapM: millions(state.equityMarket.marketCap), smoothedAnnualisedEps: roundPerShare(state.equityMarket.epsTtm), ttmEps: state.equityMarket.trailingEps == null ? null : roundPerShare(state.equityMarket.trailingEps), ttmMonths: state.equityMarket.trailingEarningsMonths ?? 0, modelPe: roundPerShare(state.equityMarket.peMultiple), quotedPeSmoothed: state.equityMarket.epsTtm > 0 ? roundPerShare(state.equityMarket.sharePrice / state.equityMarket.epsTtm) : null, quotedPeTtm: (state.equityMarket.trailingEps ?? 0) > 0 ? roundPerShare(state.equityMarket.sharePrice / state.equityMarket.trailingEps!) : null, pb: roundPerShare(state.equityMarket.priceToBook ?? 0) },
        competitorPricingPct: Object.fromEntries(Object.entries(state.periodFlows?.competitorPricing ?? {
          retailCurrentAccount: state.market.competitorRetailCurrentAccountRate,
          retailTermDeposit: state.market.competitorTermDepositRate,
          corporateDeposit: state.market.competitorCorporateDepositRate ?? null,
          mortgage: state.market.competitorMortgageRate,
          consumerLoan: state.market.competitorConsumerLoanRate,
          corporateLoan: state.market.riskFreeLong + state.market.corporateLoanSpread,
        }).map(([key, value]) => [key, value === null ? null : round(value * 100)])),
        status: { ...state.status },
      };
    };
    const opening = stateHistory[0] ?? bankState;
    const compactAction = (action: PlayerAction): unknown[] => {
      switch (action.type) {
        case 'adjustRate': return ['rate', action.productType, round(action.newRate * 100)];
        case 'buySellAsset': return ['asset', action.productType, millions(action.amountDelta), action.rate === undefined ? null : round(action.rate * 100), action.tenorMonths ?? null];
        case 'launchCapitalMarketsTransaction': return ['issue', action.instrument, millions(action.targetAmount), action.maxDiscount === undefined ? null : round(action.maxDiscount * 100), action.maxSpreadBps ?? null, action.tenorMonths ?? null];
        case 'drawBoeFunding': return ['boe', action.facility, millions(action.amount)];
        case 'setUnderwriting': return ['underwriting', action.productType, round(action.tightness * 100)];
        case 'setMortgagePolicy': return ['mortgage', round(action.maxLtv * 100), action.fixedPeriodMonths];
        case 'setTermDepositPolicy': return ['term', action.tenorMonths];
        case 'enterHedge': return ['hedge', action.direction, millions(action.notional), round(action.fixedRate * 100), action.maturityMonths ?? null];
        case 'setCapitalPolicy': return ['capitalPolicy', round(action.dividendPayoutRatio * 100), action.at1CouponMode ?? null];
        case 'setRiskAppetite': return ['targets', action.targets ? Object.fromEntries(Object.entries(action.targets).map(([key, value]) => [key, value === undefined ? null : round(value * 100)])) : null];
      }
    };
    const compactShock = (shock: import('./domain/shocks').Shock): unknown[] => {
      switch (shock.type) {
        case 'depositCompetition': return ['depositCompetition', round(shock.retailRateIncrease * 100), shock.corporateRateIncrease === undefined ? null : round(shock.corporateRateIncrease * 100)];
        case 'marketSpreadShock': return ['marketSpread', shock.wholesaleSpreadBps, shock.loanSpreadBps, round(shock.repoHaircutIncreasePct)];
        case 'idiosyncraticRun': return ['depositRun', round(shock.outflowRateMultiplier * 100)];
        case 'macroDownturn': return ['downturn', round(shock.pdMultiplier * 100), round(shock.lgdMultiplier * 100)];
        case 'counterpartyDefault': return ['counterpartyDefault', shock.productType, millions(shock.lossAmount)];
        case 'rolloverStress': return ['rolloverStress', round(shock.accessMultiplier * 100), shock.spreadBps];
      }
    };
    const decisions = currentTimeline.map((entry) => [
      entry.step - opening.time.step,
      entry.actions.map(compactAction),
      entry.shocks.map(compactShock),
    ] as [number, unknown[][], unknown[][]]).filter((entry) => entry[1].length || entry[2].length);
    const notableEvents = eventLog
      .filter((event) => event.severity !== 'info' || /filled|partial|capital|dividend|default|breach|failed|maturit|settled/i.test(event.message))
      .slice(-24)
      .map(({ severity, message, tags }) => [severity, message.slice(0, 180), ...(tags?.length ? [tags] : [])]);
    const flowMaps = (select: (state: BankState) => Partial<Record<string, number>> | undefined) =>
      stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
        ? null
        : millionsPrecise(sumMap(select(state))));
    const millionsPrecise = (value: number) => roundPrecise(value / 1_000_000);
    const provisionBridge = {
      note: 'Funded allowance is opening to closing ECL by stage and product; undrawn commitment ECL is shown separately. P&L provision charge components reconcile to the posted charge. Gross defaults enter workout and are not charge-offs. Workout write-offs are recorded when a bucket resolves, as principal less recoveries. One-off loan write-downs, securities impairment, and workout discount unwind are separate; discount unwind is included in the model provisionCharge field. Funded allowance movement is a portfolio ECL remeasurement, not a counterfactual decomposition of exposure, stage, PD, LGD, or macro effects.',
      stageLegend: '[opening Stage 1, Stage 2, Stage 3 £m, closing Stage 1, Stage 2, Stage 3 £m]',
      fundedAllowanceByStage: stateHistory.map((state, index) => {
        const bridge = state.periodFlows?.provisionBridge;
        if (index === 0 || !bridge) return null;
        const opening = bridge.fundedAllowanceOpeningByStage;
        const closing = bridge.fundedAllowanceClosingByStage;
        return [opening.stage1, opening.stage2, opening.stage3, closing.stage1, closing.stage2, closing.stage3].map(millionsPrecise);
      }),
      fundedAllowanceByProduct: Object.fromEntries(loanProductKeys.map((product) => [product, stateHistory.map((state, index) => {
        const bridge = state.periodFlows?.provisionBridge;
        if (index === 0 || !bridge) return null;
        const opening = bridge.fundedAllowanceOpeningByProduct[product as keyof typeof bridge.fundedAllowanceOpeningByProduct] ?? 0;
        const closing = bridge.fundedAllowanceClosingByProduct[product as keyof typeof bridge.fundedAllowanceClosingByProduct] ?? 0;
        const movement = bridge.fundedAllowanceMovementByProduct[product as keyof typeof bridge.fundedAllowanceMovementByProduct] ?? closing - opening;
        return [opening, closing, movement].map(millionsPrecise);
      })])),
      fundedAllowanceProductLegend: '[opening, closing, movement £m]',
      commitmentAllowance: stateHistory.map((state, index) => {
        const bridge = state.periodFlows?.provisionBridge;
        if (index === 0 || !bridge) return null;
        return [bridge.commitmentAllowanceOpening, bridge.commitmentAllowanceClosing, bridge.commitmentAllowanceClosing - bridge.commitmentAllowanceOpening].map(millionsPrecise);
      }),
      commitmentAllowanceLegend: '[opening, closing, movement £m]',
      pnlComponents: {
        workoutWriteoffs: flowMaps((state) => state.periodFlows?.provisionBridge?.workoutWriteoffsByProduct),
        oneOffLoanWriteDowns: flowMaps((state) => state.periodFlows?.provisionBridge?.oneOffLoanWriteDownsByProduct),
        fundedAllowanceMovement: flowMaps((state) => state.periodFlows?.provisionBridge?.fundedAllowanceMovementByProduct),
        commitmentAllowanceMovement: stateHistory.map((state, index) => {
          const bridge = state.periodFlows?.provisionBridge;
          return index === 0 || !bridge ? null : millionsPrecise(bridge.commitmentAllowanceClosing - bridge.commitmentAllowanceOpening);
        }),
        securitiesImpairment: flowMaps((state) => state.periodFlows?.provisionBridge?.securityImpairmentByProduct),
        workoutDiscountUnwind: flowMaps((state) => state.periodFlows?.provisionBridge?.workoutDiscountUnwindByProduct),
        provisionCharge: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge ? null : millionsPrecise(state.periodFlows.provisionBridge.provisionCharge)),
        reconciliationDifference: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge ? null : millionsPrecise(state.periodFlows.provisionBridge.reconciliationDifference)),
      },
      writeoffsByProduct: Object.fromEntries(loanProductKeys.map((product) => [product, stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
        ? null
        : millionsPrecise(state.periodFlows.provisionBridge.workoutWriteoffsByProduct[product as keyof typeof state.periodFlows.provisionBridge.workoutWriteoffsByProduct] ?? 0))])),
      oneOffLoanWriteDownsByProduct: Object.fromEntries(loanProductKeys.map((product) => [product, stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
        ? null
        : millionsPrecise(state.periodFlows.provisionBridge.oneOffLoanWriteDownsByProduct[product as keyof typeof state.periodFlows.provisionBridge.oneOffLoanWriteDownsByProduct] ?? 0))])),
      workoutDiscountUnwindByProduct: Object.fromEntries(loanProductKeys.map((product) => [product, stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
        ? null
        : millionsPrecise(state.periodFlows.provisionBridge.workoutDiscountUnwindByProduct[product as keyof typeof state.periodFlows.provisionBridge.workoutDiscountUnwindByProduct] ?? 0))])),
    };
    const macroAtValuation = {
      gdpGrowthMoMPct: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.shareValuation ? null : roundPrecise(state.periodFlows.shareValuation.gdpGrowthMoM * 100)),
      unemploymentPct: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.shareValuation ? null : roundPrecise(state.periodFlows.shareValuation.unemploymentRate * 100)),
      creditSpreadPct: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.shareValuation ? null : roundPrecise(state.periodFlows.shareValuation.creditSpread * 100)),
    };
    const valuationDiagnostics = {
      legend: '[opening EPS, annualised period EPS, smoothing alpha, smoothed annualised EPS, BVPS, ROE proxy %, cost of equity %, profitability score, CET1 headroom pp, leverage headroom pp, capital score, macro score, deposit franchise, franchise score, weighted profitability, weighted capital, weighted macro, weighted franchise, raw weighted score, absolute-weight denominator, normalized score, model PE, model PB, stressed EPS, earnings value, book value, earnings reliability, earnings weight, book weight, pre-stress fair value, capital discount, failure discount, fair value, prior price, unconstrained price, max move factor, closing share price, quoted PE (price / unrounded smoothed EPS)]',
      rows: stateHistory.map((state, index) => {
        const v = state.periodFlows?.shareValuation;
        if (index === 0 || !v) return null;
        return [
          v.epsTtmOpening, v.annualisedEps, v.epsAlpha, v.epsTtm, v.bvps,
          v.roeProxy * 100, v.costOfEquity * 100, v.profitabilityScore,
          v.cet1Headroom * 100, v.leverageHeadroom * 100, v.capitalScore,
          v.macroScore, v.franchiseStrength, v.franchiseScore,
          v.weightedProfitability, v.weightedCapital, v.weightedMacro, v.weightedFranchise,
          v.rawWeightedScore, v.scoreWeightDenominator, v.normalizedScore,
          v.modelPe, v.modelPb, v.stressedEarningsBase, v.earningsValue, v.bookValue,
          v.earningsReliability, v.earningsWeight, v.bookWeight, v.fairValueBeforeStress,
          v.capitalDiscount, v.failureDiscount, v.fairValue, v.priorSharePrice,
          v.unconstrainedSharePrice, v.moveLimitFactor, v.sharePrice, v.quotedPe,
        ].map((value) => value === null ? null : roundPrecise(value));
      }),
    };
    const extract = {
      format: 'banksim-run-extract',
      formatVersion: 6,
      filename: `banksim-run-${bankState.time.date.toISOString().slice(0, 10)}.json`,
      prompt: 'Put the supervisor in the bank executive’s seat. Explain the business model the board is pursuing—products, customers, funding, pricing, growth and returns—using recorded plans and decisions; label inferred aims. Choose 2–3 turning points and trace each decision or shock through volumes, prices, margins and cash flows to profit, balance sheet, capital, liquidity and valuation. Show board priorities and trade-offs: growth vs margin, risk vs return, funding cost vs stability, dividends vs resilience. Use dated figures to explain accounting and prudential consequences. Reconcile gross/net loans and ECL, provision charges vs write-offs, CET1/RWA, leverage, LCR/NSFR and dividends where possible; flag gaps. Separate facts from interpretation; timing alone does not prove cause. Distinguish model P/E, quoted P/E, smoothed annualised EPS and TTM EPS where available. End with three strategic business-model lessons for supervisors about choice, execution and resilience, and the evidence to seek.',
      run: {
        period: [opening.time.date.toISOString().slice(0, 10), bankState.time.date.toISOString().slice(0, 10), bankState.time.step - opening.time.step],
        opening: summarizeState(opening),
        ending: summarizeState(bankState),
        series: {
          months: stateHistory.map((s) => s.time.date.toISOString().slice(0, 7)),
          note: 'Arrays align with months. Money is £m; rates are %. Opening-period flows and diagnostics are null. Macro inputs in macroAtValuation and the valuation tuple are captured when price is calculated, before the market advances. Cash-flow categories are signed monthly net flows; LCR is a regulatory-weighted 30-day projection.',
          units: { assets: '£m', liabilities: '£m', loansGross: '£m', loansFundedAllowance: '£m', loansNet: '£m', loansReconciliationDifference: '£m', deposits: '£m', nii: '£m/period', netProfit: '£m/period', creditLosses: '£m/period', provisions: '£m/period', rwa: '£m', dividends: '£m/period', at1Coupons: '£m/period', cet1: '%', cet1Requirement: '%', leverage: '%', lcr: '%', nsfr: '%', sharePrice: '£', smoothedAnnualisedEps: '£/share (6 dp)', ttmEps: '£/share (6 dp)', ttmMonths: 'months', modelPe: 'multiple (6 dp)', quotedPeSmoothed: 'multiple (6 dp)', quotedPeTtm: 'multiple (6 dp)', pb: 'multiple', fairValue: '£/share', bvps: '£/share', marketCap: '£m', competitorPricing: '%', macro: '%' },
          keys: { assets: 'total assets', liabilities: 'total liabilities', loansGross: 'gross carrying amount including unresolved workouts', loansFundedAllowance: 'funded loan ECL contra-asset', loansNet: 'net loan carrying amount included in total assets', loansReconciliationDifference: 'gross minus funded allowance minus recorded net', deposits: 'customer deposits', nii: 'net interest income', netProfit: 'net profit', creditLosses: 'credit losses expensed, including non-loan shock losses', provisions: 'posted provision charge; see provisionBridge for components', rwa: 'risk-weighted assets', dividends: 'cash dividends paid', at1Coupons: 'AT1 coupons paid', cet1: 'CET1 ratio', cet1Requirement: 'CET1 requirement', leverage: 'leverage ratio', lcr: 'liquidity coverage ratio', nsfr: 'net stable funding ratio', sharePrice: 'share price', smoothedAnnualisedEps: 'exponentially smoothed annualised common EPS; not trailing earnings', ttmEps: '12-month common earnings / time-weighted ordinary shares; null before 12 observed months', ttmMonths: 'observed earnings history, capped at 12 months', modelPe: 'score-derived PE used to value earnings; not price/EPS', quotedPeSmoothed: 'share price divided by unrounded smoothed annualised EPS', quotedPeTtm: 'share price divided by positive conventional TTM EPS; otherwise null', pb: 'quoted price/book multiple', fairValue: 'model fair value', bvps: 'book value/share', marketCap: 'market capitalisation', cashFlow: 'realised monthly net cash-flow statement category; negative is outflow', lcr30d: '30-day regulatory-weighted forecast' },
          macroAtValuation,
          valuationDiagnostics,
          provisionBridge,
          capitalReconciliation: {
            note: 'Close-captured regulatory inputs. Core CET1 + included OCI - deductions + other adjustments = regulatory CET1; divide by RWA for the regulatory ratio. OCI inclusion is a model parameter. Book equity = assets - liabilities - AT1; BVPS uses ordinary shares. Legacy rows without captured inputs use current configuration and retain reported RWA; component RWA is null.',
            legend: '[captured 1/0, core CET1 £m, OCI £m, OCI inclusion %, included OCI £m, excluded OCI £m, deductions £m, other adjustments £m, regulatory CET1 £m, credit RWA £m, commitment RWA £m, operational RWA £m, counterparty RWA £m, other RWA £m, total RWA £m, reported CET1 %, recalculated CET1 %, difference pp, accounting equity £m, AT1 £m, common book equity £m, capital-ledger/common-book difference £m, shares million, calculated BVPS, reported BVPS, calculated P/B, reported P/B]',
            rows: capitalBridgeHistory.map(c => [Number(c.captured), c.coreCet1 / 1e6, c.accumulatedOCI / 1e6, c.ociInclusionRate * 100, c.includedOCI / 1e6, c.excludedOCI / 1e6, c.regulatoryDeductions / 1e6, c.otherAdjustments / 1e6, c.regulatoryCet1 / 1e6, ...[c.creditRwa, c.commitmentRwa, c.operationalRiskRwa, c.counterpartyRiskRwa, c.otherRwa].map(v => v === null ? null : v / 1e6), c.rwa / 1e6, c.reportedCet1Ratio * 100, c.recalculatedCet1Ratio === null ? null : c.recalculatedCet1Ratio * 100, c.cet1RatioDifference === null ? null : c.cet1RatioDifference * 100, c.accountingEquity / 1e6, c.at1 / 1e6, c.commonBookEquity / 1e6, c.bookEquityDifference / 1e6, c.sharesOutstanding / 1e6, c.calculatedBvps, c.reportedBvps, c.calculatedPriceToBook, c.reportedPriceToBook].map(nullableRound)),
          },
          creditStages: {
            legend: '[Stage 1 gross £m, Stage 2 gross £m, Stage 3 gross £m, performing reference annual PD %, performing current annual PD %, Stage 2 cure-probation gross £m]',
            rows: stateHistory.map(state => {
              const c = creditStageDiagnostics(state);
              return [c.stageGross.stage1 / 1e6, c.stageGross.stage2 / 1e6, c.stageGross.stage3 / 1e6, c.performingReferenceAnnualPd === null ? null : c.performingReferenceAnnualPd * 100, c.performingCurrentAnnualPd === null ? null : c.performingCurrentAnnualPd * 100, c.stage2CureProbationGross / 1e6].map(nullableRound);
            }),
            assumptions: simConfig.behaviour.ifrs9,
            note: 'SICR compares current annual PD with origination-reference annual PD as a lifetime-risk proxy. Stage 2 cures require sustained improvement. Seeded seasoned borrower affordability is dispersed; Stage 1 new lending starts without that historical deterioration. ECL uses a flat annual PD hazard, amortising balances and discounted scenario-weighted losses: 12-month default horizon for Stage 1 and remaining lifetime for Stage 2. Stage 3 includes unresolved workouts.',
          },
          earningsHistory: {
            legend: '[observed months, net income £m, common income after AT1 coupons £m, time-weighted shares million]; TTM EPS is common income / weighted shares only when observed months = 12. Multi-month observations are allocated pro rata at the rolling-window boundary. Legacy history is not invented.',
            rows: stateHistory.map(s => s.equityMarket.trailingEarningsMonths ? [s.equityMarket.trailingEarningsMonths, (s.equityMarket.trailingNetIncome ?? 0) / 1e6, (s.equityMarket.trailingCommonIncome ?? 0) / 1e6, (s.equityMarket.trailingWeightedAverageShares ?? 0) / 1e6].map(roundPrecise) : null),
          },
          valuationRiskDiagnostics: {
            legend: '[base cost of equity %, spread premium pp, uncertainty premium pp, capital-risk premium pp, profitability signal, capital signal, macro signal, franchise signal, earnings volatility, downside surprise, total uncertainty, abnormal-earnings persistence, persistent EPS, discount-rate factor, distributable-capital proxy £m, excess capital/share]',
            rows: stateHistory.map((state, index) => {
              const v = state.periodFlows?.shareValuation;
              if (index === 0 || v?.baseCostOfEquity === undefined) return null;
              return [v.baseCostOfEquity * 100, v.creditSpreadPremium * 100, v.uncertaintyPremium * 100, v.capitalRiskPremium * 100, v.profitabilitySignal, v.capitalSignal, v.macroSignal, v.franchiseSignal, v.earningsVolatility, v.earningsDownsideSurprise, v.earningsUncertainty, v.earningsPersistence, v.persistentEps, v.discountRateFactor, v.distributableCapitalProxy / 1e6, v.excessCapitalPerShare].map(roundPrecise);
            }),
          },
          values: {
            assets: stateHistory.map((s) => millions(s.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset).reduce((n, i) => n + i.balance, 0))),
            liabilities: stateHistory.map((s) => millions(s.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Liability).reduce((n, i) => n + i.balance, 0))),
            loansGross: loanBalanceHistory.map(({ total }) => roundPrecise(total.gross / 1_000_000)),
            loansFundedAllowance: loanBalanceHistory.map(({ total }) => roundPrecise(total.fundedAllowance / 1_000_000)),
            loansNet: loanBalanceHistory.map(({ total }) => roundPrecise(total.net / 1_000_000)),
            loansReconciliationDifference: loanBalanceHistory.map(({ total }) => roundPrecise(total.reconciliationDifference / 1_000_000)),
            deposits: stateHistory.map((s) => millions(customerDeposits(s))),
            nii: stateHistory.map((s) => millions(s.financial.incomeStatement.netInterestIncome)),
            netProfit: stateHistory.map((s) => millions(s.financial.incomeStatement.netIncome)),
            creditLosses: stateHistory.map((s) => millions(s.financial.incomeStatement.creditLosses)),
            provisions: stateHistory.map((s) => millions(s.financial.incomeStatement.provisionCharge)),
            cet1: stateHistory.map((s) => round(s.risk.riskMetrics.cet1Ratio * 100)),
            cet1Requirement: stateHistory.map((s) => round(s.risk.riskMetrics.cet1Requirement * 100)),
            leverage: stateHistory.map((s) => round(s.risk.riskMetrics.leverageRatio * 100)),
            lcr: stateHistory.map((s) => round(s.risk.riskMetrics.lcr * 100)),
            nsfr: stateHistory.map((s) => round(s.risk.riskMetrics.nsfr * 100)),
            sharePrice: stateHistory.map((s) => roundPerShare(s.equityMarket.sharePrice)),
            rwa: stateHistory.map((s) => millions(s.risk.riskMetrics.rwa)),
            dividends: stateHistory.map((s) => millions(s.financial.incomeStatement.dividendsPaid)),
            at1Coupons: stateHistory.map((s) => millions(s.financial.incomeStatement.at1CouponExpense)),
            smoothedAnnualisedEps: stateHistory.map((s) => roundPerShare(s.equityMarket.epsTtm)),
            ttmEps: stateHistory.map((s) => s.equityMarket.trailingEps == null ? null : roundPerShare(s.equityMarket.trailingEps)),
            ttmMonths: stateHistory.map((s) => s.equityMarket.trailingEarningsMonths ?? 0),
            quotedPeTtm: stateHistory.map((s) => (s.equityMarket.trailingEps ?? 0) > 0 ? roundPerShare(s.equityMarket.sharePrice / s.equityMarket.trailingEps!) : null),
            modelPe: stateHistory.map((s) => roundPerShare(s.equityMarket.peMultiple)),
            quotedPeSmoothed: stateHistory.map((s, index) => {
              const exact = index > 0 ? s.periodFlows?.shareValuation?.quotedPe : null;
              const computed = s.equityMarket.epsTtm > 0 ? s.equityMarket.sharePrice / s.equityMarket.epsTtm : null;
              const value = exact ?? computed;
              return value === null ? null : roundPerShare(value);
            }),
            pb: stateHistory.map((s) => roundPerShare(s.equityMarket.priceToBook ?? 0)),
            fairValue: stateHistory.map((s) => roundPerShare(s.equityMarket.fairValuePerShare ?? s.equityMarket.sharePrice)),
            bvps: stateHistory.map((s) => roundPerShare(s.equityMarket.bookValuePerShare ?? 0)),
            marketCap: stateHistory.map((s) => millions(s.equityMarket.marketCap)),
            periodMonths: stateHistory.map((s, index) => index === 0 ? null : s.periodFlows?.periodMonths ?? null),
            competitorPricingPct: {
              retailCurrentAccount: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.retailCurrentAccount : s.market.competitorRetailCurrentAccountRate) * 100)),
              retailTermDeposit: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.retailTermDeposit : s.market.competitorTermDepositRate) * 100)),
              corporateDeposit: stateHistory.map((s, index) => {
                const rate = index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.corporateDeposit : s.market.competitorCorporateDepositRate ?? null;
                return rate === null ? null : round(rate * 100);
              }),
              mortgage: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.mortgage : s.market.competitorMortgageRate) * 100)),
              consumerLoan: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.consumerLoan : s.market.competitorConsumerLoanRate) * 100)),
              corporateLoan: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.corporateLoan : s.market.riskFreeLong + s.market.corporateLoanSpread) * 100)),
            },
            cashFlowM: {
              operating: stateHistory.map((s) => millions(s.financial.cashFlowStatement.operatingCashFlow)),
              investing: stateHistory.map((s) => millions(s.financial.cashFlowStatement.investingCashFlow)),
              financing: stateHistory.map((s) => millions(s.financial.cashFlowStatement.financingCashFlow)),
              netChange: stateHistory.map((s) => millions(s.financial.cashFlowStatement.netChange)),
              cashEnd: stateHistory.map((s) => millions(s.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CashReserves)?.balance ?? 0)),
            },
            lcr30dM: {
              weightedOutflows: stateHistory.map((s) => s.periodFlows ? millions(s.periodFlows.lcr30d.weightedOutflows) : null),
              weightedInflows: stateHistory.map((s) => s.periodFlows ? millions(s.periodFlows.lcr30d.weightedInflows) : null),
              netOutflow: stateHistory.map((s) => s.periodFlows ? millions(s.periodFlows.lcr30d.netOutflow) : null),
              hqla: stateHistory.map((s) => s.periodFlows ? millions(s.periodFlows.lcr30d.hqla) : null),
            },
          },
          loanCarryingAmountsByProduct: {
            legend: '[gross, funded allowance, net, gross-minus-allowance-minus-net], all £m; rows align with months',
            rows: Object.fromEntries([...new Set(loanBalanceHistory.flatMap(book => Object.keys(book.byProduct)))].sort().map(product => [product,
              loanBalanceHistory.map(book => {
                const row = book.byProduct[product as keyof typeof book.byProduct];
                return row ? [row.gross, row.fundedAllowance, row.net, row.reconciliationDifference].map(value => roundPrecise(value / 1_000_000)) : [0, 0, 0, 0];
              }),
            ])),
          },
          loanAccountingBasis: 'Gross carrying amount includes cohort principal and unresolved workout principal. Funded allowance excludes undrawn commitment provisions and securities ECL. Gross minus funded allowance equals net, subject to rounding; reconciliation differences expose any mismatch. Total assets and assetsByProduct use recorded net carrying values for loans. Use gross for gross loan growth, default-rate denominators, allowance/gross coverage and gross product shares; use net for accounting balance-sheet comparisons. Regulatory exposure measures retain their own prescribed bases.',
          productFlows: {
            legend: { ii: 'interest income, including loan workout discount unwind', fc: 'funding cost', nl: 'new lending', rn: 'renewals/refinancing', sp: 'scheduled principal repayments', pp: 'prepayments including loan sales', og: 'opening gross loan carrying amount used as the default-rate denominator', df: 'gross principal defaults entering workout', dr: 'period defaults / opening gross loan exposure (%)', rc: 'recovery cash', al: 'funded ECL allowance movement (closing less opening)', wo: 'realised workout charge-offs on resolution', xd: 'one-off loan write-downs from shocks' },
            rows: productFlows,
          },
          creditVintages,
          creditVintageLegend: '[product, origination year or pre-run, originations £m, gross defaults £m, recovery cash £m, realised workout losses £m, cumulative gross-default rate %]; pre-run denominator is opening gross exposure.',
        },
        shareValuationModel: {
          formula: 'Signals for ROE versus variable cost of equity, capital headroom, macro conditions and deposit franchise use softsign x/(1+abs(x)), then a normalized weighted score sets PE and PB via neutral multiple * exp(sensitivity * score), with explicit multiple caps. Cost of equity = clamp(base + spread beta*(credit spread-neutral) + uncertainty premium*uncertainty/(1+uncertainty) + capital-shortfall premium*max(0,-capital score)). Uncertainty = rolling annualised common-EPS volatility / max(EPS floor,abs(mean)) + downside surprise against opening smoothed EPS. Persistence = 1/(1+sensitivity*uncertainty); it fades positive abnormal earnings above costOfEquity*BVPS. Earnings value = stressed persistent EPS * model PE * base/current cost of equity. Reliability = EPS-level reliability/(1+uncertainty); unreliable earnings shift weight to book. Capital headroom above CET1/leverage targets is valued at par; remaining common book is valued at model PB. That headroom is a valuation proxy, not legal distributable reserves. Blend earnings and book components, apply breach/failure discounts and price floor; price mean-reverts subject to a move cap. These are configurable game assumptions, not an estimated market valuation model. Quoted PE is price/EPS and can rise when EPS collapses even as model PE falls.',
          parameters: simConfig.behaviour.sharePriceModel ? {
            baseCostOfEquity: simConfig.behaviour.sharePriceModel.costOfEquity,
            costOfEquityMin: simConfig.behaviour.sharePriceModel.costOfEquityMin ?? 0.06,
            costOfEquityMax: simConfig.behaviour.sharePriceModel.costOfEquityMax ?? 0.25,
            creditSpreadEquityBeta: simConfig.behaviour.sharePriceModel.creditSpreadEquityBeta ?? 1.5,
            earningsUncertaintyPremium: simConfig.behaviour.sharePriceModel.earningsUncertaintyPremium ?? 0.03,
            capitalShortfallPremium: simConfig.behaviour.sharePriceModel.capitalShortfallPremium ?? 0.04,
            abnormalEarningsPersistenceSensitivity: simConfig.behaviour.sharePriceModel.abnormalEarningsPersistenceSensitivity ?? 1,
            epsFormula: 'smoothed = (1-alpha)*prior + alpha*annualised common EPS; alpha=1-(1-monthly smoothing)^periodMonths; annualised common EPS = (net income - actual AT1 coupons)*12/(periodMonths*shares)',
            scoreWeights: { profitability: simConfig.behaviour.sharePriceModel.profitabilityWeight, capital: simConfig.behaviour.sharePriceModel.capitalWeight, macro: simConfig.behaviour.sharePriceModel.macroWeight, franchise: simConfig.behaviour.sharePriceModel.franchiseWeight },
            pe: { neutral: simConfig.behaviour.sharePriceModel.peNeutral, min: simConfig.behaviour.sharePriceModel.peMin, max: simConfig.behaviour.sharePriceModel.peMax, scoreSensitivity: simConfig.behaviour.sharePriceModel.peScoreSensitivity },
            pb: { neutral: simConfig.behaviour.sharePriceModel.pbNeutral, min: simConfig.behaviour.sharePriceModel.pbMin, max: simConfig.behaviour.sharePriceModel.pbMax, scoreSensitivity: simConfig.behaviour.sharePriceModel.pbScoreSensitivity },
            valuationWeights: { earnings: simConfig.behaviour.sharePriceModel.earningsValuationWeight, book: simConfig.behaviour.sharePriceModel.bookValuationWeight },
            epsSmoothingMonthly: simConfig.behaviour.sharePriceModel.epsSmoothingMonthly,
            epsFloor: simConfig.behaviour.sharePriceModel.epsFloor,
            meanReversionMonthly: simConfig.behaviour.sharePriceModel.meanReversionSpeedMonthly,
            maxMonthlyMove: simConfig.behaviour.sharePriceModel.maxMonthlyMove,
            capitalBreachDiscount: simConfig.behaviour.sharePriceModel.capitalBreachDiscount,
            failurePriceFactor: simConfig.behaviour.sharePriceModel.failurePriceFactor,
            priceFloor: simConfig.behaviour.sharePriceModel.priceFloor,
            scoreScales: {
              roe: simConfig.behaviour.sharePriceModel.roeScale,
              cet1Headroom: simConfig.behaviour.sharePriceModel.capitalCet1Scale,
              leverageHeadroom: simConfig.behaviour.sharePriceModel.capitalLeverageScale,
              gdpGrowthMonthly: simConfig.behaviour.sharePriceModel.macroGdpScale,
              unemploymentNeutral: simConfig.behaviour.sharePriceModel.macroUnemploymentNeutral,
              unemploymentScale: simConfig.behaviour.sharePriceModel.macroUnemploymentScale,
              creditSpreadNeutral: simConfig.behaviour.sharePriceModel.macroCreditSpreadNeutral,
              creditSpreadScale: simConfig.behaviour.sharePriceModel.macroCreditSpreadScale,
              franchiseNeutral: simConfig.behaviour.sharePriceModel.franchiseNeutral,
              franchiseScale: simConfig.behaviour.sharePriceModel.franchiseScale,
            },
          } : null,
        },
        decisionLegend: {
          tuple: '[elapsed month, action tuples, shock tuples]; elapsed month 1 is the first simulated month.',
          actions: {
            rate: '[type, product, new rate %]', asset: '[type, product, amount £m, rate %, tenor months]', issue: '[type, instrument, target £m, max discount %, max spread bp, tenor months]', boe: '[type, facility, amount £m]', underwriting: '[type, product, selectivity %]', mortgage: '[type, max LTV %, fixed months]', term: '[type, term months]', hedge: '[type, direction, notional £m, fixed rate %, maturity months]', capitalPolicy: '[type, dividend payout % of positive profit, AT1 coupon mode]', targets: '[type, risk targets as percentages or null]'
          },
          shocks: {
            depositCompetition: '[type, retail rate increase pp, corporate rate increase pp]', marketSpread: '[type, wholesale spread bp, loan spread bp, repo haircut increase]', depositRun: '[type, outflow multiplier %]', downturn: '[type, PD multiplier %, LGD multiplier %]', counterpartyDefault: '[type, product, loss £m]', rolloverStress: '[type, access multiplier %, spread bp]'
          },
        },
        decisions,
        eventLegend: ['[severity, message, optional tags]'],
        events: notableEvents,
      },
    };
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
    setBankState(scenarioState);
    setStateHistory([scenarioState]);
    setEventLog([]);
    setLastAttribution(null);
    setHighlightedEventIds([]);
    setSelectedAttributionLine(null);
    setActiveScenarioId(scenarioId);
    setSelectedScenarioId(scenarioId);
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
       <div className="clock-buttons"><button className="button" onClick={pauseClock} disabled={!clockRunning} aria-label="Pause simulation">Ⅱ Pause</button><label><span className="sr-only">Advance time</span><select aria-label="Advance time" value={runPeriod} disabled={clockRunning} onChange={e=>setRunPeriod(e.target.value)}><option value="month">One month</option><option value="quarter">To quarter end</option><option value="year">To year end</option><option value="auto">Continuous</option></select></label><button className="button primary" disabled={bankState.status.hasFailed||parsedActionForm.hasErrors||clockRunning} onClick={()=>startClock(runPeriod==='auto'?Infinity:runPeriod==='month'?1:monthsToPeriodEnd(bankState.time.step-stateHistory[0].time.step,runPeriod==='quarter'?3:12))}>▶ Run</button></div>
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
        <DepartmentOffice department={activeDepartment} state={bankState} history={stateHistory} form={actionForm} errors={parsedActionForm.errors} hasErrors={parsedActionForm.hasErrors} onChange={next=>{pauseClock();setActionForm(next);}} onReport={openReport} onHelp={openHelpSection} estimate={preview?.baseline??null} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpact={capitalMarketsPlanImpact}/>
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
              <div className="scenario-run-horizon">Month {Math.max(0, bankState.time.step - stateHistory[0].time.step)} of {scenarioScore.horizonMonths}</div>
              <table className="data-table">
                <thead><tr><th>Objective</th><th className="numeric">Current</th><th className="numeric">Target</th><th className="numeric">Progress</th></tr></thead>
                <tbody>{scenarioScore.details.map((detail)=><tr key={detail.label}><td>{detail.label}</td><td className="numeric">{formatScenarioMetric(detail.current,detail.metric)}</td><td className="numeric">{formatScenarioMetric(detail.target,detail.metric)}</td><td className="numeric">{(detail.completion*100).toFixed(0)}%</td></tr>)}</tbody>
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
        onMetricChange={setRegulatoryMetric}
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

interface ScenarioDebriefView {
  severity: 'danger' | 'warning' | 'info';
  title: string;
  summary: string;
  topDrivers: string[];
  recommendedLevers: string[];
}

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
