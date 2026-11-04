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
    const millions = (value: number) => round(value / 1_000_000);
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
      const loans = millions(state.financial.balanceSheet.items
        .filter((item) => item.side === BalanceSheetSide.Asset && PRODUCTS[item.productType]?.behaviour?.isLoan)
        .reduce((sum, item) => sum + item.balance, 0));
      const risk = state.risk.riskMetrics;
      return {
        date: state.time.date.toISOString().slice(0, 10),
        step: state.time.step,
        balanceSheetM: { assets: total(BalanceSheetSide.Asset), liabilities: total(BalanceSheetSide.Liability), loans, deposits: millions(customerDeposits(state)), assetsByProduct: byProduct(BalanceSheetSide.Asset), liabilitiesByProduct: byProduct(BalanceSheetSide.Liability) },
        capitalM: { cet1: millions(state.financial.capital.cet1), at1: millions(state.financial.capital.at1), tier2: millions(state.financial.capital.tier2 ?? 0), oci: millions(state.financial.capital.accumulatedOCI) },
        ratiosPct: { cet1: round(risk.cet1Ratio * 100), cet1Requirement: round(risk.cet1Requirement * 100), leverage: round(risk.leverageRatio * 100), lcr: round(risk.lcr * 100), nsfr: round(risk.nsfr * 100) },
        lastMonthPnLM: { nii: millions(state.financial.incomeStatement.netInterestIncome), fees: millions(state.financial.incomeStatement.feeIncome), provisions: millions(state.financial.incomeStatement.provisionCharge), expenses: millions(state.financial.incomeStatement.operatingExpenses), net: millions(state.financial.incomeStatement.netIncome) },
        share: { price: round(state.equityMarket.sharePrice), marketCapM: millions(state.equityMarket.marketCap), eps: round(state.equityMarket.epsTtm) },
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
      .slice(-40)
      .map(({ severity, message, tags }) => [severity, message.slice(0, 240), ...(tags?.length ? [tags] : [])]);
    const extract = {
      format: 'banksim-run-extract',
      formatVersion: 2,
      filename: `banksim-run-${bankState.time.date.toISOString().slice(0, 10)}.json`,
      prompt: 'Explain this BankSim run: compare start and finish, describe the main turning points, and connect recorded decisions or shocks to changes in profit, balance sheet, capital, liquidity and share price. Cite dates and figures from the series. Distinguish evidence from plausible explanation; flag missing data. End with three management lessons.',
      run: {
        period: [opening.time.date.toISOString().slice(0, 10), bankState.time.date.toISOString().slice(0, 10), bankState.time.step - opening.time.step],
        opening: summarizeState(opening),
        ending: summarizeState(bankState),
        series: {
          months: stateHistory.map((s) => s.time.date.toISOString().slice(0, 7)),
          note: 'Each value array aligns by index with months. Ratios are percentages; monetary series are £m.',
          units: { assets: '£m', liabilities: '£m', loans: '£m', deposits: '£m', nii: '£m/month', netProfit: '£m/month', provisions: '£m/month', cet1: '%', cet1Requirement: '%', leverage: '%', lcr: '%', nsfr: '%', sharePrice: '£' },
          keys: { assets: 'total assets', liabilities: 'total liabilities', loans: 'gross loan book', deposits: 'customer deposits', nii: 'net interest income', netProfit: 'net profit', provisions: 'provision charge', cet1: 'CET1 ratio', cet1Requirement: 'CET1 requirement', leverage: 'leverage ratio', lcr: 'liquidity coverage ratio', nsfr: 'net stable funding ratio', sharePrice: 'share price' },
          values: {
            assets: stateHistory.map((s) => millions(s.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset).reduce((n, i) => n + i.balance, 0))),
            liabilities: stateHistory.map((s) => millions(s.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Liability).reduce((n, i) => n + i.balance, 0))),
            loans: stateHistory.map((s) => millions(s.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset && PRODUCTS[i.productType]?.behaviour?.isLoan).reduce((n, i) => n + i.balance, 0))),
            deposits: stateHistory.map((s) => millions(customerDeposits(s))),
            nii: stateHistory.map((s) => millions(s.financial.incomeStatement.netInterestIncome)),
            netProfit: stateHistory.map((s) => millions(s.financial.incomeStatement.netIncome)),
            provisions: stateHistory.map((s) => millions(s.financial.incomeStatement.provisionCharge)),
            cet1: stateHistory.map((s) => round(s.risk.riskMetrics.cet1Ratio * 100)),
            cet1Requirement: stateHistory.map((s) => round(s.risk.riskMetrics.cet1Requirement * 100)),
            leverage: stateHistory.map((s) => round(s.risk.riskMetrics.leverageRatio * 100)),
            lcr: stateHistory.map((s) => round(s.risk.riskMetrics.lcr * 100)),
            nsfr: stateHistory.map((s) => round(s.risk.riskMetrics.nsfr * 100)),
            sharePrice: stateHistory.map((s) => round(s.equityMarket.sharePrice)),
          },
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
        <div className="masthead-actions"><button className="button ghost" onClick={() => void handleExtractRun()}>{extractStatus==='copied'?'Copied JSON':extractStatus==='failed'?'Copy failed':'Extract run'}</button><details className="settings-menu"><summary>Settings</summary><div><button className="button" onClick={handleSaveCurrentRun}>Save run</button><button className="button" onClick={() => handleStartScenario(null)}>Start a fresh bank</button><button className="button ghost" onClick={()=>openReport('Events')}>Event log</button><button className="button ghost" onClick={()=>openReport('Reconciliations')}>Reconciliations</button><button className="button ghost" onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>Use {theme==='light'?'dark':'light'} theme</button><label className="clock-safety"><input type="checkbox" checked={threeYearPlanEnabled} disabled={!canToggleThreeYearPlan} onChange={e=>setThreeYearPlanMode(e.target.checked)}/>Three-year plan mode</label><label>Speed<select value={clockSpeed} onChange={e=>setClockSpeed(Number(e.target.value))}><option value={1500}>1×</option><option value={450}>3×</option></select></label><label className="clock-safety"><input type="checkbox" checked={safetyPause} onChange={e=>setSafetyPause(e.target.checked)}/>Pause when buffers need attention</label></div></details></div>
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
