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
import TopMetricsPanel from './components/TopMetricsPanel';
import ActionsPanel, { ActionFormState } from './components/ActionsPanel';
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
import { SimulationController, StopCondition } from './ui/simulationController';
import AccountsPanel from './components/AccountsPanel';
import ExogenousVariablesPanel from './components/ExogenousVariablesPanel';
import { formatCurrency, formatPct, formatSignedPct } from './utils/formatters';
import { parseMoneyInput, parseRateInput } from './utils/parsers';
import { evaluateScenarioGoals } from './engine/scoring';
import { ScenarioMetricKey, ScenarioScore } from './domain/scoring';
import { ActionTimelineEntry, RunRecord, RunSnapshot } from './domain/runHistory';
import RunComparisonPanel from './components/RunComparisonPanel';
import { AttributionLineSelection, StepAttribution } from './domain/attribution';
import SharePricePanel from './components/SharePricePanel';
import HelpCenterPanel from './components/HelpCenterPanel';
import HelpLink from './components/HelpLink';
import MechanicGuardrails from './components/MechanicGuardrails';
import AttributionMechanicExplainer from './components/AttributionMechanicExplainer';
import { buildPreRunGuardrails } from './content/guardrails';
import TutorialOverlay from './components/TutorialOverlay';
import { readTutorialCompleted, writeTutorialCompleted } from './content/tutorialState';

const controller = new SimulationController(baseConfig);
const tabs = [
  'Overview',
  'Share Price',
  'Scenarios',
  'Accounts',
  'Regulatory',
  'Loans',
  'Costs',
  'Events',
  'Reconciliations',
  'Past games',
  'Help',
];

interface TabHelpLink {
  label: string;
  sectionId: string;
}

const tabHelpLinks: Record<string, TabHelpLink[]> = {
  Overview: [
    { label: 'Monthly pipeline', sectionId: 'core-monthly-loop' },
    { label: 'Risk limits', sectionId: 'risk-metrics-and-compliance' },
    { label: 'Preview and recommendations', sectionId: 'preview-and-recommendations' },
  ],
  'Share Price': [{ label: 'Share price model', sectionId: 'share-price-model' }],
  Scenarios: [
    { label: 'Scenario system', sectionId: 'scenario-system' },
    { label: 'Macro and spread engine', sectionId: 'market-and-curve-engine' },
  ],
  Accounts: [{ label: 'Attribution and reconciliation', sectionId: 'attribution-events-reconciliation' }],
  Regulatory: [
    { label: 'Capital breach limits', sectionId: 'risk-metrics-and-compliance' },
    { label: 'Confidence states', sectionId: 'confidence-state-machine' },
    { label: 'LCR and NSFR', sectionId: 'liquidity-ratios' },
  ],
  Loans: [
    { label: 'Loan pipeline', sectionId: 'loan-pipeline' },
    { label: 'Cohorts and IFRS9', sectionId: 'loan-cohorts-and-ifrs9' },
  ],
  Costs: [
    { label: 'Capital distributions', sectionId: 'capital-policy-and-distributions' },
    { label: 'Conduct risk', sectionId: 'conduct-risk' },
  ],
  Events: [
    { label: 'Attribution and event links', sectionId: 'attribution-events-reconciliation' },
    { label: 'Conduct events', sectionId: 'conduct-risk' },
  ],
  Reconciliations: [{ label: 'Reconciliation mechanics', sectionId: 'attribution-events-reconciliation' }],
  'Past games': [{ label: 'Autopilot and replay', sectionId: 'autopilot-and-run-history' }],
};

interface TutorialStepView {
  title: string;
  summary: string;
  instructions: string[];
  ready: boolean;
  readinessHint: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
}

const formatRateInputPct = (rate: number | null | undefined): string => {
  if (rate === undefined || rate === null || !Number.isFinite(rate)) return '';
  return `${(rate * 100).toFixed(2)}%`;
};

const App = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [simConfig, setSimConfig] = useState<SimulationConfig>(baseConfig);
  const [bankState, setBankState] = useState<BankState>(initialState);
  const [stateHistory, setStateHistory] = useState<BankState[]>([initialState]);
  const [eventLog, setEventLog] = useState<SimulationEvent[]>([]);
  const [actionForm, setActionForm] = useState<ActionFormState>({
    retailDepositRate: formatRateInputPct(getGroupDepositRate(bankState, 'retail')),
    corporateDepositRate: formatRateInputPct(getGroupDepositRate(bankState, 'corporate')),
    mortgageRate: formatRateInputPct(
      bankState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)
        ?.interestRate
    ),
    corporateLoanRate: formatRateInputPct(
      bankState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CorporateLoans)
        ?.interestRate
    ),
    mortgageUnderwritingTightness:
      (bankState.behaviour.underwritingTightness?.[AssetProductType.Mortgages] ?? 0).toString(),
    corporateUnderwritingTightness:
      (bankState.behaviour.underwritingTightness?.[AssetProductType.CorporateLoans] ?? 0).toString(),
    issueLTDebtAmount: '',
    issueEquityAmount: '',
    dividendPayoutRatio: (
      bankState.behaviour.capitalPolicy?.dividendPayoutRatio ??
      baseConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio
    ).toString(),
    at1CouponMode: bankState.behaviour.capitalPolicy?.at1CouponMode ?? 'auto',
    hedgeDirection: 'none',
    hedgeNotional: '',
    hedgeFixedRate: '',
    hedgeMaturityMonths: '24',
  });
  const [lastAttribution, setLastAttribution] = useState<StepAttribution | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Overview');
  const [helpSectionFocus, setHelpSectionFocus] = useState<string | null>(null);
  const [highlightedEventIds, setHighlightedEventIds] = useState<string[]>([]);
  const [selectedAttributionLine, setSelectedAttributionLine] = useState<AttributionLineSelection | null>(null);
  const [runHorizonMonths, setRunHorizonMonths] = useState<number>(1);
  const [stopConditionMode, setStopConditionMode] = useState<'none' | StopCondition['kind']>('none');
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [savedRuns, setSavedRuns] = useState<RunRecord[]>([]);
  const [currentTimeline, setCurrentTimeline] = useState<ActionTimelineEntry[]>([]);
  const [currentSnapshots, setCurrentSnapshots] = useState<RunSnapshot[]>([
    controller.createSnapshot(initialState),
  ]);
  const [runCounter, setRunCounter] = useState(1);
  const [tutorialCompleted, setTutorialCompleted] = useState<boolean>(() => readTutorialCompleted());
  const [isTutorialOpen, setIsTutorialOpen] = useState<boolean>(() => !readTutorialCompleted());
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [tutorialRunAnchorStep, setTutorialRunAnchorStep] = useState<number | null>(null);
  const [tutorialRiskPreparedStep, setTutorialRiskPreparedStep] = useState<number | null>(null);
  const [tutorialSawGuardrail, setTutorialSawGuardrail] = useState(false);
  const [tutorialMitigationApplied, setTutorialMitigationApplied] = useState(false);
  const actionsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const actionsDrawerContentRef = useRef<HTMLDivElement | null>(null);

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

  const roe = totalEquity > 0 ? (bankState.financial.incomeStatement.netIncome * 12) / totalEquity : 0;
  const nim = totalAssets > 0 ? (bankState.financial.incomeStatement.netInterestIncome * 12) / totalAssets : 0;
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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!isActionsOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsActionsOpen(false);
        return;
      }

      if (e.key !== 'Tab') return;

      const container = actionsDrawerContentRef.current;
      if (!container) return;

      const focusableSelector =
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

      const focusableElements = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    actionsCloseButtonRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isActionsOpen]);

  const preview = useMemo<StepPreview | null>(() => {
    if (parsedActionForm.hasErrors) return null;
    const actions = buildActionsFromParsed(parsedActionForm, actionForm, bankState);
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
  }, [activeScenarioId, actionForm, bankState, parsedActionForm, simConfig]);

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
  const guardrails = useMemo(
    () =>
      buildPreRunGuardrails({
        state: bankState,
        config: simConfig,
        parsedValues: parsedActionForm.values,
        hasValidationErrors: parsedActionForm.hasErrors,
        preview: preview
          ? {
              stressedCet1Ratio: preview.stressed.risk.riskMetrics.cet1Ratio,
              stressedLcr: preview.stressed.risk.riskMetrics.lcr,
              stressedNsfr: preview.stressed.risk.riskMetrics.nsfr,
              breachProbability: preview.breachProbability,
            }
          : null,
      }),
    [bankState, parsedActionForm.hasErrors, parsedActionForm.values, preview, simConfig]
  );
  const contextualHelpLinks = tabHelpLinks[activeTab] ?? [];

  const buildStopCondition = (): StopCondition | undefined => {
    if (stopConditionMode === 'none') return undefined;
    if (stopConditionMode === 'scoreTarget') {
      return { kind: 'scoreTarget', scoreTargetPct: 1 };
    }
    if (stopConditionMode === 'nearBreach') {
      return { kind: 'nearBreach', buffer: 0.05 };
    }
    return { kind: 'breach' };
  };

  const milestoneEventsFromPayload = (payload: ReturnType<typeof getScenarioStepPayload>): SimulationEvent[] =>
    payload.milestones.map((milestone) => ({
      id: `milestone-${milestone.id}`,
      severity: milestone.severity,
      message: milestone.message,
      timestamp: Date.now(),
    }));

  const handleRunNextMonth = () => {
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
    const scenarioStep = getScenarioStepPayload({
      scenarioId: activeScenarioId,
      stepNumber: bankState.time.step,
      state: bankState,
      actions,
    });

    controller.setConfig(simConfig);
    const { nextState, events, diagnostics } = controller.step(bankState, actions, scenarioStep.shocks);
    const milestoneEvents = milestoneEventsFromPayload(scenarioStep);

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

  const handleRunMultipleMonths = () => {
    if (parsedActionForm.hasErrors) {
      setEventLog((prev) => [
        ...prev,
        {
          id: `ui-${Date.now()}`,
          severity: 'error',
          message: 'Cannot run autopilot: fix action input validation errors first.',
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    const fixedActions = buildActionsFromParsed(parsedActionForm, actionForm, bankState);
    controller.setConfig(simConfig);
    const stopCondition = buildStopCondition();
    const result = controller.runMonths({
      state: bankState,
      months: runHorizonMonths,
      actions: () => fixedActions,
      shocks: (stateAtStep) =>
        getScenarioStepPayload({
          scenarioId: activeScenarioId,
          stepNumber: stateAtStep.time.step,
          state: stateAtStep,
          actions: fixedActions,
        }).shocks,
      stopCondition,
      scenarioGoals: activeScenario?.goals,
    });

    let milestoneState = bankState;
    const milestoneEvents: SimulationEvent[] = [];
    result.records.forEach((record) => {
      const payload = getScenarioStepPayload({
        scenarioId: activeScenarioId,
        stepNumber: milestoneState.time.step,
        state: milestoneState,
        actions: record.actions,
      });
      milestoneEvents.push(...milestoneEventsFromPayload(payload));
      milestoneState = record.state;
    });

    const stepEvents = result.records.flatMap((record) => record.events);
    const allEvents = [...stepEvents, ...milestoneEvents];
    if (result.stoppedReason) {
      allEvents.push({
        id: `ui-stop-${Date.now()}`,
        severity: 'warning',
        message: `Autopilot stopped due to ${result.stoppedReason}.`,
        timestamp: Date.now(),
      });
    }

    setBankState(result.finalState);
    setStateHistory((prev) => [...prev, ...result.records.map((record) => record.state)]);
    setEventLog((prev) => [...prev, ...allEvents]);
    setLastAttribution(result.records[result.records.length - 1]?.attribution ?? null);
    setHighlightedEventIds([]);
    setSelectedAttributionLine(null);
    setCurrentTimeline((prev) => [...prev, ...result.timeline]);
    setCurrentSnapshots((prev) => [...prev, ...result.snapshots.slice(1)]);
  };

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

  const handleStartScenario = () => {
    if (!selectedScenarioId) return;
    const scenarioConfig = applyScenarioConfig(baseConfig, selectedScenarioId);
    const scenarioState = getScenarioInitialState(selectedScenarioId, scenarioConfig);
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
    setBankState(scenarioState);
    setStateHistory([scenarioState]);
    setEventLog([]);
    setLastAttribution(null);
    setHighlightedEventIds([]);
    setSelectedAttributionLine(null);
    setActiveScenarioId(selectedScenarioId);
    setCurrentTimeline([]);
    setCurrentSnapshots([controller.createSnapshot(scenarioState)]);
    setActionForm({
      retailDepositRate: formatRateInputPct(getGroupDepositRate(scenarioState, 'retail')),
      corporateDepositRate: formatRateInputPct(getGroupDepositRate(scenarioState, 'corporate')),
      mortgageRate: formatRateInputPct(
        scenarioState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)
          ?.interestRate
      ),
      corporateLoanRate: formatRateInputPct(
        scenarioState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CorporateLoans)
          ?.interestRate
      ),
      mortgageUnderwritingTightness:
        (scenarioState.behaviour.underwritingTightness?.[AssetProductType.Mortgages] ?? 0).toString(),
      corporateUnderwritingTightness:
        (scenarioState.behaviour.underwritingTightness?.[AssetProductType.CorporateLoans] ?? 0).toString(),
      issueLTDebtAmount: '',
      issueEquityAmount: '',
      dividendPayoutRatio: (
        scenarioState.behaviour.capitalPolicy?.dividendPayoutRatio ??
        scenarioConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio
      ).toString(),
      at1CouponMode: scenarioState.behaviour.capitalPolicy?.at1CouponMode ?? 'auto',
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

  const competitorCorporateDepositRate =
    bankState.market.competitorCorporateDepositRate ?? bankState.market.competitorRetailDepositRate;

  const applyTutorialSafeSetup = () => {
    setActionForm((prev) => ({
      ...prev,
      retailDepositRate: formatRateInputPct(Math.max(0, bankState.market.competitorRetailDepositRate + 0.001)),
      corporateDepositRate: formatRateInputPct(Math.max(0, competitorCorporateDepositRate + 0.001)),
      mortgageRate: formatRateInputPct(Math.max(0, bankState.market.competitorMortgageRate + 0.003)),
      corporateLoanRate: formatRateInputPct(
        Math.max(0, bankState.market.baseRate + bankState.market.corporateLoanSpread + 0.007)
      ),
      mortgageUnderwritingTightness: '0.55',
      corporateUnderwritingTightness: '0.55',
      issueLTDebtAmount: '',
      issueEquityAmount: '',
      dividendPayoutRatio: '0.10',
      at1CouponMode: 'auto',
      hedgeDirection: 'none',
      hedgeNotional: '',
      hedgeFixedRate: '',
      hedgeMaturityMonths: '24',
    }));
    setActiveTab('Overview');
    setIsActionsOpen(true);
  };

  const applyTutorialRiskSetup = () => {
    setActionForm((prev) => ({
      ...prev,
      retailDepositRate: formatRateInputPct(Math.max(0, bankState.market.competitorRetailDepositRate - 0.012)),
      corporateDepositRate: formatRateInputPct(Math.max(0, competitorCorporateDepositRate - 0.015)),
      mortgageRate: formatRateInputPct(Math.max(0, bankState.market.competitorMortgageRate + 0.015)),
      corporateLoanRate: formatRateInputPct(
        Math.max(0, bankState.market.baseRate + bankState.market.corporateLoanSpread + 0.02)
      ),
      mortgageUnderwritingTightness: '0.10',
      corporateUnderwritingTightness: '0.10',
      issueLTDebtAmount: '',
      issueEquityAmount: '',
      dividendPayoutRatio: '0.70',
      at1CouponMode: 'pay',
      hedgeDirection: 'none',
      hedgeNotional: '',
      hedgeFixedRate: '',
      hedgeMaturityMonths: '24',
    }));
    setTutorialRiskPreparedStep(bankState.time.step);
    setTutorialSawGuardrail(false);
    setTutorialMitigationApplied(false);
    setActiveTab('Overview');
    setIsActionsOpen(true);
  };

  const applyTutorialMitigationSetup = () => {
    setActionForm((prev) => ({
      ...prev,
      retailDepositRate: formatRateInputPct(Math.max(0, bankState.market.competitorRetailDepositRate + 0.001)),
      corporateDepositRate: formatRateInputPct(Math.max(0, competitorCorporateDepositRate + 0.001)),
      mortgageRate: formatRateInputPct(Math.max(0, bankState.market.competitorMortgageRate + 0.004)),
      corporateLoanRate: formatRateInputPct(
        Math.max(0, bankState.market.baseRate + bankState.market.corporateLoanSpread + 0.009)
      ),
      mortgageUnderwritingTightness: '0.70',
      corporateUnderwritingTightness: '0.70',
      issueLTDebtAmount: '1500000000',
      issueEquityAmount: '800000000',
      dividendPayoutRatio: '0.05',
      at1CouponMode: 'auto',
      hedgeDirection: 'none',
      hedgeNotional: '',
      hedgeFixedRate: '',
      hedgeMaturityMonths: '24',
    }));
    setTutorialMitigationApplied(true);
    setActiveTab('Overview');
    setIsActionsOpen(true);
  };

  const tutorialSafeConfigured = useMemo(() => {
    if (parsedActionForm.hasErrors) return false;
    const values = parsedActionForm.values;
    const retail = values.retailDepositRate;
    const corporate = values.corporateDepositRate;
    const mortgage = values.mortgageRate;
    const corporateLoan = values.corporateLoanRate;
    const mortgageUw = values.mortgageUnderwritingTightness;
    const corporateUw = values.corporateUnderwritingTightness;
    const payout = values.dividendPayoutRatio;
    if (
      retail === undefined ||
      corporate === undefined ||
      mortgage === undefined ||
      corporateLoan === undefined ||
      mortgageUw === undefined ||
      corporateUw === undefined ||
      payout === undefined
    ) {
      return false;
    }

    const corporateLoanReference = bankState.market.baseRate + bankState.market.corporateLoanSpread;
    return (
      retail >= bankState.market.competitorRetailDepositRate - 0.001 &&
      retail <= bankState.market.competitorRetailDepositRate + 0.02 &&
      corporate >= competitorCorporateDepositRate - 0.001 &&
      corporate <= competitorCorporateDepositRate + 0.02 &&
      mortgage >= bankState.market.competitorMortgageRate - 0.001 &&
      mortgage <= bankState.market.competitorMortgageRate + 0.02 &&
      corporateLoan <= corporateLoanReference + 0.015 &&
      mortgageUw >= 0.4 &&
      corporateUw >= 0.4 &&
      payout <= 0.2
    );
  }, [bankState.market, competitorCorporateDepositRate, parsedActionForm.hasErrors, parsedActionForm.values]);

  useEffect(() => {
    if (!isTutorialOpen || tutorialStepIndex !== 4) return;
    if (guardrails.length > 0 || eventLog.some((event) => event.severity === 'warning')) {
      setTutorialSawGuardrail(true);
    }
  }, [eventLog, guardrails.length, isTutorialOpen, tutorialStepIndex]);

  const tutorialRunCompleted = tutorialRunAnchorStep !== null && bankState.time.step > tutorialRunAnchorStep;
  const tutorialReviewedDeltas = tutorialRunCompleted && Boolean(lastAttribution) && activeTab === 'Overview';
  const tutorialRiskRunCompleted =
    tutorialRiskPreparedStep !== null && bankState.time.step > tutorialRiskPreparedStep;
  const tutorialMitigationReady = tutorialSawGuardrail && tutorialMitigationApplied;

  const tutorialSteps: TutorialStepView[] = [
    {
      title: 'Set a safe baseline',
      summary: 'Start by applying conservative pricing and underwriting so month 1 is stable.',
      instructions: [
        'Open Actions and set balanced pricing around competitor rates.',
        'Keep underwriting tightness above 0.4 and payout ratio low.',
        'Goal: establish a resilient starting point before experimentation.',
      ],
      ready: tutorialSafeConfigured,
      readinessHint: 'Apply a safe setup first.',
      primaryActionLabel: 'Apply safe setup',
      onPrimaryAction: applyTutorialSafeSetup,
    },
    {
      title: 'Run one month',
      summary: 'Execute one step to generate real metric movement and events.',
      instructions: [
        'Use "Run next month" from the header or Actions drawer.',
        'The tutorial advances once month counter increases by 1.',
      ],
      ready: tutorialRunCompleted,
      readinessHint: 'Run one month to continue.',
      primaryActionLabel: 'Open Actions',
      onPrimaryAction: () => setIsActionsOpen(true),
    },
    {
      title: 'Read CET1 and LCR deltas',
      summary: 'Review why metrics moved before changing strategy.',
      instructions: [
        'Go to Overview and inspect Last step attribution.',
        'Focus on CET1 and LCR lines to understand driver direction.',
      ],
      ready: tutorialReviewedDeltas,
      readinessHint: 'Open Overview after running one month.',
      primaryActionLabel: 'Go to Overview',
      onPrimaryAction: () => setActiveTab('Overview'),
    },
    {
      title: 'Trigger a controlled risky move',
      summary: 'Apply intentionally aggressive settings and run one month to surface risk warnings.',
      instructions: [
        'Apply risky setup from tutorial action.',
        'Run one month and observe how guardrails/events react.',
      ],
      ready: tutorialRiskRunCompleted,
      readinessHint: 'Apply risky setup and run one month.',
      primaryActionLabel: 'Apply risky setup',
      onPrimaryAction: applyTutorialRiskSetup,
    },
    {
      title: 'Mitigate the warning signal',
      summary: 'After seeing warnings, apply stabilizing levers to recover resilience.',
      instructions: [
        'Confirm warnings/guardrails were observed.',
        'Apply mitigation setup to reduce payout risk and add funding/capital support.',
      ],
      ready: tutorialMitigationReady,
      readinessHint: 'Observe warning signal, then apply mitigation setup.',
      primaryActionLabel: 'Apply mitigation setup',
      onPrimaryAction: applyTutorialMitigationSetup,
    },
  ];

  const tutorialStep = tutorialSteps[Math.min(tutorialStepIndex, tutorialSteps.length - 1)];

  const resetTutorialProgress = () => {
    setTutorialStepIndex(0);
    setTutorialRunAnchorStep(null);
    setTutorialRiskPreparedStep(null);
    setTutorialSawGuardrail(false);
    setTutorialMitigationApplied(false);
  };

  const openTutorial = (resetProgress: boolean) => {
    if (resetProgress) {
      resetTutorialProgress();
    }
    setIsTutorialOpen(true);
    setActiveTab('Overview');
  };

  const completeTutorial = () => {
    setTutorialCompleted(true);
    writeTutorialCompleted(true);
    setIsTutorialOpen(false);
    resetTutorialProgress();
    setEventLog((prev) => [
      ...prev,
      {
        id: `ui-tutorial-${Date.now()}`,
        severity: 'info',
        message: 'Tutorial completed. Use "Replay tutorial" from the header any time.',
        timestamp: Date.now(),
      },
    ]);
  };

  const handleTutorialNext = () => {
    if (!tutorialStep.ready) return;
    if (tutorialStepIndex === 0) {
      setTutorialRunAnchorStep(bankState.time.step);
      setIsActionsOpen(true);
    }
    if (tutorialStepIndex === 1) {
      setActiveTab('Overview');
      setIsActionsOpen(false);
    }
    if (tutorialStepIndex === 2) {
      setIsActionsOpen(true);
    }
    if (tutorialStepIndex === 3) {
      setIsActionsOpen(true);
    }
    if (tutorialStepIndex >= tutorialSteps.length - 1) {
      completeTutorial();
      return;
    }
    setTutorialStepIndex((prev) => Math.min(prev + 1, tutorialSteps.length - 1));
  };

  const handleTutorialButton = () => {
    if (tutorialCompleted) {
      openTutorial(true);
      return;
    }
    if (isTutorialOpen) {
      setIsTutorialOpen(false);
      return;
    }
    openTutorial(false);
  };

  const tutorialButtonLabel = tutorialCompleted
    ? 'Replay tutorial'
    : isTutorialOpen
      ? 'Hide tutorial'
      : tutorialStepIndex > 0
        ? 'Resume tutorial'
        : 'Start tutorial';

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-content">
          <div className="eyebrow">Bank strategy lab</div>
          <h1>UK Bank Simulator</h1>
          <div className="hero-pills">
            <span className="pill">Month {bankState.time.step}</span>
            <button className="button small" type="button" onClick={() => setIsActionsOpen(true)}>
              Actions
            </button>
            <button
              className="button primary small"
              type="button"
              onClick={handleRunNextMonth}
              disabled={bankState.status.hasFailed}
            >
              Run next month
            </button>
            <label className="field" style={{ minWidth: 140 }}>
              <span className="muted" style={{ fontSize: 11 }}>Autopilot months</span>
              <select
                value={runHorizonMonths}
                onChange={(e) => setRunHorizonMonths(Number(e.target.value))}
              >
                <option value={1}>1 month</option>
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
              </select>
            </label>
            <label className="field" style={{ minWidth: 170 }}>
              <span className="muted" style={{ fontSize: 11 }}>Stop condition</span>
              <select
                value={stopConditionMode}
                onChange={(e) => setStopConditionMode(e.target.value as typeof stopConditionMode)}
              >
                <option value="none">None</option>
                <option value="nearBreach">Near breach (5%)</option>
                <option value="breach">On breach</option>
                <option value="scoreTarget">On score target</option>
              </select>
            </label>
            <button
              className="button small"
              type="button"
              onClick={handleRunMultipleMonths}
              disabled={bankState.status.hasFailed}
            >
              Run {runHorizonMonths}m
            </button>
            <button className="button ghost small" type="button" onClick={handleSaveCurrentRun}>
              Save run
            </button>
            <button className="button ghost small" type="button" onClick={handleTutorialButton}>
              {tutorialButtonLabel}
            </button>
            <span className={`pill ${bankState.status.hasFailed ? 'danger' : 'success'}`}>
              {bankState.status.hasFailed ? 'Resolution mode' : 'Going concern'}
            </span>
            <span className="pill warning">{activeScenarioId ? `Scenario: ${activeScenarioId}` : 'Sandbox mode'}</span>
          </div>
        </div>
        <div className="hero-side">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>Theme</span>
            <button
              className="button ghost"
              onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
            >
              {theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            </button>
          </div>
          <div className="muted align-right">
            ROE {formatPct(roe)} • NIM {formatPct(nim)}
          </div>
          <div className="hero-pills" style={{ justifyContent: 'flex-end' }}>
            <span className="pill">Assets {formatCurrency(totalAssets)}</span>
            <span className="pill">Equity {formatCurrency(totalEquity)}</span>
          </div>
        </div>
      </header>

      {bankState.status.hasFailed && (
        <div className="alert danger">
          <div style={{ fontWeight: 700 }}>Bank failed or regulatory breach occurred.</div>
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

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              if (tab !== 'Help') {
                setHelpSectionFocus(null);
              }
            }}
            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab !== 'Help' && contextualHelpLinks.length > 0 && (
        <div className="card help-context-strip">
          <div className="muted">Mechanics references</div>
          <div className="help-context-links">
            {contextualHelpLinks.map((link) => (
              <HelpLink
                key={`${activeTab}-${link.sectionId}`}
                label={link.label}
                sectionId={link.sectionId}
                onNavigate={openHelpSection}
              />
            ))}
          </div>
        </div>
      )}

      {activeTab === 'Overview' && (
        <div className="section-grid">
          <div className="card">
            <TopMetricsPanel
              riskMetrics={bankState.risk.riskMetrics}
              config={simConfig}
              gdpGrowthMoM={bankState.market.gdpGrowthMoM}
              inflationRate={bankState.market.inflationRate}
              unemploymentRate={bankState.market.unemploymentRate}
              baseRate={bankState.market.baseRate}
              creditSpread={bankState.market.creditSpread}
              equity={totalEquity}
              assets={totalAssets}
              sharePrice={bankState.equityMarket.sharePrice}
              marketCap={bankState.equityMarket.marketCap}
              epsTtm={bankState.equityMarket.epsTtm}
              peMultiple={bankState.equityMarket.peMultiple}
              roe={roe}
              nim={nim}
              depositFranchiseStrength={bankState.behaviour.depositFranchiseStrength}
              depositFranchiseDeltaMoM={franchiseDeltaMoM}
              onNavigateHelp={openHelpSection}
            />
          </div>
          <ExogenousVariablesPanel market={bankState.market} config={simConfig} />
          {lastAttribution && (
            <div className="card stack">
              <div className="eyebrow">Last step attribution</div>
              <h3>Why metrics moved</h3>
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>CET1 ratio</td>
                    <td className="numeric">{formatSignedPct(lastAttribution.metrics.cet1Ratio.delta)}</td>
                  </tr>
                  <tr>
                    <td>LCR</td>
                    <td className="numeric">{formatSignedPct(lastAttribution.metrics.lcr.delta)}</td>
                  </tr>
                  <tr>
                    <td>NSFR</td>
                    <td className="numeric">{formatSignedPct(lastAttribution.metrics.nsfr.delta)}</td>
                  </tr>
                  <tr>
                    <td>NIM</td>
                    <td className="numeric">{formatSignedPct(lastAttribution.metrics.nim.delta)}</td>
                  </tr>
                  <tr>
                    <td>Top CET1 driver</td>
                    <td className="numeric">
                      {lastAttribution.metrics.cet1Ratio.lines.find(
                        (line) => line.id === lastAttribution.metrics.cet1Ratio.topPositiveDriverId
                      )?.label ?? 'None'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
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
              onStart={handleStartScenario}
              description={scenarios.find((s) => s.id === selectedScenarioId)?.description}
            />
            <div className="card stack">
              <div className="eyebrow">What to expect</div>
              <p className="muted">
                Starting a scenario reloads the bank with tailored settings and scheduled shocks. You can still tweak pricing and
                funding in the Actions panel once the scenario is active.
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
                      <strong>Top drivers:</strong> {scenarioDebrief.topDrivers.join(' | ')}
                    </div>
                  )}
                  {scenarioDebrief.recommendedLevers.length > 0 && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      <strong>Try next:</strong> {scenarioDebrief.recommendedLevers.join(' | ')}
                    </div>
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
      <h2>Regulatory Metrics</h2>
      <RegMetricsPanel
        state={bankState}
        history={stateHistory}
        config={simConfig}
        attribution={lastAttribution}
        onNavigateHelp={openHelpSection}
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
              onNavigateHelp={openHelpSection}
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

      <button
        type="button"
        className={`actions-handle ${isActionsOpen ? 'open' : ''}`}
        onClick={() => setIsActionsOpen(true)}
        aria-haspopup="dialog"
        aria-controls="actions-panel"
        aria-expanded={isActionsOpen}
        aria-hidden={isActionsOpen}
        tabIndex={isActionsOpen ? -1 : 0}
      >
        <span>Actions</span>
      </button>

      <div
        className={`actions-drawer-overlay ${isActionsOpen ? 'open' : ''}`}
        onClick={() => setIsActionsOpen(false)}
        aria-hidden={!isActionsOpen}
      />

      <aside
        id="actions-panel"
        className={`actions-drawer ${isActionsOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal={isActionsOpen ? true : undefined}
        aria-label="Actions panel"
        aria-hidden={!isActionsOpen}
      >
        <div ref={actionsDrawerContentRef} className="actions-drawer-content">
          <div className="actions-drawer-header">
            <div>
              <div className="eyebrow">Actions</div>
              <h2 style={{ marginTop: 6 }}>Next month levers</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                Adjust pricing, raise funding, and run the simulation from one place.
              </p>
            </div>
            <button
              ref={actionsCloseButtonRef}
              className="button icon"
              type="button"
              onClick={() => setIsActionsOpen(false)}
              aria-label="Close actions panel"
            >
              ✕
            </button>
          </div>

          {guardrails.length > 0 && (
            <MechanicGuardrails guardrails={guardrails} onNavigateHelp={openHelpSection} />
          )}

          <div className="card stack">
            <ActionsPanel
              state={actionForm}
              onChange={setActionForm}
              onSubmit={handleRunNextMonth}
              disabled={bankState.status.hasFailed}
              errors={parsedActionForm.errors}
              hasValidationErrors={parsedActionForm.hasErrors}
              recommendations={recommendations}
              onNavigateHelp={openHelpSection}
            />
          </div>
          <div className="card stack">
            <div className="eyebrow">Preview</div>
            <h3>Next-step impact (estimated)</h3>
            {preview ? (
              <table className="data-table">
                <tbody>
                  <tr>
                    <td>CET1 ratio delta</td>
                    <td className="numeric">{formatSignedPct(preview.deltas.cet1Ratio)}</td>
                  </tr>
                  <tr>
                    <td>LCR delta</td>
                    <td className="numeric">{formatSignedPct(preview.deltas.lcr)}</td>
                  </tr>
                  <tr>
                    <td>NSFR delta</td>
                    <td className="numeric">{formatSignedPct(preview.deltas.nsfr)}</td>
                  </tr>
                  <tr>
                    <td>NIM delta</td>
                    <td className="numeric">{formatSignedPct(preview.deltas.nim)}</td>
                  </tr>
                  <tr>
                    <td>Stress CET1 ratio</td>
                    <td className="numeric">{formatPct(preview.stressed.risk.riskMetrics.cet1Ratio)}</td>
                  </tr>
                  <tr>
                    <td>Stress LCR</td>
                    <td className="numeric">{formatPct(preview.stressed.risk.riskMetrics.lcr)}</td>
                  </tr>
                  <tr>
                    <td>Regulatory breach probability</td>
                    <td className="numeric">{formatPct(preview.breachProbability)} ({preview.pathCount} paths)</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="muted">Enter valid inputs to preview next-step impacts.</div>
            )}
          </div>
        </div>
      </aside>

      {tutorialStep && (
        <TutorialOverlay
          visible={isTutorialOpen}
          stepNumber={tutorialStepIndex + 1}
          totalSteps={tutorialSteps.length}
          title={tutorialStep.title}
          summary={tutorialStep.summary}
          instructions={tutorialStep.instructions}
          ready={tutorialStep.ready}
          readinessHint={tutorialStep.readinessHint}
          primaryActionLabel={tutorialStep.primaryActionLabel}
          onPrimaryAction={tutorialStep.onPrimaryAction}
          onPrevious={tutorialStepIndex > 0 ? () => setTutorialStepIndex((prev) => Math.max(0, prev - 1)) : undefined}
          onNext={handleTutorialNext}
          onDismiss={() => setIsTutorialOpen(false)}
          isLastStep={tutorialStepIndex >= tutorialSteps.length - 1}
        />
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
    'retailDepositRate',
    'corporateDepositRate',
    'mortgageRate',
    'corporateLoanRate',
    'hedgeFixedRate',
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
    'mortgageUnderwritingTightness',
    'corporateUnderwritingTightness',
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

  const amountFields: Array<keyof ActionFormState> = ['issueLTDebtAmount', 'issueEquityAmount', 'hedgeNotional'];
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

  if (state.hedgeDirection !== 'none') {
    if ((values.hedgeNotional ?? 0) <= 0) {
      errors.hedgeNotional = 'Hedge notional must be greater than zero';
    }
    if (values.hedgeFixedRate === undefined) {
      errors.hedgeFixedRate = 'Provide a fixed rate for hedge entry';
    }
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

  if (values.retailDepositRate !== undefined) {
    [LiabilityProductType.RetailTransactionalDeposits, LiabilityProductType.RetailSavingsDeposits].forEach(
      (productType) => {
        actions.push({
          type: 'adjustRate',
          productType,
          newRate: values.retailDepositRate!,
        });
      }
    );
  }
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
  if (values.corporateUnderwritingTightness !== undefined) {
    actions.push({
      type: 'setUnderwriting',
      productType: AssetProductType.CorporateLoans,
      tightness: values.corporateUnderwritingTightness,
    });
  }
  if (values.issueLTDebtAmount !== undefined && values.issueLTDebtAmount > 0) {
    actions.push({
      type: 'issueDebt',
      productType: LiabilityProductType.WholesaleFundingLT,
      amount: values.issueLTDebtAmount,
    });
  }
  if (values.issueEquityAmount !== undefined && values.issueEquityAmount > 0) {
    actions.push({
      type: 'issueEquity',
      amount: values.issueEquityAmount,
    });
  }
  const fallbackPayout =
    currentState.behaviour.capitalPolicy?.dividendPayoutRatio ??
    baseConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio;
  const payoutRatio = values.dividendPayoutRatio ?? fallbackPayout;
  actions.push({
    type: 'setCapitalPolicy',
    dividendPayoutRatio: payoutRatio,
    at1CouponMode: formState.at1CouponMode,
  });
  if (
    formState.hedgeDirection !== 'none' &&
    values.hedgeNotional !== undefined &&
    values.hedgeNotional > 0 &&
    values.hedgeFixedRate !== undefined
  ) {
    actions.push({
      type: 'enterHedge',
      direction: formState.hedgeDirection,
      notional: values.hedgeNotional,
      fixedRate: values.hedgeFixedRate,
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
      ? [LiabilityProductType.RetailTransactionalDeposits, LiabilityProductType.RetailSavingsDeposits]
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
      ? state.market.competitorRetailDepositRate
      : state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate;
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
