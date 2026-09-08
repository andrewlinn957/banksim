from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'Missing expected source for {label}')
    return text.replace(old, new, 1)


app_path = Path('src/App.tsx')
app = app_path.read_text()

for line, label in [
    ("import { buildPreRunGuardrails } from './content/guardrails';\n", 'guardrail import'),
    ("import TutorialOverlay from './components/TutorialOverlay';\n", 'tutorial overlay import'),
    ("import { readTutorialCompleted, writeTutorialCompleted } from './content/tutorialState';\n", 'tutorial state import'),
]:
    app = replace_once(app, line, '', label)

app, count = re.subn(
    r"\ninterface TutorialStepView \{.*?\n\}\n",
    "\n",
    app,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove TutorialStepView')

app = replace_once(
    app,
    "  const startClock = (months: number) => { if (bankState.status.hasFailed || parsedActionForm.hasErrors || isTutorialOpen) return; setPauseReason(''); setAutoRemaining(months); };",
    "  const startClock = (months: number) => { if (bankState.status.hasFailed || parsedActionForm.hasErrors) return; setPauseReason(''); setAutoRemaining(months); };",
    'start clock tutorial guard',
)

app, count = re.subn(
    r"\n  const \[tutorialCompleted, setTutorialCompleted\].*?\n  const \[tutorialMitigationApplied, setTutorialMitigationApplied\] = useState\(false\);\n",
    "\n",
    app,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove tutorial state hooks')

app = replace_once(
    app,
    "    if (parsedActionForm.hasErrors || clockRunning || (!(isActionsOpen && activeTab==='Boardroom') && !isTutorialOpen)) return null;",
    "    if (parsedActionForm.hasErrors || clockRunning || !(isActionsOpen && activeTab==='Boardroom')) return null;",
    'preview tutorial condition',
)
app = replace_once(
    app,
    "  }, [activeScenarioId, actionForm, bankState, parsedActionForm, simConfig, isActionsOpen, isTutorialOpen, activeTab, clockRunning, pendingRiskAppetite]);",
    "  }, [activeScenarioId, actionForm, bankState, parsedActionForm, simConfig, isActionsOpen, activeTab, clockRunning, pendingRiskAppetite]);",
    'preview dependencies',
)

app, count = re.subn(
    r"\n  const guardrails = useMemo\(.*?\n  \);\n\n(?=  const milestoneEventsFromPayload)",
    "\n",
    app,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove tutorial-only guardrail calculation')

app = replace_once(
    app,
    "    if (!clockRunning || isTutorialOpen || bankState.status.hasFailed || parsedActionForm.hasErrors) return;",
    "    if (!clockRunning || bankState.status.hasFailed || parsedActionForm.hasErrors) return;",
    'clock tutorial guard',
)
app = replace_once(
    app,
    "  }, [autoRemaining, bankState, actionForm, simConfig, activeScenarioId, clockSpeed, safetyPause, isActionsOpen, isTutorialOpen, parsedActionForm.hasErrors, pendingRiskAppetite]);",
    "  }, [autoRemaining, bankState, actionForm, simConfig, activeScenarioId, clockSpeed, safetyPause, isActionsOpen, parsedActionForm.hasErrors, pendingRiskAppetite]);",
    'clock dependencies',
)
app = replace_once(
    app,
    "  useEffect(() => { if (isTutorialOpen) setAutoRemaining(null); }, [isTutorialOpen]);\n",
    '',
    'tutorial pause effect',
)

app, count = re.subn(
    r"\n  const competitorCorporateDepositRate =.*?\n  return \(",
    "\n\n  return (",
    app,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove tutorial setup and progression block')

menu_button = '<button className="button" onClick={handleTutorialButton}>{tutorialButtonLabel}</button>'
app = replace_once(app, menu_button, '', 'Game menu tutorial button')

app = replace_once(
    app,
    'disabled={bankState.status.hasFailed||parsedActionForm.hasErrors||clockRunning||isTutorialOpen}',
    'disabled={bankState.status.hasFailed||parsedActionForm.hasErrors||clockRunning}',
    'run button tutorial guard',
)

app, count = re.subn(
    r"\n      \{tutorialStep && \(\n        <TutorialOverlay.*?\n      \)\}\n",
    "\n",
    app,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove TutorialOverlay rendering')

app_path.write_text(app)

styles_path = Path('src/styles.css')
styles = styles_path.read_text()
styles, count = re.subn(
    r"\n\.tutorial-overlay \{.*?\n\.tutorial-actions \{.*?\n\}\n",
    "\n",
    styles,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove tutorial styles')
styles, count = re.subn(
    r"\n  \.tutorial-overlay \{.*?\n  \}\n",
    "\n",
    styles,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError('Could not remove tutorial mobile styles')
styles_path.write_text(styles)

surface_path = Path('src/ui/managementSurface.test.tsx')
surface = surface_path.read_text()
surface = replace_once(
    surface,
    " expect(html).not.toContain('Your story starts here.');expect(html).not.toContain('actions-drawer');",
    " expect(html.toLowerCase()).not.toContain('tutorial');expect(html).not.toContain('Your story starts here.');expect(html).not.toContain('actions-drawer');",
    'management surface tutorial regression',
)
surface_path.write_text(surface)

for path in [
    Path('src/components/TutorialOverlay.tsx'),
    Path('src/content/tutorialState.ts'),
    Path('src/content/tutorialState.test.ts'),
]:
    if not path.exists():
        raise RuntimeError(f'Missing expected tutorial file: {path}')
    path.unlink()
