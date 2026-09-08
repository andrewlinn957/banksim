from pathlib import Path
import re


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new))


def regex_replace(path: str, pattern: str, repl: str, count: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    out, n = re.subn(pattern, repl, text, count=count, flags=re.S)
    if n != count:
        raise SystemExit(f"expected {count} regex replacements in {path}, got {n}: {pattern[:160]!r}")
    p.write_text(out)


# Domain state and metric types.
replace(
    "src/domain/risks.ts",
    "export interface RiskMetrics {\n",
    """export type OsiiScopeRoute = 'belowCoreDepositThreshold' | 'largeDomesticBank' | 'ringFencedBankProxy';

export interface OsiiQuarterEndObservation {
  step: number;
  date: string;
  ukLeverageExposure: number;
}

export interface OsiiAssessmentState {
  /** O-SII rate fixed at the latest annual BankSim rate-setting review. */
  assessedRate: number;
  assessmentStep: number;
  nextAssessmentStep: number;
  effectiveYear: number;
  averageQuarterEndUkLeverageExposure: number;
  inScopeAtAssessment: boolean;
  scopeRouteAtAssessment: OsiiScopeRoute;
  quarterEndObservations: OsiiQuarterEndObservation[];
}

export interface RiskMetrics {
""",
)
replace(
    "src/domain/risks.ts",
    "  pillar2ANextAssessmentStep?: number;\n",
    """  pillar2ANextAssessmentStep?: number;
  capitalConservationBufferRate?: number;
  countercyclicalBufferRate?: number;
  ukCountercyclicalBufferRate?: number;
  ukRelevantCreditRwaShare?: number;
  osiiBufferRate?: number;
  combinedBufferRate?: number;
  osiiInScope?: boolean;
  osiiScopeRoute?: OsiiScopeRoute;
  osiiCoreDeposits?: number;
  osiiTradingAssets?: number;
  osiiTradingAssetsToTier1?: number;
  osiiCurrentUkLeverageExposure?: number;
  osiiTrailingAverageUkLeverageExposure?: number;
  osiiAssessedAverageUkLeverageExposure?: number;
  osiiNextThreshold?: number;
  osiiNextThresholdRate?: number;
  osiiNextAssessmentStep?: number;
  osiiThresholdScheduleYear?: number;
""",
)
replace(
    "src/domain/risks.ts",
    "  systemicBuffer: number;\n",
    "  /** Legacy/manual systemic-buffer floor; calculated O-SII is otherwise supplied by the engine. */\n  systemicBuffer: number;\n",
)
replace(
    "src/domain/bankState.ts",
    "import { ComplianceStatus, RiskMetrics, CapitalState, FundingConfidenceState, Pillar2AAssessmentState } from './risks';",
    "import { ComplianceStatus, RiskMetrics, CapitalState, FundingConfidenceState, Pillar2AAssessmentState, OsiiAssessmentState } from './risks';",
)
replace(
    "src/domain/bankState.ts",
    "  pillar2A?: Pillar2AAssessmentState;\n",
    "  pillar2A?: Pillar2AAssessmentState;\n  osii?: OsiiAssessmentState;\n",
)
replace(
    "src/engine/clone.ts",
    "import { ComplianceStatus, Pillar2AAssessmentState, RiskMetrics } from '../domain/risks';",
    "import { ComplianceStatus, OsiiAssessmentState, Pillar2AAssessmentState, RiskMetrics } from '../domain/risks';",
)
replace(
    "src/engine/clone.ts",
    "const cloneBehaviour = (b: BehaviouralState): BehaviouralState => ({",
    """const cloneOsii = (o: OsiiAssessmentState | undefined): OsiiAssessmentState | undefined =>
  o ? { ...o, quarterEndObservations: o.quarterEndObservations.map((x) => ({ ...x })) } : undefined;

const cloneBehaviour = (b: BehaviouralState): BehaviouralState => ({""",
)
replace(
    "src/engine/clone.ts",
    "    pillar2A: clonePillar2A(state.risk.pillar2A),\n",
    "    pillar2A: clonePillar2A(state.risk.pillar2A),\n    osii: cloneOsii(state.risk.osii),\n",
)

# Dedicated capital-buffer engine.
Path("src/engine/capitalBuffers.ts").write_text(r'''import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType, BalanceSheetSide, ProductType } from '../domain/enums';
import { OsiiAssessmentState, OsiiScopeRoute } from '../domain/risks';
import { hasCapability } from '../products/capabilities';
import { regulatoryRiskWeight } from '../products/regulatory';
import { hedgeExposures } from './hedgeValuation';
import { committedExposure, eligibleCet1 } from './prudential';

const CORE_DEPOSIT_SCOPE_THRESHOLD = 35e9;
const LOW_TRADING_THRESHOLD = 0.10;
const OSII_ASSESSMENT_INTERVAL_MONTHS = 12;

export interface OsiiThresholdBucket {
  lowerBound: number;
  rate: number;
}

export const osiiThresholdsForYear = (effectiveYear: number): { year: number; buckets: OsiiThresholdBucket[] } => {
  if (effectiveYear <= 2026) {
    return {
      year: 2026,
      buckets: [
        { lowerBound: 190e9, rate: 0.01 },
        { lowerBound: 365e9, rate: 0.015 },
        { lowerBound: 540e9, rate: 0.02 },
        { lowerBound: 715e9, rate: 0.025 },
        { lowerBound: 890e9, rate: 0.03 },
      ],
    };
  }
  return {
    year: 2027,
    buckets: [
      { lowerBound: 205e9, rate: 0.01 },
      { lowerBound: 390e9, rate: 0.015 },
      { lowerBound: 575e9, rate: 0.02 },
      { lowerBound: 760e9, rate: 0.025 },
      { lowerBound: 945e9, rate: 0.03 },
    ],
  };
};

export const osiiRateForAverageLem = (averageUkLem: number, effectiveYear: number): number => {
  const buckets = osiiThresholdsForYear(effectiveYear).buckets;
  let rate = 0;
  for (const bucket of buckets) {
    if (averageUkLem >= bucket.lowerBound) rate = bucket.rate;
  }
  return rate;
};

const nextOsiiThreshold = (averageUkLem: number, effectiveYear: number) =>
  osiiThresholdsForYear(effectiveYear).buckets.find((bucket) => averageUkLem < bucket.lowerBound);

const average = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const advanceMonths = (raw: Date, months: number): Date => {
  const date = new Date(raw);
  date.setUTCMonth(date.getUTCMonth() + Math.max(0, Math.round(months)));
  return date;
};

const currentCoreDeposits = (state: BankState): number =>
  state.financial.balanceSheet.items.reduce(
    (sum, item) => sum + (hasCapability(item.productType, 'customerDeposit') ? Math.max(0, item.balance) : 0),
    0
  );

const currentTradingAssetsProxy = (state: BankState): number =>
  state.financial.balanceSheet.items.reduce(
    (sum, item) => sum + (item.productType === AssetProductType.DerivativeAssets ? Math.max(0, item.balance) : 0),
    0
  );

export const calculateOsiiScope = (state: BankState, config: SimulationConfig) => {
  const coreDeposits = currentCoreDeposits(state);
  const tradingAssets = currentTradingAssetsProxy(state);
  const tier1 = Math.max(0, eligibleCet1(state, config) + state.financial.capital.at1);
  const tradingAssetsToTier1 = tier1 > 0 ? tradingAssets / tier1 : Infinity;
  const inScope = coreDeposits > CORE_DEPOSIT_SCOPE_THRESHOLD;
  const scopeRoute: OsiiScopeRoute = !inScope
    ? 'belowCoreDepositThreshold'
    : tradingAssetsToTier1 < LOW_TRADING_THRESHOLD
      ? 'largeDomesticBank'
      : 'ringFencedBankProxy';
  return { inScope, scopeRoute, coreDeposits, tradingAssets, tradingAssetsToTier1 };
};

/**
 * BankSim's O-SII UK LEM proxy follows the published framework description: central-bank
 * reserves are excluded and committed but undrawn credit facilities are included. The game is
 * currently a domestic UK bank, so the whole measure is treated as UK. The derivative book is
 * replaced by the model's prudential derivative exposure, consistently with the leverage engine.
 */
export const calculateOsiiUkLeverageExposure = (state: BankState): number => {
  const assets = state.financial.balanceSheet.items.filter((item) => item.side === BalanceSheetSide.Asset);
  const totalAssets = assets.reduce((sum, item) => sum + Math.max(0, item.balance), 0);
  const centralBankReserves = assets.reduce(
    (sum, item) => sum + (item.productType === AssetProductType.CashReserves ? Math.max(0, item.balance) : 0),
    0
  );
  const derivativeBook = assets.reduce(
    (sum, item) => sum + (item.productType === AssetProductType.DerivativeAssets ? Math.max(0, item.balance) : 0),
    0
  );
  return Math.max(
    0,
    totalAssets - centralBankReserves - derivativeBook + hedgeExposures(state).leverage + committedExposure(state)
  );
};

const relevantCreditRwa = (state: BankState): number => {
  let total = 0;
  const entries = Object.entries(state.loanCohorts ?? {}) as Array<
    [ProductType, Array<{ outstandingPrincipal: number }>]
  >;
  for (const [productType, cohorts] of entries) {
    if (!hasCapability(productType, 'loan')) continue;
    for (const cohort of cohorts ?? []) {
      total += Math.max(0, cohort.outstandingPrincipal) * regulatoryRiskWeight(productType);
    }
  }
  return total;
};

export const calculateInstitutionSpecificCcyb = (state: BankState, config: SimulationConfig) => {
  const ukRate = Math.max(0, config.riskLimits.capitalBufferStack.countercyclicalBuffer);
  const totalRelevantCreditRwa = relevantCreditRwa(state);
  // All currently modelled cohort geographies are UK regions. Keep this explicit so international
  // products can later supply non-UK weights without changing the combined-buffer engine.
  const ukRelevantCreditRwa = totalRelevantCreditRwa;
  const ukShare = totalRelevantCreditRwa > 0 ? ukRelevantCreditRwa / totalRelevantCreditRwa : 0;
  return {
    rate: ukRate * ukShare,
    ukRate,
    ukShare,
    ukRelevantCreditRwa,
    totalRelevantCreditRwa,
  };
};

const observationDate = (state: BankState, observationStep: number): Date =>
  observationStep > state.time.step
    ? advanceMonths(state.time.date, state.time.stepLengthMonths)
    : new Date(state.time.date);

export const ensureOsiiAssessment = (state: BankState, config: SimulationConfig): OsiiAssessmentState => {
  const existing = state.risk.osii;
  const currentUkLem = calculateOsiiUkLeverageExposure(state);
  const currentScope = calculateOsiiScope(state, config);
  const closingStep = existing ? state.time.step + 1 : state.time.step;
  let observations = existing?.quarterEndObservations.map((x) => ({ ...x })) ?? [];

  if (closingStep === 0 || closingStep % 3 === 0) {
    if (!observations.some((x) => x.step === closingStep)) {
      observations.push({
        step: closingStep,
        date: observationDate(state, closingStep).toISOString(),
        ukLeverageExposure: currentUkLem,
      });
      observations = observations.sort((a, b) => a.step - b.step).slice(-4);
    }
  }

  const due = !existing || closingStep >= existing.nextAssessmentStep;
  if (!due && existing) {
    const updated = { ...existing, quarterEndObservations: observations };
    state.risk.osii = updated;
    return updated;
  }

  const assessmentStep = existing ? closingStep : state.time.step;
  const assessmentDate = observationDate(state, assessmentStep);
  const effectiveYear = assessmentDate.getUTCFullYear() + 1;
  const averageQuarterEndUkLeverageExposure = observations.length
    ? average(observations.map((x) => x.ukLeverageExposure))
    : currentUkLem;
  const assessedRate = currentScope.inScope
    ? osiiRateForAverageLem(averageQuarterEndUkLeverageExposure, effectiveYear)
    : 0;

  const assessment: OsiiAssessmentState = {
    assessedRate,
    assessmentStep,
    nextAssessmentStep: assessmentStep + OSII_ASSESSMENT_INTERVAL_MONTHS,
    effectiveYear,
    averageQuarterEndUkLeverageExposure,
    inScopeAtAssessment: currentScope.inScope,
    scopeRouteAtAssessment: currentScope.scopeRoute,
    quarterEndObservations: observations,
  };
  state.risk.osii = assessment;
  return assessment;
};

export const calculateCapitalBufferFramework = (args: { state: BankState; config: SimulationConfig }) => {
  const { state, config } = args;
  const conservationRate = Math.max(0, config.riskLimits.capitalBufferStack.conservationBuffer);
  const ccyb = calculateInstitutionSpecificCcyb(state, config);
  const osii = ensureOsiiAssessment(state, config);
  const scope = calculateOsiiScope(state, config);
  const currentUkLem = calculateOsiiUkLeverageExposure(state);
  const trailingAverage = osii.quarterEndObservations.length
    ? average(osii.quarterEndObservations.map((x) => x.ukLeverageExposure))
    : currentUkLem;
  const manualSystemicFloor = Math.max(0, config.riskLimits.capitalBufferStack.systemicBuffer);
  const osiiRate = Math.max(osii.assessedRate, manualSystemicFloor);
  const nextEffectiveYear = osii.effectiveYear + 1;
  const schedule = osiiThresholdsForYear(nextEffectiveYear);
  const next = nextOsiiThreshold(trailingAverage, nextEffectiveYear);

  return {
    conservationRate,
    ccybRate: ccyb.rate,
    ukCcybRate: ccyb.ukRate,
    ukRelevantCreditRwaShare: ccyb.ukShare,
    osiiRate,
    combinedBufferRate: conservationRate + ccyb.rate + osiiRate,
    osiiInScope: scope.inScope,
    osiiScopeRoute: scope.scopeRoute,
    osiiCoreDeposits: scope.coreDeposits,
    osiiTradingAssets: scope.tradingAssets,
    osiiTradingAssetsToTier1: scope.tradingAssetsToTier1,
    osiiCurrentUkLeverageExposure: currentUkLem,
    osiiTrailingAverageUkLeverageExposure: trailingAverage,
    osiiAssessedAverageUkLeverageExposure: osii.averageQuarterEndUkLeverageExposure,
    osiiNextThreshold: next?.lowerBound,
    osiiNextThresholdRate: next?.rate,
    osiiNextAssessmentStep: osii.nextAssessmentStep,
    osiiThresholdScheduleYear: schedule.year,
  };
};
''')

# Metrics use dynamic combined buffers rather than a static config sum.
replace(
    "src/engine/metrics.ts",
    "import { ensurePillar2AAssessment } from './pillar2A';\n",
    "import { ensurePillar2AAssessment } from './pillar2A';\nimport { calculateCapitalBufferFramework } from './capitalBuffers';\n",
)
regex_replace(
    "src/engine/metrics.ts",
    r"\nconst computeCet1Requirement = \(limits: RiskLimits\): number => \{.*?\n\};\n",
    "\n",
)
replace(
    "src/engine/metrics.ts",
    "  const leverageExposure = totalAssets - derivativeBook + hedgeExposures(state).leverage - centralBankExclusion(state) + committedExposure(state) * .2;\n",
    "  const leverageExposure = totalAssets - derivativeBook + hedgeExposures(state).leverage - centralBankExclusion(state) + committedExposure(state) * .2;\n  const capitalBuffers = calculateCapitalBufferFramework({ state, config });\n",
)
replace(
    "src/engine/metrics.ts",
    "  const cet1Requirement = computeCet1Requirement(config.riskLimits) + ownFundsCet1Floor - config.riskLimits.minCet1Ratio;\n",
    "  const cet1Requirement = ownFundsCet1Floor + capitalBuffers.combinedBufferRate;\n",
)
replace(
    "src/engine/metrics.ts",
    "    pillar2ANextAssessmentStep: pillar2A.nextAssessmentStep,\n",
    """    pillar2ANextAssessmentStep: pillar2A.nextAssessmentStep,
    capitalConservationBufferRate: capitalBuffers.conservationRate,
    countercyclicalBufferRate: capitalBuffers.ccybRate,
    ukCountercyclicalBufferRate: capitalBuffers.ukCcybRate,
    ukRelevantCreditRwaShare: capitalBuffers.ukRelevantCreditRwaShare,
    osiiBufferRate: capitalBuffers.osiiRate,
    combinedBufferRate: capitalBuffers.combinedBufferRate,
    osiiInScope: capitalBuffers.osiiInScope,
    osiiScopeRoute: capitalBuffers.osiiScopeRoute,
    osiiCoreDeposits: capitalBuffers.osiiCoreDeposits,
    osiiTradingAssets: capitalBuffers.osiiTradingAssets,
    osiiTradingAssetsToTier1: capitalBuffers.osiiTradingAssetsToTier1,
    osiiCurrentUkLeverageExposure: capitalBuffers.osiiCurrentUkLeverageExposure,
    osiiTrailingAverageUkLeverageExposure: capitalBuffers.osiiTrailingAverageUkLeverageExposure,
    osiiAssessedAverageUkLeverageExposure: capitalBuffers.osiiAssessedAverageUkLeverageExposure,
    osiiNextThreshold: capitalBuffers.osiiNextThreshold,
    osiiNextThresholdRate: capitalBuffers.osiiNextThresholdRate,
    osiiNextAssessmentStep: capitalBuffers.osiiNextAssessmentStep,
    osiiThresholdScheduleYear: capitalBuffers.osiiThresholdScheduleYear,
""",
)

# Clarify base config semantics.
replace(
    "src/config/baseConfig.ts",
    "    conservationBuffer: 0.025,\n    countercyclicalBuffer: 0.02,\n    systemicBuffer: 0,\n",
    "    conservationBuffer: 0.025,\n    // Current UK CCyB rate; the engine derives the institution-specific rate from geographic credit exposure.\n    countercyclicalBuffer: 0.02,\n    // Compatibility/manual floor only. The O-SII buffer is calculated from size and annual UK LEM assessments.\n    systemicBuffer: 0,\n",
)

# Capital UI.
Path("src/components/CapitalBuffersPanel.tsx").write_text(r'''import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { formatCurrency, formatPct } from '../utils/formatters';

const scopeLabel = (route: BankState['risk']['riskMetrics']['osiiScopeRoute']): string => {
  if (route === 'largeDomesticBank') return 'In scope · large domestic bank';
  if (route === 'ringFencedBankProxy') return 'In scope · ring-fenced-bank proxy';
  return 'Out of scope';
};

export default function CapitalBuffersPanel({ state, config }: { state: BankState; config: SimulationConfig }) {
  const m = state.risk.riskMetrics;
  const conservation = m.capitalConservationBufferRate ?? config.riskLimits.capitalBufferStack.conservationBuffer;
  const ccyb = m.countercyclicalBufferRate ?? config.riskLimits.capitalBufferStack.countercyclicalBuffer;
  const osii = m.osiiBufferRate ?? config.riskLimits.capitalBufferStack.systemicBuffer;
  const combined = m.combinedBufferRate ?? conservation + ccyb + osii;
  const monthsToReview = Math.max(0, (m.osiiNextAssessmentStep ?? state.time.step) - state.time.step);
  const coreDeposits = m.osiiCoreDeposits ?? 0;
  const coreThreshold = 35e9;
  const nextThreshold = m.osiiNextThreshold;
  const trailingLem = m.osiiTrailingAverageUkLeverageExposure ?? m.osiiCurrentUkLeverageExposure ?? 0;
  const nextHeadroom = nextThreshold === undefined ? undefined : Math.max(0, nextThreshold - trailingLem);

  return <section className="capital-card capital-buffers-panel">
    <header><div><h3>Capital buffer framework</h3><p className="muted">The combined buffer is CET1 held above Pillar 1 and Pillar 2A minima. BankSim models the capital conservation buffer, the institution-specific CCyB and a growth-triggered O-SII buffer; the G-SIB buffer is intentionally not modelled.</p></div></header>
    <div className="capital-ratios">
      <div><strong>{formatPct(combined)}</strong><span>Combined buffer</span></div>
      <div><span>Institution-specific CCyB</span><b>{formatPct(ccyb)}</b></div>
      <div><span>O-SII buffer</span><b>{formatPct(osii)}</b></div>
    </div>
    <div className="capital-detail-grid">
      <div>
        <h4>Buffer stack</h4>
        <div className="table-scroll"><table><thead><tr><th>Buffer</th><th>% of RWA</th><th>Amount</th></tr></thead><tbody>
          <tr><td>Capital conservation buffer</td><td>{formatPct(conservation)}</td><td>{formatCurrency(conservation * m.rwa)}</td></tr>
          <tr><td>Institution-specific countercyclical buffer</td><td>{formatPct(ccyb)}</td><td>{formatCurrency(ccyb * m.rwa)}</td></tr>
          <tr><td>O-SII buffer</td><td>{formatPct(osii)}</td><td>{formatCurrency(osii * m.rwa)}</td></tr>
          <tr className="total-row"><th>Combined buffer</th><td>{formatPct(combined)}</td><td>{formatCurrency(combined * m.rwa)}</td></tr>
        </tbody></table></div>
        <p className="muted">The current UK CCyB rate is {formatPct(m.ukCountercyclicalBufferRate ?? ccyb)}. Current BankSim lending is domestic, so {formatPct(m.ukRelevantCreditRwaShare ?? 1)} of relevant credit RWA is treated as UK exposure.</p>
      </div>
      <div>
        <h4>O-SII growth trigger</h4>
        <div className="table-scroll"><table><tbody>
          <tr><th>Current scope</th><td>{scopeLabel(m.osiiScopeRoute)}</td></tr>
          <tr><th>Core deposits</th><td>{formatCurrency(coreDeposits)} / {formatCurrency(coreThreshold)} scope threshold</td></tr>
          <tr><th>Current UK leverage exposure</th><td>{formatCurrency(m.osiiCurrentUkLeverageExposure ?? 0)}</td></tr>
          <tr><th>Trailing quarter-end average</th><td>{formatCurrency(trailingLem)}</td></tr>
          <tr><th>Average used at last rate setting</th><td>{formatCurrency(m.osiiAssessedAverageUkLeverageExposure ?? 0)}</td></tr>
          <tr><th>Next O-SII threshold</th><td>{nextThreshold === undefined ? 'Top bucket reached' : `${formatCurrency(nextThreshold)} → ${formatPct(m.osiiNextThresholdRate ?? 0)}`}</td></tr>
          {nextHeadroom !== undefined && <tr><th>Headroom to next threshold</th><td>{formatCurrency(nextHeadroom)}</td></tr>}
          <tr><th>Next annual rate setting</th><td>{monthsToReview === 0 ? 'Next close' : `${monthsToReview}m`}</td></tr>
          <tr><th>Threshold schedule</th><td>{m.osiiThresholdScheduleYear ?? 2027} framework</td></tr>
        </tbody></table></div>
        <p className="muted">O-SII is assessed annually from the trailing four quarter-end UK leverage exposure measures. For the generic bank, crossing £35bn of core deposits brings it into the domestic-systemic framework; a positive buffer only applies once the relevant UK LEM bucket is reached. BankSim applies a newly assessed rate immediately at its annual review rather than reproducing the PRA publication lag.</p>
      </div>
    </div>
  </section>;
}
''')
replace(
    "src/components/CapitalDashboard.tsx",
    "import Pillar2APanel from './Pillar2APanel';\n",
    "import Pillar2APanel from './Pillar2APanel';\nimport CapitalBuffersPanel from './CapitalBuffersPanel';\n",
)
replace(
    "src/components/CapitalDashboard.tsx",
    "  const b = config.riskLimits.capitalBufferStack;\n  const buffer = b.conservationBuffer + b.countercyclicalBuffer + b.systemicBuffer;\n",
    """  const b = config.riskLimits.capitalBufferStack;
  const metrics = state.risk.riskMetrics;
  const conservationBuffer = metrics.capitalConservationBufferRate ?? b.conservationBuffer;
  const countercyclicalBuffer = metrics.countercyclicalBufferRate ?? b.countercyclicalBuffer;
  const osiiBuffer = metrics.osiiBufferRate ?? b.systemicBuffer;
  const buffer = metrics.combinedBufferRate ?? conservationBuffer + countercyclicalBuffer + osiiBuffer;
""",
)
replace(
    "src/components/CapitalDashboard.tsx",
    "    { label: 'Capital conservation buffer', ratio: b.conservationBuffer },\n    { label: 'Countercyclical buffer', ratio: b.countercyclicalBuffer },\n    { label: 'Systemic buffer', ratio: b.systemicBuffer },\n",
    "    { label: 'Capital conservation buffer', ratio: conservationBuffer },\n    { label: 'Institution-specific countercyclical buffer', ratio: countercyclicalBuffer },\n    { label: 'O-SII buffer', ratio: osiiBuffer },\n",
)
replace(
    "src/components/CapitalDashboard.tsx",
    "    <Pillar2APanel state={state} config={config}/>\n",
    "    <CapitalBuffersPanel state={state} config={config}/>\n    <Pillar2APanel state={state} config={config}/>\n",
)

# Help entry and wiring.
Path("src/content/capitalBuffersHelp.ts").write_text(r'''import { MechanicEntry } from './mechanicsRegistry';

export const capitalBuffersHelpEntry: MechanicEntry = {
  id: 'capital-buffer-framework',
  category: 'Capital',
  title: 'Capital conservation, CCyB and O-SII buffers',
  plainDescription:
    'Above Pillar 1 and Pillar 2A minima, BankSim holds a combined CET1 buffer made up of the 2.5% capital conservation buffer, the institution-specific countercyclical capital buffer and any O-SII buffer. The G-SIB buffer is deliberately outside the game.',
  whyItMatters:
    'The conservation buffer applies throughout the game. The CCyB depends on where relevant credit exposures are located. The O-SII buffer is a growth consequence: a bank can become domestically systemic as its deposit base and UK leverage exposure grow.',
  driverSummary: [
    'The capital conservation buffer is 2.5% of RWA and is met with CET1.',
    'The current UK CCyB rate is 2%. The institution-specific rate is a geographic weighted average of applicable CCyB rates; all currently modelled lending geographies are UK regions, so the sandbox rate is presently 2%.',
    'For the generic UK bank, more than £35bn of core deposits brings it into the O-SII scope proxy. The game distinguishes a low-trading large domestic bank from a ring-fenced-bank proxy, but does not model the full legal ring-fencing test.',
    'The O-SII rate is reset annually from the trailing four quarter-end UK leverage exposure measures. The UK LEM proxy excludes central-bank reserves and includes committed but undrawn credit facilities.',
    'For rates applying in 2026 the first positive O-SII bucket starts at £190bn average UK LEM. The published 2027 framework starts at £205bn; higher buckets rise to 3%. BankSim uses the 2027 published thresholds thereafter until the framework is updated in the game.',
    'A newly assessed O-SII rate applies to all RWA. BankSim applies it at the annual in-game review rather than reproducing the external PRA publication lag.',
  ],
  formula:
    'Combined buffer = capital conservation buffer + institution-specific CCyB + O-SII buffer\nInstitution-specific CCyB = Σ(jurisdiction share of relevant credit RWA × jurisdiction CCyB rate)\nO-SII rate = bucket(trailing four-quarter average UK leverage exposure)',
  relatedMetrics: ['CET1 requirement', 'Combined buffer', 'UK leverage exposure', 'RWA'],
  relatedActions: ['Grow customer deposits', 'Grow lending', 'Raise equity'],
};
''')
replace(
    "src/components/HelpCenterPanel.tsx",
    "import { pillar2AHelpEntry } from '../content/pillar2AHelp';\n",
    "import { pillar2AHelpEntry } from '../content/pillar2AHelp';\nimport { capitalBuffersHelpEntry } from '../content/capitalBuffersHelp';\n",
)
replace(
    "src/components/HelpCenterPanel.tsx",
    "    () => [...buildMechanicsRegistry(mechanicsContext), pillar2AHelpEntry],\n",
    "    () => [...buildMechanicsRegistry(mechanicsContext), capitalBuffersHelpEntry, pillar2AHelpEntry],\n",
)

# Documentation.
replace(
    "docs/model-basis.md",
    "| Buffers | 2.5% conservation buffer plus 2% UK CCyB. CET1 must also cover any Tier 1/total capital shortfall before meeting buffers. A configured PRA buffer sits above the combined buffer and informs the internal target. PRA-buffer use prompts recovery warnings but does not itself trigger MDA or failure. Internal management headroom is shown separately. |",
    "| Buffers | The combined CET1 buffer is calculated dynamically: 2.5% capital conservation buffer + institution-specific CCyB + any O-SII buffer. The current UK CCyB rate is 2%; because all modelled lending geographies are UK regions, the opening institution-specific rate is also 2%. O-SII is growth-triggered from annual average quarter-end UK leverage exposure. CET1 must also cover any Tier 1/total capital shortfall before meeting buffers. A configured PRA buffer sits above the combined buffer and informs the internal target. PRA-buffer use prompts recovery warnings but does not itself trigger MDA or failure. Internal management headroom is shown separately. |",
)
replace(
    "docs/model-basis.md",
    "- [Capital buffers rules](https://www.prarulebook.co.uk/pra-rules/capital-buffers) and [UK CCyB](https://www.bankofengland.co.uk/financial-stability/the-countercyclical-capital-buffer).\n",
    "- [Capital buffers rules](https://www.prarulebook.co.uk/pra-rules/capital-buffers) and [UK CCyB](https://www.bankofengland.co.uk/financial-stability/the-countercyclical-capital-buffer).\n- [FPC O-SII buffer framework response, July 2025](https://www.bankofengland.co.uk/paper/2025/fpc-response-2024-o-sii-buffer-framework-review) and [PRA O-SII rates](https://www.bankofengland.co.uk/prudential-regulation/publication/2025/november/o-sii-buffer-rates-for-ring-fenced-banks-and-large-building-societies).\n",
)
replace(
    "docs/model-basis.md",
    "## Pillar 2A SREP assessment\n",
    """## Capital buffer framework

BankSim models the capital conservation buffer (CCoB), institution-specific countercyclical capital buffer (CCyB) and Other Systemically Important Institution (O-SII) buffer. The G-SIB buffer is deliberately not modelled. The combined buffer is the sum of these three rates and is met with CET1 above Pillar 1 and Pillar 2A minima.

The CCoB is fixed at 2.5% of total RWA. The current UK CCyB rate is 2%. The regulatory institution-specific CCyB is a geographic weighted average across relevant credit exposures. All current BankSim cohort geographies are UK regions, so 100% of relevant credit RWA maps to the UK and the sandbox institution-specific CCyB is therefore 2%. The engine exposes the geographic share explicitly so international products can later supply non-UK rates without changing the combined-buffer calculation.

O-SII is growth-triggered. The generic bank enters the game's domestic-systemic scope proxy once core deposits exceed £35bn. If trading assets are below 10% of Tier 1 capital it is classified as a large domestic bank; otherwise BankSim treats it as a ring-fenced-bank proxy. This is a game implementation of the current scope architecture rather than a complete legal ring-fencing test, and building societies are not separately modelled.

The O-SII rate is assessed annually from the trailing four quarter-end UK leverage exposure measures (LEM). BankSim's UK LEM proxy excludes central-bank reserves, replaces the derivative book with the prudential derivative exposure and includes committed but undrawn credit facilities. Because the current bank is domestic, the whole proxy is treated as UK exposure. For the 2026 rate schedule the O-SII buckets are: 0% below £190bn; 1% from £190bn; 1.5% from £365bn; 2% from £540bn; 2.5% from £715bn; and 3% from £890bn. From the published 2027 framework the thresholds are £205bn, £390bn, £575bn, £760bn and £945bn respectively. BankSim uses that published 2027 schedule for later years until a future framework update is modelled.

The PRA sets O-SII rates at least annually using the FPC framework and real-world publication/application lags. For gameplay, BankSim applies the newly assessed rate immediately at its annual review. That preserves the important lag from balance-sheet growth to a higher systemic buffer while avoiding a second administrative lag. The O-SII buffer applies to all RWA once set. A legacy configured `systemicBuffer` value is treated only as a manual floor for scenarios; the base game uses the calculated O-SII rate.

## Pillar 2A SREP assessment
""",
)

# Tests.
Path("src/engine/capitalBuffers.test.ts").write_text(r'''import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import {
  calculateCapitalBufferFramework,
  osiiRateForAverageLem,
  osiiThresholdsForYear,
} from './capitalBuffers';

const makeLargeDomesticBank = () => {
  const s = cloneBankState(initialState);
  const retail = s.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailCurrentAccounts)!;
  retail.balance = 40e9;
  const mortgages = s.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)!;
  mortgages.balance = 220e9;
  s.risk.osii = undefined;
  return s;
};

describe('UK capital buffer framework', () => {
  it('uses the published O-SII threshold schedules', () => {
    expect(osiiThresholdsForYear(2026).buckets.map((x) => x.lowerBound / 1e9)).toEqual([190, 365, 540, 715, 890]);
    expect(osiiThresholdsForYear(2027).buckets.map((x) => x.lowerBound / 1e9)).toEqual([205, 390, 575, 760, 945]);
    expect(osiiRateForAverageLem(189e9, 2026)).toBe(0);
    expect(osiiRateForAverageLem(190e9, 2026)).toBeCloseTo(0.01);
    expect(osiiRateForAverageLem(575e9, 2027)).toBeCloseTo(0.02);
    expect(osiiRateForAverageLem(1e12, 2027)).toBeCloseTo(0.03);
  });

  it('starts the domestic sandbox with a 2.5% CCoB, 2% institution-specific CCyB and no O-SII buffer', () => {
    const s = cloneBankState(initialState);
    s.risk.osii = undefined;
    const b = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(b.conservationRate).toBeCloseTo(0.025);
    expect(b.ukCcybRate).toBeCloseTo(0.02);
    expect(b.ukRelevantCreditRwaShare).toBeCloseTo(1);
    expect(b.ccybRate).toBeCloseTo(0.02);
    expect(b.osiiRate).toBe(0);
    expect(b.combinedBufferRate).toBeCloseTo(0.045);
    expect(b.osiiInScope).toBe(false);
  });

  it('growth above the domestic scope and UK LEM thresholds produces an O-SII buffer at an assessment', () => {
    const s = makeLargeDomesticBank();
    const opening = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(opening.osiiInScope).toBe(true);
    expect(opening.osiiScopeRoute).toBe('largeDomesticBank');
    expect(opening.osiiRate).toBeCloseTo(0.01);
    expect(s.risk.osii?.effectiveYear).toBe(2026);
  });

  it('freezes O-SII between annual reviews and resets from the trailing quarter-end average', () => {
    const s = cloneBankState(initialState);
    s.risk.osii = undefined;
    const first = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(first.osiiRate).toBe(0);

    const retail = s.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailCurrentAccounts)!;
    const mortgages = s.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)!;
    retail.balance = 40e9;
    mortgages.balance = 230e9;

    for (const step of [2, 5, 8]) {
      s.time.step = step;
      const mid = calculateCapitalBufferFramework({ state: s, config: baseConfig });
      expect(mid.osiiRate).toBe(0);
    }

    s.time.step = 11;
    const reviewed = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(reviewed.osiiRate).toBeGreaterThan(0);
    expect(s.risk.osii?.assessmentStep).toBe(12);
    expect(s.risk.osii?.nextAssessmentStep).toBe(24);
    expect(s.risk.osii?.quarterEndObservations.map((x) => x.step)).toEqual([3, 6, 9, 12]);
  });
});
''')

p = Path("src/ui/capitalDashboard.test.tsx")
text = p.read_text()
if "shows the dynamic capital buffer framework" not in text:
    text += r'''

it('shows the dynamic capital buffer framework and O-SII growth trigger',()=>{
  const html=renderToStaticMarkup(<CapitalDashboard state={initialState} config={baseConfig}/>);
  expect(html).toContain('Capital buffer framework');
  expect(html).toContain('Institution-specific countercyclical buffer');
  expect(html).toContain('O-SII buffer');
  expect(html).toContain('O-SII growth trigger');
  expect(html).toContain('scope threshold');
});
'''
    p.write_text(text)

replace(
    "src/ui/helpCenter.test.tsx",
    "    expect(html).toContain('Pillar 2A and the SREP cycle');\n",
    "    expect(html).toContain('Capital conservation, CCyB and O-SII buffers');\n    expect(html).toContain('Pillar 2A and the SREP cycle');\n",
)

replace(
    "src/components/RegMetricsPanel.tsx",
    "Pillar 2A is reassessed every 24 months from the modelled credit, concentration and IRRBB risks and enters minimum requirements; the PRA buffer remains a separate supervisory target.",
    "Pillar 2A is reassessed every 24 months from the modelled credit, concentration and IRRBB risks; the combined CET1 buffer is calculated from CCoB, institution-specific CCyB and any O-SII buffer; the PRA buffer remains a separate supervisory target.",
)

# Self-delete migration artifacts after the generated commit.
Path('.github/scripts/capital_buffer_migrate.py').unlink()
Path('.github/workflows/capital-buffer-framework-migrate.yml').unlink()
