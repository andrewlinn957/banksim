from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace(path: str, old: str, new: str = "", expected: int | None = 1) -> None:
    text = read(path)
    count = text.count(old)
    if expected is not None and count != expected:
        raise RuntimeError(f"{path}: expected {expected} occurrences, found {count}: {old[:80]!r}")
    write(path, text.replace(old, new))


def sub(path: str, pattern: str, repl: str = "", expected: int | None = 1, flags: int = re.S) -> None:
    text = read(path)
    updated, count = re.subn(pattern, repl, text, flags=flags)
    if expected is not None and count != expected:
        raise RuntimeError(f"{path}: expected {expected} regex matches, found {count}: {pattern[:100]!r}")
    write(path, updated)


def remove_lines(path: str, needles: list[str]) -> None:
    text = read(path)
    lines = text.splitlines(keepends=True)
    for needle in needles:
        matches = [i for i, line in enumerate(lines) if needle in line]
        if not matches:
            raise RuntimeError(f"{path}: no line contains {needle!r}")
        lines = [line for line in lines if needle not in line]
    write(path, "".join(lines))


# --- Domain model ---------------------------------------------------------
sub(
    "src/domain/bankState.ts",
    r"export interface BoardPressureState \{.*?\n\}\n\n",
)
remove_lines(
    "src/domain/bankState.ts",
    [
        "  reputation: number;",
        "  previousNetIncome?: number;",
        "  earningsVolatility?: number;",
        "  conductRiskScore?: number;",
        "  conductEventCooldownMonths?: number;",
        "  conductEventCount?: number;",
        "  cumulativeConductCosts?: number;",
        "  board: BoardPressureState;",
    ],
)

remove_lines(
    "src/domain/risks.ts",
    [
        "  conductRiskScore: number;",
        "  boardPressureScore: number;",
        "  boardPressureVolatility: number;",
        "  boardPressureFranchiseGap: number;",
        "  boardPressureRiskGap: number;",
        "  boardPressurePayoutRestraint: number;",
        "  internalTargetVolatilitySensitivity: number;",
        "  internalTargetConductSensitivity: number;",
        "  boardPressure: BoardPressureLimits;",
    ],
)
sub(
    "src/domain/risks.ts",
    r"export interface BoardPressureLimits \{.*?\n\}\n\n",
)

remove_lines(
    "src/domain/config.ts",
    [
        "  | 'boardPressure'",
        "  | 'conductRisk'",
        "  reputationRunoffSensitivity: number;",
        "  boardPressure?: BoardPressureParameters;",
        "  conductRisk?: ConductRiskParameters;",
    ],
)
sub(
    "src/domain/config.ts",
    r"export interface BoardPressureParameters \{.*?\n\}\n\n",
)
sub(
    "src/domain/config.ts",
    r"export interface ConductRiskParameters \{.*?\n\}\n\n",
)

remove_lines("src/domain/pnl.ts", ["  conductCosts: number;"])

# --- Base configuration ---------------------------------------------------
remove_lines(
    "src/config/baseConfig.ts",
    [
        "    internalTargetVolatilitySensitivity: 0.004,",
        "    internalTargetConductSensitivity: 0.003,",
        "    reputationRunoffSensitivity: 0.25,",
        "  boardPressure: true,",
        "  conductRisk: true,",
    ],
)
sub(
    "src/config/baseConfig.ts",
    r"  boardPressure: \{\n    earningsVolatilityTolerance:.*?\n  \},\n",
)
sub(
    "src/config/baseConfig.ts",
    r"  boardPressure: \{\n    earningsVolatilitySmoothing:.*?\n  \},\n  confidenceStateMachine:",
    "  confidenceStateMachine:",
)
sub(
    "src/config/baseConfig.ts",
    r"  conductRisk: \{.*?\n  \},\n  sharePriceModel:",
    "  sharePriceModel:",
)

# --- Opening state --------------------------------------------------------
remove_lines(
    "src/config/initialState.ts",
    [
        "  BoardPressureState,",
        "  conductCosts: 0,",
        "  conductRiskScore: 0,",
        "  boardPressureScore: 0,",
        "  boardPressureVolatility: 0,",
        "  boardPressureFranchiseGap: 0,",
        "  boardPressureRiskGap: 0,",
        "  boardPressurePayoutRestraint: 0,",
        "  reputation: 0.84,",
        "  previousNetIncome: 0,",
        "  earningsVolatility: 0,",
        "  conductEventCooldownMonths: 0,",
        "  conductEventCount: 0,",
        "  cumulativeConductCosts: 0,",
        "  board,",
        "    conductRiskScore: riskMetrics.conductRiskScore,",
        "    conductEventCooldownMonths: 0,",
        "    conductEventCount: 0,",
        "    cumulativeConductCosts: 0,",
    ],
)
sub(
    "src/config/initialState.ts",
    r"const board: BoardPressureState = \{.*?\n\};\n\n",
)
sub(
    "src/config/initialState.ts",
    r"\n  board: \{\n    score: riskMetrics\.boardPressureScore,.*?\n  \},",
    "",
)

# --- Feature flags --------------------------------------------------------
remove_lines(
    "src/engine/featureFlags.ts",
    [
        "  boardPressure: true,",
        "  conductRisk: true,",
    ],
)
sub(
    "src/engine/featureFlags.ts",
    r"      boardPressure: flags\.boardPressure.*?\n      confidenceStateMachine:",
    "      confidenceStateMachine:",
)
sub(
    "src/engine/featureFlags.ts",
    r"      conductRisk: flags\.conductRisk \? config\.behaviour\.conductRisk : undefined,\n",
)
sub(
    "src/engine/featureFlags.ts",
    r"      boardPressure: flags\.boardPressure.*?\n    \},",
    "    },",
)

# --- Risk metrics ---------------------------------------------------------
remove_lines(
    "src/engine/metrics.ts",
    [
        "  const reputationPenalty = Math.max(0, 1 - clamp(state.behaviour.reputation, 0, 1));",
        "    reputationPenalty * (p.reputationRunoffSensitivity ?? 0) +",
        "  const boardLimits = args.config.riskLimits.boardPressure;",
        "  const conductSignal = clamp(args.state.behaviour.conductRiskScore ?? 0, 0, 2);",
        "    volatilitySignal * Math.max(0, limits.internalTargetVolatilitySensitivity ?? 0) +",
        "    conductSignal * Math.max(0, limits.internalTargetConductSensitivity ?? 0);",
        "  const conductRiskScore = clamp(state.behaviour.conductRiskScore ?? 0, 0, 2);",
        "    conductRiskScore,",
        "    boardPressureScore,",
        "    boardPressureVolatility,",
        "    boardPressureFranchiseGap,",
        "    boardPressureRiskGap,",
        "    boardPressurePayoutRestraint,",
    ],
)
sub(
    "src/engine/metrics.ts",
    r"  const volatilitySignal = clamp\(\n    \(args\.state\.behaviour\.earningsVolatility \?\? 0\) / Math\.max\(1, boardLimits\.earningsVolatilityTolerance\),\n    0,\n    3\n  \);\n",
)
replace(
    "src/engine/metrics.ts",
    "    confidenceSignal * Math.max(0, limits.internalTargetConfidenceSensitivity ?? 0) +\n",
    "    confidenceSignal * Math.max(0, limits.internalTargetConfidenceSensitivity ?? 0);\n",
)
sub(
    "src/engine/metrics.ts",
    r"const computeBoardPressureMetrics = \(.*?\n\};\n\nconst computeFundingConfidenceMetrics",
    "const computeFundingConfidenceMetrics",
)
sub(
    "src/engine/metrics.ts",
    r"  const \{\n    boardPressureScore,\n    boardPressureVolatility,\n    boardPressureFranchiseGap,\n    boardPressureRiskGap,\n    boardPressurePayoutRestraint,\n  \} = computeBoardPressureMetrics\(state, config\.riskLimits, config, cet1Headroom, maxPayoutRatio\);\n",
)

# --- Simulation engine ----------------------------------------------------
sub(
    "src/engine/simulation.ts",
    r"interface ConductRiskStepResult \{.*?\n\};\n\nconst applyDepositMixMigration",
    "const applyDepositMixMigration",
)
replace(
    "src/engine/simulation.ts",
    "  // product line cannot multiply the speed of reputation damage or recovery.\n",
    "  // product line cannot multiply the speed of franchise damage or recovery.\n",
)
remove_lines(
    "src/engine/simulation.ts",
    [
        "  conductCosts: number;",
        "  conductCosts: number,",
        "  const effectiveConductCosts = Math.max(0, conductCosts);",
        "    conductCosts: effectiveConductCosts,",
        "  const smoothing = clamp(config.behaviour.boardPressure?.earningsVolatilitySmoothing ?? 0.75, 0, 0.99);",
        "  const previousNetIncome = state.behaviour.previousNetIncome ?? netIncome;",
        "  const incomeDelta = Math.abs(netIncome - previousNetIncome);",
        "  const priorVol = state.behaviour.earningsVolatility ?? incomeDelta;",
        "  state.behaviour.earningsVolatility = priorVol * smoothing + incomeDelta * (1 - smoothing);",
        "  state.behaviour.previousNetIncome = netIncome;",
        "  state.behaviour.conductRiskScore = metrics.conductRiskScore;",
        "      conductStep.conductCosts,",
    ],
)
replace(
    "src/engine/simulation.ts",
    "  const operatingExpenses = fixedOperatingCosts + servicingCosts + originationCosts + workoutCosts + effectiveConductCosts;",
    "  const operatingExpenses = fixedOperatingCosts + servicingCosts + originationCosts + workoutCosts;",
)
sub(
    "src/engine/simulation.ts",
    r"      `Cost split: fixed \$\{fixedOperatingCosts\.toFixed\(2\)\}, servicing \$\{servicingCosts\.toFixed\(\n        2\n      \)\}, origination \$\{originationCosts\.toFixed\(2\)\}, workout \$\{workoutCosts\.toFixed\(2\)\}, conduct \$\{effectiveConductCosts\.toFixed\(2\)\}`",
    "      `Cost split: fixed ${fixedOperatingCosts.toFixed(2)}, servicing ${servicingCosts.toFixed(\n        2\n      )}, origination ${originationCosts.toFixed(2)}, workout ${workoutCosts.toFixed(2)}`",
)
sub(
    "src/engine/simulation.ts",
    r"  state\.board = \{\n    score: metrics\.boardPressureScore,.*?\n  \};\n",
)
sub(
    "src/engine/simulation.ts",
    r"    const conductStep = featureFlags\.conductRisk.*?\n    if \(conductStep\.conductCosts > 0\) \{.*?\n    \}\n",
)

# --- UI / scenario plumbing ----------------------------------------------
remove_lines(
    "src/components/AccountsPanel.tsx",
    ["    { id: 'conductCosts', label: 'Conduct costs', selector: (s) => s.financial.incomeStatement.conductCosts },"],
)
remove_lines(
    "src/components/CostsPanel.tsx",
    ["          <Row label=\"Conduct costs\" value={formatCurrency(income.conductCosts)} />"],
)
sub(
    "src/components/TopMetricsPanel.tsx",
    r"        <Metric\n          label=\"Board Pressure\".*?\n        />\n",
)
sub(
    "src/App.tsx",
    r"    scenarioState\.board = \{\n      score: metrics\.boardPressureScore,.*?\n    \};\n",
)
sub(
    "src/config/scenarios.ts",
    r"  state\.board = \{\n    score: state\.risk\.riskMetrics\.boardPressureScore,.*?\n  \};\n",
)

# --- Recommendations ------------------------------------------------------
remove_lines(
    "src/engine/recommendations.ts",
    [
        "    boardPressureDelta: number;",
        "        boardPressureDelta: after.boardPressureScore - baseline.boardPressureScore,",
        "      const boardBenefit = Math.max(0, -projected.boardPressureDelta) / 100;",
        "        boardBenefit * 0.5 -",
    ],
)
replace(
    "src/engine/recommendations.ts",
    "      caveat: 'Lower payout may increase board pressure from investors.',",
    "      caveat: 'Lower payout may weigh on shareholder sentiment.',",
)

# --- Tests ---------------------------------------------------------------
for doomed in [
    "src/engine/boardPressure.test.ts",
    "src/engine/conductRisk.test.ts",
]:
    (ROOT / doomed).unlink()

remove_lines(
    "src/engine/confidenceStateMachine.test.ts",
    [
        "    stressed.behaviour.reputation = 0.35;",
        "    recovering.behaviour.reputation = 0.96;",
    ],
)
remove_lines(
    "src/engine/liquidityDynamics.test.ts",
    [
        "    benign.behaviour.reputation = 0.9;",
        "    stressed.behaviour.reputation = 0.25;",
    ],
)
remove_lines(
    "src/engine/simulationCorrectness.test.ts",
    [
        "    stressed.behaviour.earningsVolatility = 0.8e9;",
        "    stressed.behaviour.reputation = 0.45;",
        "    stressed.behaviour.conductRiskScore = 1.4;",
    ],
)
remove_lines(
    "src/engine/internalCapitalTarget.test.ts",
    [
        "    config.riskLimits.capitalPolicy.internalTargetVolatilitySensitivity = .02;",
        "    benignState.behaviour.earningsVolatility = 0.05e9;",
        "    benignState.behaviour.reputation = 0.9;",
        "    benignState.behaviour.conductRiskScore = 0;",
        "    stressedState.behaviour.earningsVolatility = 0.8e9;",
        "    stressedState.behaviour.reputation = 0.45;",
        "    stressedState.behaviour.conductRiskScore = 1.6;",
        "    expect(stressed.board.score).toBeGreaterThan(benign.board.score);",
    ],
)
replace(
    "src/engine/internalCapitalTarget.test.ts",
    "it('clips distributions earlier when volatility/stress are high, before MDA breach'",
    "it('clips distributions earlier when funding stress and confidence are weak, before MDA breach'",
)
replace(
    "src/engine/internalCapitalTarget.test.ts",
    "    // larger dynamic buffer created by volatility, confidence and conduct signals.\n",
    "    // larger dynamic buffer created by funding stress and confidence signals.\n",
)
remove_lines("src/engine/fundingLadder.test.ts", ["      conductRisk: false,"])
remove_lines("src/engine/tier2Requirement.test.ts", ["    conductRisk: false,"])

# --- Help content / documentation ----------------------------------------
replace(
    "src/content/mechanicsRegistry.ts",
    "      'Retail current accounts balances respond to the price gap, franchise strength, and reputation.',",
    "      'Retail current accounts balances respond to the price gap and franchise strength.',",
)
replace(
    "src/content/mechanicsRegistry.ts",
    "      'Weak franchise strength and weak reputation can increase deposit runoff in stress.',",
    "      'Weak franchise strength and poor deposit quality can increase deposit runoff in stress.',",
)
sub(
    "src/content/mechanicsRegistry.ts",
    r"  \{\n    id: 'board-pressure',.*?\n  \},\n  \{\n    id: 'conduct-risk',.*?\n  \},\n",
    "  {\n    id: 'risk-appetite',\n    category: 'Risk Measures',\n    title: 'Risk appetite',\n    plainDescription:\n      'Risk appetite sets internal targets for CET1, leverage, LCR, and NSFR.',\n    whyItMatters:\n      'An internal target is not the same as a regulatory minimum. A higher target gives more safety but can restrict payout or growth sooner.',\n    driverSummary: [\n      'Management chooses the bank\'s internal prudential targets.',\n      'The game still enforces the regulatory floors underneath those targets.',\n      'Internal CET1 headroom can restrict distributions before MDA is triggered.',\n      'Risk appetite changes the point at which the game treats a position as too close to the limit.',\n    ],\n    relatedMetrics: [metric('Internal CET1 headroom'), metric('Risk appetite')],\n  },\n",
)

replace(
    "player_guide.md",
    "- Behavioral state (franchise, reputation, underwriting, confidence, conduct)",
    "- Behavioral state (deposit franchise, underwriting, funding confidence)",
)
# Remove short conduct/reputation bullets without trying to rewrite unrelated banking prose.
text = read("player_guide.md")
text = re.sub(r"^.*franchise and reputation are hit.*\n", "", text, flags=re.M)
text = re.sub(r"^.*reputation weakness.*\n", "", text, flags=re.M)
write("player_guide.md", text)

# The career-pacing note describes the deposit-franchise mechanic, not a separate reputation state.
replace(
    "docs/career-pacing.md",
    "Product segmentation therefore cannot multiply reputational damage; persistent underpricing still erodes franchise and customer balances.",
    "Product segmentation therefore cannot multiply franchise damage; persistent underpricing still erodes franchise and customer balances.",
)

# --- Final source-level guard --------------------------------------------
for path in ROOT.glob("src/**/*"):
    if not path.is_file() or path.suffix not in {".ts", ".tsx"}:
        continue
    text = path.read_text()
    banned = [
        "BoardPressure",
        "boardPressure",
        "conductRisk",
        "ConductRisk",
        "conductEvent",
        "conductCosts",
        "cumulativeConductCosts",
        "reputationRunoffSensitivity",
        "internalTargetConductSensitivity",
        "internalTargetVolatilitySensitivity",
        "earningsVolatility",
        "previousNetIncome",
        "behaviour.reputation",
        "state.board",
        ".board.score",
    ]
    hits = [needle for needle in banned if needle in text]
    if hits:
        raise RuntimeError(f"{path.relative_to(ROOT)} still contains removed soft-state identifiers: {hits}")

print("Low-value conduct/reputation and board-pressure mechanics removed.")
