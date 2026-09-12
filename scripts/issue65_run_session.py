from pathlib import Path

path = Path('src/App.tsx')
text = path.read_text()

text = text.replace("import { ActionTimelineEntry, RunRecord, RunSnapshot } from './domain/runHistory';\n", "", 1)
text = text.replace("import { prepareScenarioSession } from './ui/scenarioSession';", "import { prepareScenarioSession } from './ui/scenarioSession';\nimport { useRunSession } from './ui/useRunSession';", 1)

old = """  const [savedRuns, setSavedRuns] = useState<RunRecord[]>([]);
  const [currentTimeline, setCurrentTimeline] = useState<ActionTimelineEntry[]>([]);
  const [currentSnapshots, setCurrentSnapshots] = useState<RunSnapshot[]>([
    controller.createSnapshot(initialState),
  ]);
  const [runCounter, setRunCounter] = useState(1);"""
new = """  const runSession = useRunSession(controller, initialState);
  const { savedRuns, currentTimeline, currentSnapshots } = runSession;"""
if old not in text: raise SystemExit('Missing run session state block')
text = text.replace(old, new, 1)

old = "setSimConfig(nextConfig); setBankState(nextState); setStateHistory([nextState]); setCurrentSnapshots([controller.createSnapshot(nextState)]);"
new = "setSimConfig(nextConfig); setBankState(nextState); setStateHistory([nextState]); runSession.reset(nextState);"
if old not in text: raise SystemExit('Missing three-year-plan snapshot reset')
text = text.replace(old, new, 1)

old = """    setCurrentTimeline((prev) => [
      ...prev,
      { step: nextState.time.step, actions: actions.map((a) => ({ ...a })), shocks: scenarioStep.shocks.map((s) => ({ ...s })) },
    ]);
    setCurrentSnapshots((prev) => [...prev, controller.createSnapshot(nextState)]);"""
new = "    runSession.appendStep(nextState, actions, scenarioStep.shocks);"
if old not in text: raise SystemExit('Missing timeline append block')
text = text.replace(old, new, 1)

old = """  const handleSaveCurrentRun = () => {
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
    setRunCounter((prev) => prev + 1);"""
new = """  const handleSaveCurrentRun = () => {
    const record = runSession.saveCurrent({
      scenarioId: activeScenarioId,
      initialState: stateHistory[0],
      finalState: bankState,
    });
    if (!record) return;"""
if old not in text: raise SystemExit('Missing save-run block')
text = text.replace(old, new, 1)

old = """    setActiveScenarioId(scenarioId);
    setCurrentTimeline([]);
    setCurrentSnapshots([controller.createSnapshot(scenarioState)]);
    setActionForm(prepared.actionForm);"""
new = """    setActiveScenarioId(scenarioId);
    runSession.reset(scenarioState);
    setActionForm(prepared.actionForm);"""
if old not in text: raise SystemExit('Missing scenario run-session reset')
text = text.replace(old, new, 1)

path.write_text(text)
