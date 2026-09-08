from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))

# -----------------------------------------------------------------------------
# Pillar 2A: metric calculation may preview an opening assessment, but only an
# explicit opening initialisation or month-close operation may mutate history.
# -----------------------------------------------------------------------------
p = Path('src/engine/pillar2A.ts')
text = p.read_text()
old = '''export const ensurePillar2AAssessment = (args: {
  state: BankState;
  config: SimulationConfig;
  rwa: number;
  eveSensitivity100bp: number;
}): Pillar2AAssessmentState => {
  const existing = args.state.risk.pillar2A;
  const dueStep = existing ? args.state.time.step + 1 : args.state.time.step;
  if (!existing || dueStep >= existing.nextAssessmentStep) {
    const assessment = assessPillar2A({ ...args, assessmentStep: dueStep });
    args.state.risk.pillar2A = assessment;
    return assessment;
  }
  return existing;
};
'''
new = '''export const pillar2AAssessmentForMetrics = (args: {
  state: BankState;
  config: SimulationConfig;
  rwa: number;
  eveSensitivity100bp: number;
}): Pillar2AAssessmentState =>
  args.state.risk.pillar2A ??
  assessPillar2A({ ...args, assessmentStep: args.state.time.step });

export const initializeOpeningPillar2AAssessment = (args: {
  state: BankState;
  config: SimulationConfig;
  rwa: number;
  eveSensitivity100bp: number;
}): Pillar2AAssessmentState => {
  const assessment = assessPillar2A({ ...args, assessmentStep: args.state.time.step });
  args.state.risk.pillar2A = assessment;
  return assessment;
};

/** Advance the frozen SREP assessment only as part of a completed month close. */
export const advancePillar2AAssessmentAtClose = (args: {
  state: BankState;
  config: SimulationConfig;
  rwa: number;
  eveSensitivity100bp: number;
}): Pillar2AAssessmentState => {
  const existing = args.state.risk.pillar2A;
  const closingStep = args.state.time.step + 1;
  if (!existing || closingStep >= existing.nextAssessmentStep) {
    const assessment = assessPillar2A({ ...args, assessmentStep: closingStep });
    args.state.risk.pillar2A = assessment;
    return assessment;
  }
  return existing;
};
'''
if old not in text:
    raise SystemExit('pillar2A ensure block not found')
p.write_text(text.replace(old, new, 1))

# -----------------------------------------------------------------------------
# O-SII: separate read-only metric projection from quarter-end/rate-setting
# history mutation. Observations and annual reassessments happen only at close.
# -----------------------------------------------------------------------------
p = Path('src/engine/capitalBuffers.ts')
text = p.read_text()
start = text.index('export const ensureOsiiAssessment =')
end = text.index('export const calculateCapitalBufferFramework =', start)
new_block = r'''const addQuarterEndObservation = (
  state: BankState,
  observations: OsiiAssessmentState['quarterEndObservations'],
  observationStep: number,
  currentUkLem: number
): OsiiAssessmentState['quarterEndObservations'] => {
  if (observationStep !== 0 && observationStep % 3 !== 0) return observations;
  if (observations.some((x) => x.step === observationStep)) return observations;
  return [
    ...observations,
    {
      step: observationStep,
      date: observationDate(state, observationStep).toISOString(),
      ukLeverageExposure: currentUkLem,
    },
  ].sort((a, b) => a.step - b.step).slice(-4);
};

const buildOsiiAssessment = (
  state: BankState,
  config: SimulationConfig,
  assessmentStep: number,
  observations: OsiiAssessmentState['quarterEndObservations'],
  currentUkLem: number
): OsiiAssessmentState => {
  const currentScope = calculateOsiiScope(state, config);
  const assessmentDate = observationDate(state, assessmentStep);
  const effectiveYear = assessmentDate.getUTCFullYear() + 1;
  const averageQuarterEndUkLeverageExposure = observations.length
    ? average(observations.map((x) => x.ukLeverageExposure))
    : currentUkLem;
  const assessedRate = currentScope.inScope
    ? osiiRateForAverageLem(averageQuarterEndUkLeverageExposure, effectiveYear)
    : 0;

  return {
    assessedRate,
    assessmentStep,
    nextAssessmentStep: assessmentStep + OSII_ASSESSMENT_INTERVAL_MONTHS,
    effectiveYear,
    averageQuarterEndUkLeverageExposure,
    inScopeAtAssessment: currentScope.inScope,
    scopeRouteAtAssessment: currentScope.scopeRoute,
    quarterEndObservations: observations,
  };
};

/** Read-only view used by metric refreshes. */
export const osiiAssessmentForMetrics = (
  state: BankState,
  config: SimulationConfig
): OsiiAssessmentState => {
  if (state.risk.osii) return state.risk.osii;
  const currentUkLem = calculateOsiiUkLeverageExposure(state);
  const observations = addQuarterEndObservation(state, [], state.time.step, currentUkLem);
  return buildOsiiAssessment(state, config, state.time.step, observations, currentUkLem);
};

export const initializeOpeningOsiiAssessment = (
  state: BankState,
  config: SimulationConfig
): OsiiAssessmentState => {
  const assessment = osiiAssessmentForMetrics(state, config);
  state.risk.osii = assessment;
  return assessment;
};

/** Record quarter-end history and change the assessed rate only on a completed month close. */
export const advanceOsiiAssessmentAtClose = (
  state: BankState,
  config: SimulationConfig
): OsiiAssessmentState => {
  const existing = state.risk.osii ?? initializeOpeningOsiiAssessment(state, config);
  const closingStep = state.time.step + 1;
  const currentUkLem = calculateOsiiUkLeverageExposure(state);
  const observations = addQuarterEndObservation(
    state,
    existing.quarterEndObservations.map((x) => ({ ...x })),
    closingStep,
    currentUkLem
  );

  if (closingStep < existing.nextAssessmentStep) {
    const updated = { ...existing, quarterEndObservations: observations };
    state.risk.osii = updated;
    return updated;
  }

  const assessment = buildOsiiAssessment(
    state,
    config,
    closingStep,
    observations,
    currentUkLem
  );
  state.risk.osii = assessment;
  return assessment;
};

'''
text = text[:start] + new_block + text[end:]
old_call = '  const osii = ensureOsiiAssessment(state, config);\n'
if old_call not in text:
    raise SystemExit('capital buffer ensure call not found')
text = text.replace(old_call, '  const osii = osiiAssessmentForMetrics(state, config);\n', 1)
p.write_text(text)

# -----------------------------------------------------------------------------
# One explicit boundary API for opening initialisation and month-close advances.
# -----------------------------------------------------------------------------
Path('src/engine/supervisoryAssessments.ts').write_text(r'''import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { RiskMetrics } from '../domain/risks';
import { calculateRiskMetrics } from './metrics';
import {
  advancePillar2AAssessmentAtClose,
  initializeOpeningPillar2AAssessment,
} from './pillar2A';
import {
  advanceOsiiAssessmentAtClose,
  initializeOpeningOsiiAssessment,
} from './capitalBuffers';

/**
 * Scenario and calibration builders clone the fully assessed base bank before
 * applying opening-state overrides. Frozen supervisory assessments from that
 * base bank are no longer valid once the opening portfolio or configuration is
 * changed, so clear them before rebuilding opening assessments.
 */
export const resetOpeningSupervisoryAssessments = (state: BankState): void => {
  state.risk.pillar2A = undefined;
  state.risk.osii = undefined;
};

/** Establish supervisory state after all opening-state overrides have been applied. */
export const initializeOpeningSupervisoryAssessments = (
  state: BankState,
  config: SimulationConfig
): void => {
  initializeOpeningOsiiAssessment(state, config);
  const preview = calculateRiskMetrics({ state, config });
  initializeOpeningPillar2AAssessment({
    state,
    config,
    rwa: preview.rwa,
    eveSensitivity100bp: preview.eveSensitivity100bp,
  });
};

/** The only normal simulation path that advances supervisory assessment history. */
export const advanceSupervisoryAssessmentsAtClose = (
  state: BankState,
  config: SimulationConfig,
  closingMetrics?: RiskMetrics
): void => {
  const metrics = closingMetrics ?? calculateRiskMetrics({ state, config });
  advancePillar2AAssessmentAtClose({
    state,
    config,
    rwa: metrics.rwa,
    eveSensitivity100bp: metrics.eveSensitivity100bp,
  });
  advanceOsiiAssessmentAtClose(state, config);
};
''')

# Metrics use read-only supervisory views.
replace_once(
    'src/engine/metrics.ts',
    "import { ensurePillar2AAssessment } from './pillar2A';\n",
    "import { pillar2AAssessmentForMetrics } from './pillar2A';\n",
)
replace_once(
    'src/engine/metrics.ts',
    '''  const pillar2A = ensurePillar2AAssessment({
    state,
    config,
    rwa,
    eveSensitivity100bp: irrbbSensitivities.eveSensitivity100bp,
  });
''',
    '''  const pillar2A = pillar2AAssessmentForMetrics({
    state,
    config,
    rwa,
    eveSensitivity100bp: irrbbSensitivities.eveSensitivity100bp,
  });
''',
)

# Simulation explicitly advances supervisory state once, at close, before final metrics/distributions.
replace_once(
    'src/engine/simulation.ts',
    "import { calculateRiskMetrics, classifyFundingConfidenceState, evaluateCompliance } from './metrics';\n",
    "import { calculateRiskMetrics, classifyFundingConfidenceState, evaluateCompliance } from './metrics';\nimport { advanceSupervisoryAssessmentsAtClose } from './supervisoryAssessments';\n",
)
replace_once(
    'src/engine/simulation.ts',
    '''    computeMetrics(state, activeConfig, shockEffects.lcrOutflowMultiplier, events, true, false);
''',
    '''    const supervisoryCloseMetrics = calculateRiskMetrics({
      state,
      config: activeConfig,
      lcrOutflowMultiplier: shockEffects.lcrOutflowMultiplier,
    });
    advanceSupervisoryAssessmentsAtClose(state, activeConfig, supervisoryCloseMetrics);
    computeMetrics(state, activeConfig, shockEffects.lcrOutflowMultiplier, events, true, false);
''',
)

# Opening base state gets explicit assessments before final risk metrics are stored.
replace_once(
    'src/config/initialState.ts',
    "import { calculateRiskMetrics, evaluateCompliance } from '../engine/metrics';\n",
    "import { calculateRiskMetrics, evaluateCompliance } from '../engine/metrics';\nimport { initializeOpeningSupervisoryAssessments } from '../engine/supervisoryAssessments';\n",
)
replace_once(
    'src/config/initialState.ts',
    '''const riskMetrics = calculateRiskMetrics({ state: seedState, config: baseConfig });
const compliance = evaluateCompliance(riskMetrics, baseConfig.riskLimits);
''',
    '''initializeOpeningSupervisoryAssessments(seedState, baseConfig);
const riskMetrics = calculateRiskMetrics({ state: seedState, config: baseConfig });
const compliance = evaluateCompliance(riskMetrics, baseConfig.riskLimits);
''',
)

# Scenario/calibration opening overrides are followed by fresh explicit assessments.
replace_once(
    'src/config/scenarios.ts',
    "import { resetOpeningSupervisoryAssessments } from '../engine/supervisoryAssessments';\n",
    "import { initializeOpeningSupervisoryAssessments, resetOpeningSupervisoryAssessments } from '../engine/supervisoryAssessments';\n",
)
replace_once(
    'src/config/scenarios.ts',
    '''  resetOpeningSupervisoryAssessments(state);
  state.risk.riskMetrics = calculateRiskMetrics({ state, config });
''',
    '''  resetOpeningSupervisoryAssessments(state);
  initializeOpeningSupervisoryAssessments(state, config);
  state.risk.riskMetrics = calculateRiskMetrics({ state, config });
''',
)
replace_once(
    'src/config/calibration/utils.ts',
    "import { resetOpeningSupervisoryAssessments } from '../../engine/supervisoryAssessments';\n",
    "import { initializeOpeningSupervisoryAssessments, resetOpeningSupervisoryAssessments } from '../../engine/supervisoryAssessments';\n",
)
replace_once(
    'src/config/calibration/utils.ts',
    '''  resetOpeningSupervisoryAssessments(state);
  state.risk.riskMetrics = calculateRiskMetrics({ state, config });
''',
    '''  resetOpeningSupervisoryAssessments(state);
  initializeOpeningSupervisoryAssessments(state, config);
  state.risk.riskMetrics = calculateRiskMetrics({ state, config });
''',
)

# -----------------------------------------------------------------------------
# Tier 2: distinguish a missing classified line (legacy fallback) from a present
# classified line whose balance is exactly zero.
# -----------------------------------------------------------------------------
replace_once(
    'src/products/regulatory.ts',
    '''  const classifiedBalance = state.financial.balanceSheet.items.reduce((sum, item) => {
    return getCapitalRule(item.productType).ownFundsTier === 'tier2'
      ? sum + Math.max(0, item.balance)
      : sum;
  }, 0);
  return classifiedBalance > 0 ? Math.min(recorded, classifiedBalance) : recorded;
''',
    '''  let hasClassifiedLine = false;
  const classifiedBalance = state.financial.balanceSheet.items.reduce((sum, item) => {
    if (getCapitalRule(item.productType).ownFundsTier !== 'tier2') return sum;
    hasClassifiedLine = true;
    return sum + Math.max(0, item.balance);
  }, 0);
  return hasClassifiedLine ? Math.min(recorded, classifiedBalance) : recorded;
''',
)

# -----------------------------------------------------------------------------
# Leverage composition chart: include negative CET1 in the coordinate domain.
# -----------------------------------------------------------------------------
replace_once(
    'src/components/LeverageDashboard.tsx',
    '''  const chartMax = Math.ceil(
    Math.max(0.09, d.target * 1.2, Number.isFinite(d.ratio) ? d.ratio * 1.15 : 0) / 0.01
  ) * 0.01;
  const chartY = (n: number) => 250 - (Math.max(0, n) / chartMax) * 205;
  const ticks = Array.from({ length: 5 }, (_, i) => (chartMax * i) / 4);
  let cumulative = 0;
  const positionedParts = parts.map(part => {
    const start = cumulative;
    cumulative += d.exposure > 0 ? part.value / d.exposure : 0;
    return { ...part, start, end: cumulative };
  });
''',
    '''  let cumulative = 0;
  const positionedParts = parts.map(part => {
    const start = cumulative;
    cumulative += d.exposure > 0 ? part.value / d.exposure : 0;
    return { ...part, start, end: cumulative };
  });
  const compositionMin = Math.min(0, ...positionedParts.flatMap(part => [part.start, part.end]));
  const compositionMax = Math.max(0, ...positionedParts.flatMap(part => [part.start, part.end]));
  const chartMin = compositionMin < 0
    ? Math.floor((compositionMin * 1.15) / 0.01) * 0.01
    : 0;
  const chartMax = Math.ceil(
    Math.max(
      0.09,
      d.target * 1.2,
      Number.isFinite(d.ratio) ? d.ratio * 1.15 : 0,
      compositionMax * 1.15
    ) / 0.01
  ) * 0.01;
  const chartRange = Math.max(0.01, chartMax - chartMin);
  const chartY = (n: number) => 250 - ((n - chartMin) / chartRange) * 205;
  const ticks = Array.from({ length: 5 }, (_, i) => chartMin + (chartRange * i) / 4);
''',
)
replace_once(
    'src/components/LeverageDashboard.tsx',
    '''                <text transform="translate(16 150) rotate(-90)" textAnchor="middle">
                  % of leverage exposure
                </text>
''',
    '''                {chartMin < 0 && (
                  <path
                    className="leverage-zero-axis"
                    d={`M58 ${chartY(0)}H320`}
                    stroke="var(--text)"
                    strokeWidth="1.5"
                  />
                )}
                <text transform="translate(16 150) rotate(-90)" textAnchor="middle">
                  % of leverage exposure
                </text>
''',
)
replace_once(
    'src/components/LeverageDashboard.tsx',
    '''                      <rect x="104" y={top} width="165" height={height} fill={part.color} />
''',
    '''                      <rect
                        x="104"
                        y={top}
                        width="165"
                        height={height}
                        fill={part.color}
                        data-capital-component={part.label}
                        data-start-ratio={part.start}
                        data-end-ratio={part.end}
                      />
''',
)

# -----------------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------------
Path('src/engine/pillar2A.test.ts').write_text(r'''import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { calculateRiskMetrics } from './metrics';
import {
  advancePillar2AAssessmentAtClose,
  applyPs1520Offset,
  calculatePillar2AConcentration,
  concentrationAddOnRate,
  pillar2ACreditBenchmarkRiskWeight,
} from './pillar2A';

describe('24-month Pillar 2A SREP assessment', () => {
  it('implements the published PRA concentration HHI bucket midpoints', () => {
    expect(concentrationAddOnRate('singleName', 0.002)).toBeCloseTo(0.0025);
    expect(concentrationAddOnRate('singleName', 0.01)).toBeCloseTo(0.015);
    expect(concentrationAddOnRate('sector', 0.10)).toBe(0);
    expect(concentrationAddOnRate('sector', 0.30)).toBeCloseTo(0.0075);
    expect(concentrationAddOnRate('sector', 0.80, 'commercialRealEstate')).toBeCloseTo(0.0215);
    expect(concentrationAddOnRate('geographic', 0.20)).toBeCloseTo(0.001);
    expect(concentrationAddOnRate('geographic', 1)).toBeCloseTo(0.01325);
  });

  it('uses the PRA Table A2 benchmark for the modelled SA credit portfolios', () => {
    const mortgage = initialState.loanCohorts[AssetProductType.Mortgages]![0];
    const consumer = initialState.loanCohorts[AssetProductType.ConsumerLoans]![0];
    const corporate = initialState.loanCohorts[AssetProductType.CorporateLoans]![0];
    expect(pillar2ACreditBenchmarkRiskWeight(AssetProductType.Mortgages, { ...mortgage, ltv: 0.85 }, initialState)).toBeCloseTo(0.187);
    expect(pillar2ACreditBenchmarkRiskWeight(AssetProductType.ConsumerLoans, consumer, initialState)).toBeCloseTo(0.775);
    expect(pillar2ACreditBenchmarkRiskWeight(AssetProductType.CorporateLoans, { ...corporate, sector: 'sme' }, initialState)).toBeCloseTo(0.598);
    expect(pillar2ACreditBenchmarkRiskWeight(AssetProductType.CorporateLoans, { ...corporate, sector: 'largeCorporate' }, initialState)).toBeCloseTo(0.463);
  });

  it('applies the PS15/20 initial reduction and additional 1% floor mechanics', () => {
    const common = { ukPassThroughRate: 1, lowRiskEligible: true, mrelEqualsTcr: true };
    expect(applyPs1520Offset({ grossRate: 0.031, ...common }).finalRate).toBeCloseTo(0.021);
    expect(applyPs1520Offset({ grossRate: 0.019, ...common }).finalRate).toBeCloseTo(0.010);
    expect(applyPs1520Offset({ grossRate: 0.011, ...common }).finalRate).toBeCloseTo(0.006);
    const ineligible = applyPs1520Offset({ grossRate: 0.031, ukPassThroughRate: 1, lowRiskEligible: false, mrelEqualsTcr: true });
    expect(ineligible.initialOffsetRate).toBeCloseTo(0.005);
    expect(ineligible.additionalOffsetRate).toBe(0);
    expect(ineligible.finalRate).toBeCloseTo(0.026);
  });

  it('uses RWA-weighted wholesale and non-mortgage geographic concentration', () => {
    const s = cloneBankState(initialState);
    const result = calculatePillar2AConcentration(s, baseConfig);
    expect(result.wholesaleRwa).toBeGreaterThan(0);
    expect(result.sectorHhi).toBeGreaterThan(0);
    expect(result.geographicHhi).toBeCloseTo(1, 10);
    expect(result.geographicRate).toBeCloseTo(0.01325);
  });

  it('does not advance a due SREP during an ordinary metric refresh; month close advances it explicitly', () => {
    const s = cloneBankState(initialState);
    const opening = structuredClone(s.risk.pillar2A!);
    const openingRate = s.risk.riskMetrics.pillar2ARate!;
    expect(opening.assessmentStep).toBe(0);
    expect(opening.nextAssessmentStep).toBe(24);

    s.behaviour.riskAppetite = { cet1: 0.2, leverage: 0.05, lcr: 1.2, nsfr: 1.1, irrbbEveLimit: 2e9 };
    s.time.step = 23;
    const refreshed = calculateRiskMetrics({ state: s, config: baseConfig });

    expect(s.risk.pillar2A).toEqual(opening);
    expect(refreshed.pillar2ARate).toBeCloseTo(openingRate, 12);

    advancePillar2AAssessmentAtClose({
      state: s,
      config: baseConfig,
      rwa: refreshed.rwa,
      eveSensitivity100bp: refreshed.eveSensitivity100bp,
    });
    const afterClose = calculateRiskMetrics({ state: s, config: baseConfig });
    expect(s.risk.pillar2A!.assessmentStep).toBe(24);
    expect(s.risk.pillar2A!.nextAssessmentStep).toBe(48);
    expect(afterClose.pillar2ARate).toBeGreaterThan(openingRate);
  });

  it('holds the assessed rate but lets the nominal requirement scale with live RWA', () => {
    const s = cloneBankState(initialState);
    const rate = s.risk.riskMetrics.pillar2ARate!;
    const before = s.risk.riskMetrics.pillar2AAmount!;
    expect(before).toBeCloseTo(rate * s.risk.riskMetrics.rwa, 4);

    const corporate = s.financial.balanceSheet.items.find(i => i.productType === AssetProductType.CorporateLoans)!;
    corporate.balance += 100e6;
    s.time.step = 3;
    const after = calculateRiskMetrics({ state: s, config: baseConfig });
    expect(after.pillar2ARate).toBeCloseTo(rate, 12);
    expect(after.pillar2AAmount).toBeCloseTo(rate * after.rwa, 4);
    expect(after.pillar2AAmount).not.toBe(before);
  });
});
''')

Path('src/engine/capitalBuffers.test.ts').write_text(r'''import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import {
  advanceOsiiAssessmentAtClose,
  calculateCapitalBufferFramework,
  initializeOpeningOsiiAssessment,
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
    expect(s.risk.osii).toBeUndefined();
  });

  it('growth above the domestic scope and UK LEM thresholds produces an O-SII buffer at opening assessment', () => {
    const s = makeLargeDomesticBank();
    initializeOpeningOsiiAssessment(s, baseConfig);
    const opening = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(opening.osiiInScope).toBe(true);
    expect(opening.osiiScopeRoute).toBe('largeDomesticBank');
    expect(opening.osiiRate).toBeCloseTo(0.01);
    expect(s.risk.osii?.effectiveYear).toBe(2026);
  });

  it('only mutates quarter-end history and the frozen O-SII rate at explicit closes', () => {
    const s = cloneBankState(initialState);
    s.risk.osii = undefined;
    initializeOpeningOsiiAssessment(s, baseConfig);
    expect(calculateCapitalBufferFramework({ state: s, config: baseConfig }).osiiRate).toBe(0);

    const retail = s.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailCurrentAccounts)!;
    const mortgages = s.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)!;
    retail.balance = 40e9;
    mortgages.balance = 230e9;

    for (const step of [2, 5, 8]) {
      s.time.step = step;
      const beforeRefresh = structuredClone(s.risk.osii!);
      const refreshed = calculateCapitalBufferFramework({ state: s, config: baseConfig });
      expect(refreshed.osiiRate).toBe(0);
      expect(s.risk.osii).toEqual(beforeRefresh);
      advanceOsiiAssessmentAtClose(s, baseConfig);
    }

    s.time.step = 11;
    const preClose = structuredClone(s.risk.osii!);
    const refresh = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(refresh.osiiRate).toBe(0);
    expect(s.risk.osii).toEqual(preClose);

    advanceOsiiAssessmentAtClose(s, baseConfig);
    const reviewed = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(reviewed.osiiRate).toBeGreaterThan(0);
    expect(s.risk.osii?.assessmentStep).toBe(12);
    expect(s.risk.osii?.nextAssessmentStep).toBe(24);
    expect(s.risk.osii?.quarterEndObservations.map((x) => x.step)).toEqual([3, 6, 9, 12]);
  });
});
''')

# Add the Tier 2 zero-balance regression to the existing requirement suite.
replace_once(
    'src/engine/tier2Requirement.test.ts',
    '''  it('restores the Tier 1 requirement when Tier 2 matures and keeps dashboard aligned', () => {
''',
    '''  it('caps recorded Tier 2 at zero when a classified line exists but is empty', () => {
    const s = cloneBankState(initialState);
    s.financial.capital.tier2 = 100;
    const line = s.financial.balanceSheet.items.find((item) => item.productType === LiabilityProductType.Tier2Debt)!;

    line.balance = 1;
    expect(eligibleTier2OwnFunds(s)).toBe(1);

    line.balance = 0;
    expect(eligibleTier2OwnFunds(s)).toBe(0);

    s.financial.balanceSheet.items = s.financial.balanceSheet.items.filter(
      (item) => item.productType !== LiabilityProductType.Tier2Debt
    );
    expect(eligibleTier2OwnFunds(s)).toBe(100);
  });

  it('restores the Tier 1 requirement when Tier 2 matures and keeps dashboard aligned', () => {
''',
)

# Negative CET1 must occupy a below-zero chart segment, not merely appear in the legend.
replace_once(
    'src/ui/leverageDashboardLayout.test.tsx',
    "import { baseConfig } from '../config/baseConfig';\n",
    "import { baseConfig } from '../config/baseConfig';\nimport { cloneBankState } from '../engine/clone';\n",
)
p = Path('src/ui/leverageDashboardLayout.test.tsx')
text = p.read_text()
text += r'''

it('renders negative CET1 below zero while retaining positive AT1 in the composition chart', () => {
  const state = cloneBankState(initialState);
  state.financial.capital.cet1 = -100e6;
  state.financial.capital.accumulatedOCI = 0;
  state.financial.capital.at1 = 250e6;

  const html = renderToStaticMarkup(
    <LeverageDashboard state={state} config={baseConfig} history={[state]} />
  );

  expect(html).toContain('leverage-zero-axis');
  const cet1Rect = html.match(/<rect[^>]*data-capital-component="CET1"[^>]*>/)?.[0] ?? '';
  const at1Rect = html.match(/<rect[^>]*data-capital-component="AT1"[^>]*>/)?.[0] ?? '';
  expect(cet1Rect).toContain('data-end-ratio="-');
  expect(at1Rect).toContain('data-start-ratio="-');
  expect(cet1Rect).toMatch(/height="(?!0(?:\.0+)?")[^"]+"/);
  expect(at1Rect).toMatch(/height="(?!0(?:\.0+)?")[^"]+"/);
});
'''
p.write_text(text)

# Cross-layer O-SII integration: supervisory close -> metrics/payout -> dashboard.
Path('src/ui/capitalBufferIntegration.test.tsx').write_text(r'''import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CapitalDashboard, { capitalDashboardData } from '../components/CapitalDashboard';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { advanceOsiiAssessmentAtClose } from '../engine/capitalBuffers';
import { cloneBankState } from '../engine/clone';
import { calculateRiskMetrics } from '../engine/metrics';
import { formatPct } from '../utils/formatters';

it('applies an O-SII increase consistently to requirements, payout restrictions and the capital dashboard', () => {
  const state = cloneBankState(initialState);
  const retail = state.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailCurrentAccounts)!;
  const mortgages = state.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)!;
  retail.balance = 40e9;
  mortgages.balance = 230e9;
  state.time.step = 11;
  state.time.date = new Date('2026-11-30T00:00:00Z');
  state.risk.osii = {
    assessedRate: 0,
    assessmentStep: 0,
    nextAssessmentStep: 12,
    effectiveYear: 2026,
    averageQuarterEndUkLeverageExposure: 0,
    inScopeAtAssessment: false,
    scopeRouteAtAssessment: 'belowCoreDepositThreshold',
    quarterEndObservations: [3, 6, 9].map((step) => ({
      step,
      date: `2026-${String(step).padStart(2, '0')}-01T00:00:00.000Z`,
      ukLeverageExposure: 230e9,
    })),
  };

  let before = calculateRiskMetrics({ state, config: baseConfig });
  state.financial.capital.accumulatedOCI = 0;
  state.financial.capital.cet1 = (before.cet1Requirement + 0.005) * before.rwa;
  before = calculateRiskMetrics({ state, config: baseConfig });
  state.risk.riskMetrics = before;

  expect(before.osiiBufferRate).toBe(0);
  expect(before.mdaTriggered).toBe(false);
  expect(before.maxPayoutRatio).toBeGreaterThan(0);
  const beforeDashboard = capitalDashboardData(state, baseConfig);
  expect(beforeDashboard.cards[0].requirement).toBeCloseTo(before.cet1Requirement, 12);

  advanceOsiiAssessmentAtClose(state, baseConfig);
  const after = calculateRiskMetrics({ state, config: baseConfig });
  state.risk.riskMetrics = after;

  expect(after.osiiBufferRate).toBeCloseTo(0.01);
  expect(after.combinedBufferRate).toBeCloseTo((before.combinedBufferRate ?? 0) + 0.01);
  expect(after.cet1Requirement).toBeCloseTo(before.cet1Requirement + 0.01, 12);
  expect(after.tier1Requirement).toBeCloseTo((before.tier1Requirement ?? 0) + 0.01, 12);
  expect(after.totalCapitalRequirement).toBeCloseTo((before.totalCapitalRequirement ?? 0) + 0.01, 12);
  expect(after.mdaTriggered).toBe(true);
  expect(after.maxPayoutRatio).toBe(0);

  const dashboard = capitalDashboardData(state, baseConfig);
  expect(dashboard.cards[0].requirement).toBeCloseTo(after.cet1Requirement, 12);
  expect(dashboard.cards[1].requirement).toBeCloseTo(after.tier1Requirement ?? NaN, 12);
  expect(dashboard.cards[2].requirement).toBeCloseTo(after.totalCapitalRequirement ?? NaN, 12);

  const html = renderToStaticMarkup(<CapitalDashboard state={state} config={baseConfig} />);
  expect(html).toContain(`O-SII buffer</td><td>${formatPct(after.osiiBufferRate ?? 0)}`);
  expect(html).toContain(`Bank policy payout cap: ${formatPct(after.maxPayoutRatio)}`);
  expect(html).toContain(`requirement ${formatPct(after.cet1Requirement)}`);
});
''')
