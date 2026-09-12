from pathlib import Path

path = Path('src/App.tsx')
text = path.read_text()

replacements = [
    ("import { attentionReason, clockAfterStep, monthsToPeriodEnd } from './game/management';", "import { attentionReason, monthsToPeriodEnd } from './game/management';"),
    ("import { useEffect, useMemo, useState } from 'react';", "import { useEffect, useMemo, useRef, useState } from 'react';"),
    ("  getScenarioInitialState,\n  getScenarioStepPayload,\n  scenarios,\n  applyScenarioConfig,\n  Scenario,", "  getScenarioStepPayload,\n  scenarios,\n  Scenario,"),
    ("import { calculateRiskMetrics, evaluateCompliance } from './engine/metrics';\n", ""),
    ("import { createActionFormState, clearOneOffTransactions } from './ui/actionFormState';", "import { createActionFormState, clearOneOffTransactions } from './ui/actionFormState';\nimport { useSimulationClock } from './ui/useSimulationClock';\nimport { prepareScenarioSession } from './ui/scenarioSession';"),
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Missing import target: {old[:80]}')
    text = text.replace(old, new, 1)

old = """  const [actionForm, setActionForm] = useState<ActionFormState>(() => createActionFormState(initialState, baseConfig));
  const [lastAttribution, setLastAttribution] = useState<StepAttribution | null>(null);"""
new = """  const [actionForm, setActionForm] = useState<ActionFormState>(() => createActionFormState(initialState, baseConfig));
  const parsedActionForm = useMemo(() => parseActionFormInputs(actionForm), [actionForm]);
  const clockTickRef = useRef<() => void>(() => {});
  const clock = useSimulationClock({
    canRun: !bankState.status.hasFailed && !parsedActionForm.hasErrors,
    onTick: () => clockTickRef.current(),
  });
  const { autoRemaining, clockRunning, clockSpeed, setClockSpeed, pauseReason, safetyPause, setSafetyPause } = clock;
  const [lastAttribution, setLastAttribution] = useState<StepAttribution | null>(null);"""
if old not in text: raise SystemExit('Missing action form state target')
text = text.replace(old, new, 1)

old = """  const [autoRemaining, setAutoRemaining] = useState<number | null>(null);
  const [clockSpeed, setClockSpeed] = useState(1500);
  const [pauseReason, setPauseReason] = useState('Ready. Set your policy, then run a quarter.');
  const [safetyPause, setSafetyPause] = useState(true);
  const clockRunning = autoRemaining !== null;
"""
if old not in text: raise SystemExit('Missing clock state target')
text = text.replace(old, '', 1)

text = text.replace("  const openDepartment = (department: Department) => { setAutoRemaining(null); setPauseReason('Paused for a policy decision.');", "  const openDepartment = (department: Department) => { clock.stop('Paused for a policy decision.');", 1)
text = text.replace("  const goToBoardroom = () => { setAutoRemaining(null);", "  const goToBoardroom = () => { clock.stop();", 1)
text = text.replace("  const startClock = (months: number) => { if (bankState.status.hasFailed || parsedActionForm.hasErrors) return; setPauseReason(''); setAutoRemaining(months); };\n  const pauseClock = () => { setAutoRemaining(null); setPauseReason('Paused. Your policies remain in force.'); };", "  const startClock = (months: number) => clock.start(months);\n  const pauseClock = () => clock.pause();", 1)

old = "  const parsedActionForm = useMemo(() => parseActionFormInputs(actionForm), [actionForm]);\n"
if text.count(old) != 1: raise SystemExit(f'Expected one later parsed action form, got {text.count(old)}')
text = text.replace(old, '', 1)

text = text.replace("    if (!automatic) setAutoRemaining(null);", "    if (!automatic) clock.stop();", 1)
old = """    if (automatic) {
      const clock = clockAfterStep(autoRemaining, nextState, simConfig, safetyPause);
      setAutoRemaining(clock.remaining);
      setPauseReason(clock.reason);
    } else setPauseReason('Month closed. Review the position or continue your strategy.');"""
new = """    if (automatic) clock.afterAutomaticStep(nextState, simConfig);
    else clock.afterManualStep();"""
if old not in text: raise SystemExit('Missing after-step clock target')
text = text.replace(old, new, 1)

old = """  useEffect(() => {
    if (!clockRunning || bankState.status.hasFailed || parsedActionForm.hasErrors ) return;
    const timer = window.setTimeout(() => handleRunNextMonth(true), clockSpeed);
    return () => window.clearTimeout(timer);
  }, [autoRemaining, bankState, actionForm, simConfig, activeScenarioId, clockSpeed, safetyPause, isActionsOpen, parsedActionForm.hasErrors, pendingRiskAppetite]);

  // Leave the bank paused when returning from another tab or opening a modal.
  useEffect(() => {
    const hide = () => { if (document.hidden) pauseClock(); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  useEffect(() => { if (isActionsOpen) { setAutoRemaining(null); setActiveTab('Boardroom'); } }, [isActionsOpen]);"""
new = """  clockTickRef.current = () => handleRunNextMonth(true);

  // Opening a department is a deliberate policy-decision pause; timer/visibility coordination lives in useSimulationClock.
  useEffect(() => { if (isActionsOpen) { clock.stop(); setActiveTab('Boardroom'); } }, [isActionsOpen, clock.stop]);"""
if old not in text: raise SystemExit('Missing clock effects target')
text = text.replace(old, new, 1)

old = """    setAutoRemaining(null);
    setPauseReason('New bank ready. Set a policy and give it time.');
    setActiveTab('Boardroom');
    setIsActionsOpen(false);
    const scenarioConfig = applyScenarioConfig(baseConfig, scenarioId);
    const scenarioState = getScenarioInitialState(scenarioId, scenarioConfig);
    const metrics = calculateRiskMetrics({ state: scenarioState, config: scenarioConfig });
    scenarioState.risk.riskMetrics = metrics;
    scenarioState.risk.compliance = evaluateCompliance(metrics, scenarioConfig.riskLimits);"""
new = """    clock.reset();
    setActiveTab('Boardroom');
    setIsActionsOpen(false);
    const prepared = prepareScenarioSession(scenarioId);
    const scenarioConfig = prepared.config;
    const scenarioState = prepared.state;"""
if old not in text: raise SystemExit('Missing scenario reset target')
text = text.replace(old, new, 1)
text = text.replace("    setActionForm(createActionFormState(scenarioState, scenarioConfig));", "    setActionForm(prepared.actionForm);", 1)

path.write_text(text)
