import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import { formatCurrency, formatPct } from '../../utils/formatters';

export type Pillar2AWaterfallBar = {
  label: string;
  lines: string[];
  start: number;
  end: number;
  delta: number;
  kind: 'positive' | 'total' | 'negative' | 'final';
};

const scopeLabel = (route: BankState['risk']['riskMetrics']['osiiScopeRoute']): string => {
  if (route === 'largeDomesticBank') return 'In scope · large domestic bank';
  if (route === 'ringFencedBankProxy') return 'In scope · ring-fenced-bank proxy';
  return 'Out of scope';
};

/**
 * Builds the Pillar 2A values and display projection shown by the GUI.
 * The API serializes the display projection; it does not read the underlying assessment independently.
 */
export const buildPillar2AAssessmentPresentation = (state: BankState, config: SimulationConfig) => {
  const assessment = state.risk.pillar2A;
  if (!assessment) return null;

  const effectiveRate = state.risk.riskMetrics.pillar2ARate ?? assessment.assessedRate;
  const totalOffset = assessment.ps1520.initialOffsetRate + assessment.ps1520.additionalOffsetRate;
  const configuredFloor = Math.max(0, config.riskLimits.pillar2A?.totalRatio ?? 0);
  const componentRows = [
    { label: 'SA credit-risk underestimation', lines: ['SA credit-risk', 'underestimation'], amount: assessment.components.creditRisk },
    { label: 'Single-name concentration', lines: ['Single-name', 'concentration'], amount: assessment.components.singleNameConcentration },
    { label: 'Sector concentration', lines: ['Sector', 'concentration'], amount: assessment.components.sectorConcentration },
    { label: 'Geographic concentration', lines: ['Geographic', 'concentration'], amount: assessment.components.geographicConcentration },
    { label: 'IRRBB', lines: ['IRRBB'], amount: assessment.components.irrbb },
  ].map((row) => ({
    ...row,
    assessmentRatio: assessment.assessmentRwa > 0 ? row.amount / assessment.assessmentRwa : 0,
  }));

  let running = 0;
  const waterfall: Pillar2AWaterfallBar[] = componentRows.map((row) => {
    const start = running;
    running += row.assessmentRatio;
    return { label: row.label, lines: row.lines, start, end: running, delta: row.assessmentRatio, kind: 'positive' };
  });
  const afterInitial = Math.max(0, assessment.grossRate - assessment.ps1520.initialOffsetRate);
  waterfall.push(
    { label: 'Gross variable P2A', lines: ['Gross variable', 'P2A'], start: 0, end: assessment.grossRate, delta: assessment.grossRate, kind: 'total' },
    { label: 'PS15/20 initial offset', lines: ['PS15/20', 'initial offset'], start: assessment.grossRate, end: afterInitial, delta: -assessment.ps1520.initialOffsetRate, kind: 'negative' },
    { label: 'PS15/20 additional small-bank offset', lines: ['PS15/20 additional', 'small-bank offset'], start: afterInitial, end: assessment.assessedRate, delta: -assessment.ps1520.additionalOffsetRate, kind: 'negative' },
    {
      label: configuredFloor > assessment.assessedRate + 1e-10 ? 'Effective P2A' : 'Assessed variable P2A',
      lines: configuredFloor > assessment.assessedRate + 1e-10 ? ['Effective P2A', '(scenario floor)'] : ['Assessed variable', 'P2A'],
      start: 0, end: effectiveRate, delta: effectiveRate, kind: 'final',
    },
  );

  const detailRows = [
    ...componentRows.map((row) => ({ label: row.label, amount: row.amount, ratio: row.assessmentRatio })),
    { label: 'Gross variable P2A', amount: assessment.grossRate * assessment.assessmentRwa, ratio: assessment.grossRate },
    { label: 'PS15/20 initial offset', amount: -assessment.ps1520.initialOffsetRate * assessment.assessmentRwa, ratio: -assessment.ps1520.initialOffsetRate },
    { label: 'PS15/20 additional small-bank offset', amount: -assessment.ps1520.additionalOffsetRate * assessment.assessmentRwa, ratio: -assessment.ps1520.additionalOffsetRate },
    { label: 'Assessed variable P2A', amount: assessment.assessedRate * assessment.assessmentRwa, ratio: assessment.assessedRate },
    ...(configuredFloor > assessment.assessedRate + 1e-10
      ? [{ label: 'Scenario/manual P2A floor', amount: configuredFloor * assessment.assessmentRwa, ratio: configuredFloor }]
      : []),
  ];

  const chartMaxRaw = Math.max(0.04, assessment.grossRate * 1.18, effectiveRate * 1.18);
  const chartMax = Math.ceil(chartMaxRaw / 0.01) * 0.01;
  const chartTicks = Array.from({ length: 5 }, (_, i) => chartMax * i / 4);
  const chartBars = waterfall.map((bar) => ({
    label: bar.label,
    lines: bar.lines,
    value: bar.kind === 'negative'
      ? `−${formatPct(Math.abs(bar.delta))}`
      : bar.kind === 'positive'
        ? `+${formatPct(bar.delta)}`
        : formatPct(bar.end),
  }));
  const assessmentDateLabel = new Date(assessment.assessmentDate).toLocaleDateString();
  const summary = {
    effectiveRate,
    currentAmount: effectiveRate * state.risk.riskMetrics.rwa,
    monthsToReview: Math.max(0, assessment.nextAssessmentStep - state.time.step),
    totalOffset,
  };
  const drivers = {
    assessmentDate: assessment.assessmentDate,
    assessmentRwa: assessment.assessmentRwa,
    ukCcybPassThroughRate: assessment.ps1520.ukCcybPassThroughRate,
    totalOffset,
    singleNameHhi: assessment.concentration.singleNameHhi,
    sectorHhi: assessment.concentration.sectorHhi,
    geographicHhi: assessment.concentration.geographicHhi,
    worstLoss200bp: assessment.irrbb.worstLoss200bp,
    policyLimit: assessment.irrbb.policyLimit,
    capitalConversionFactor: assessment.irrbb.capitalConversionFactor,
  };
  const methodologyNote = "BankSim uses the PRA's published concentration HHI ranges and PS15/20 offset mechanics. The equal-obligor single-name approximation, automatic low-risk/MREL eligibility, and IRRBB capitalisation scalar are explicit game simplifications where public policy does not provide a complete mechanical calculation.";

  return {
    summary,
    waterfall,
    chartMax,
    chartTicks,
    detailRows,
    drivers,
    methodologyNote,
    /** Exact text rendered by React and safe for the player API at GUI precision. */
    display: {
      summary: {
        effectiveRate: formatPct(summary.effectiveRate),
        currentAmount: formatCurrency(summary.currentAmount),
        nextReview: summary.monthsToReview === 0 ? 'Next close' : `${summary.monthsToReview}m`,
      },
      chart: {
        axisTitle: '% of RWA',
        axisTickLabels: chartTicks.map((tick) => formatPct(tick, 0)),
        ariaLabel: `Pillar 2A assessment: gross ${formatPct(assessment.grossRate)}, offsets ${formatPct(totalOffset)}, assessed ${formatPct(effectiveRate)}`,
        bars: chartBars,
      },
      detailRows: detailRows.map((row) => {
        const offset = row.label.startsWith('PS15/20');
        return {
          label: row.label,
          amount: `${offset && row.amount < 0 ? '−' : ''}${formatCurrency(Math.abs(row.amount))}`,
          ratio: `${offset && row.ratio < 0 ? '−' : ''}${formatPct(Math.abs(row.ratio))}`,
          total: row.label === 'Gross variable P2A' || row.label === 'Assessed variable P2A',
        };
      }),
      drivers: [
        { label: 'Assessment date', value: assessmentDateLabel },
        { label: 'Assessment RWA', value: formatCurrency(drivers.assessmentRwa) },
        { label: 'UK CCyB pass-through', value: formatPct(drivers.ukCcybPassThroughRate) },
        { label: 'Total PS15/20 offset', value: formatPct(drivers.totalOffset) },
        { label: 'Single-name HHI', value: formatPct(drivers.singleNameHhi) },
        { label: 'Sector HHI', value: formatPct(drivers.sectorHhi) },
        { label: 'Geographic HHI', value: formatPct(drivers.geographicHhi) },
        { label: 'Worst ±200bp EVE loss', value: formatCurrency(drivers.worstLoss200bp) },
        { label: 'Board IRRBB EVE limit', value: formatCurrency(drivers.policyLimit) },
        { label: 'IRRBB capitalisation scalar', value: formatPct(drivers.capitalConversionFactor) },
      ],
      methodologyNote,
    },
  };
};

/** Builds the combined-buffer detail and O-SII threshold values rendered in the GUI. */
export const buildCapitalBuffersPresentation = (state: BankState, config: SimulationConfig) => {
  const metrics = state.risk.riskMetrics;
  const conservation = metrics.capitalConservationBufferRate ?? config.riskLimits.capitalBufferStack.conservationBuffer;
  const ccyb = metrics.countercyclicalBufferRate ?? config.riskLimits.capitalBufferStack.countercyclicalBuffer;
  const osii = metrics.osiiBufferRate ?? config.riskLimits.capitalBufferStack.systemicBuffer;
  const combined = metrics.combinedBufferRate ?? conservation + ccyb + osii;
  const coreThreshold = 35e9;
  const currentLem = metrics.osiiCurrentUkLeverageExposure ?? 0;
  const nextThreshold = metrics.osiiNextThreshold;
  const headroom = nextThreshold === undefined ? undefined : Math.max(0, nextThreshold - currentLem);
  const progressPct = nextThreshold && nextThreshold > 0 ? Math.max(0, Math.min(100, currentLem / nextThreshold * 100)) : 100;
  const inScope = metrics.osiiScopeRoute === 'largeDomesticBank' || metrics.osiiScopeRoute === 'ringFencedBankProxy';
  const rows = [
    { label: 'Capital conservation buffer', short: 'CCoB', ratio: conservation },
    { label: 'Institution-specific CCyB', short: 'CCyB', ratio: ccyb },
    { label: 'O-SII buffer', short: 'O-SII', ratio: osii },
  ].map((row) => ({ ...row, amount: row.ratio * metrics.rwa }));

  const total = { ratio: combined, amount: combined * metrics.rwa };
  const details = {
      ukCountercyclicalBufferRate: metrics.ukCountercyclicalBufferRate ?? ccyb,
      ukRelevantCreditRwaShare: metrics.ukRelevantCreditRwaShare ?? 1,
      conservation,
      ccyb,
      osii,
  };
  const thresholdMethodologyNote = 'O-SII is assessed annually from the trailing four quarter-end UK leverage exposure measures. BankSim applies a newly assessed rate at its annual review.';
  const monthsToReview = Math.max(0, (metrics.osiiNextAssessmentStep ?? state.time.step) - state.time.step);
  const thresholdScheduleYear = metrics.osiiThresholdScheduleYear ?? 2027;
  const osiiThreshold = {
      scopeRoute: metrics.osiiScopeRoute,
      scopeLabel: scopeLabel(metrics.osiiScopeRoute),
      inScope,
      coreDeposits: metrics.osiiCoreDeposits ?? 0,
      coreThreshold,
      currentLem,
      trailingLem: metrics.osiiTrailingAverageUkLeverageExposure ?? currentLem,
      assessedAverageLem: metrics.osiiAssessedAverageUkLeverageExposure ?? 0,
      nextThreshold,
      nextThresholdRate: metrics.osiiNextThresholdRate ?? 0,
      headroom,
      progressPct,
      monthsToReview,
      thresholdScheduleYear,
      methodologyNote: thresholdMethodologyNote,
  };
  const thresholdLabel = nextThreshold === undefined ? 'Top bucket' : formatCurrency(nextThreshold);
  const thresholdDetails = [
    { label: 'Current scope', value: osiiThreshold.scopeLabel },
    { label: 'Core deposits', value: `${formatCurrency(osiiThreshold.coreDeposits)} / ${formatCurrency(osiiThreshold.coreThreshold)} scope threshold` },
    { label: 'Current UK leverage exposure', value: formatCurrency(osiiThreshold.currentLem) },
    { label: 'Trailing quarter-end average', value: formatCurrency(osiiThreshold.trailingLem) },
    { label: 'Average used at last rate setting', value: formatCurrency(osiiThreshold.assessedAverageLem) },
    { label: 'Next O-SII threshold', value: nextThreshold === undefined ? 'Top bucket reached' : `${formatCurrency(nextThreshold)} → ${formatPct(osiiThreshold.nextThresholdRate)}` },
    ...(headroom === undefined ? [] : [{ label: 'Headroom to next threshold', value: formatCurrency(headroom) }]),
    { label: 'Next annual rate setting', value: monthsToReview === 0 ? 'Next close' : `${monthsToReview}m` },
    { label: 'Threshold schedule', value: `${thresholdScheduleYear} framework` },
  ];

  return {
    total,
    rows,
    details,
    osiiThreshold,
    /** Exact text rendered by React and safe for the player API at GUI precision. */
    display: {
      total: { ratio: formatPct(total.ratio), amount: formatCurrency(total.amount) },
      rows: rows.map((row) => ({ label: row.label, ratio: formatPct(row.ratio), amount: formatCurrency(row.amount) })),
      details: [
        { label: 'Current UK CCyB rate', value: formatPct(details.ukCountercyclicalBufferRate) },
        { label: 'UK relevant credit RWA share', value: formatPct(details.ukRelevantCreditRwaShare) },
        { label: 'Capital conservation buffer', value: formatPct(details.conservation) },
        { label: 'Institution-specific countercyclical buffer', value: formatPct(details.ccyb) },
        { label: 'O-SII buffer', value: formatPct(details.osii) },
      ],
      threshold: {
        scopeLabel: osiiThreshold.scopeLabel,
        inScopeLabel: inScope ? 'In scope' : 'Out of scope',
        currentLem: formatCurrency(currentLem),
        threshold: thresholdLabel,
        headroom: headroom === undefined ? '—' : formatCurrency(headroom),
        startLabel: '£0bn',
        currentProgressLabel: `${formatCurrency(currentLem)}${nextThreshold ? ` (${progressPct.toFixed(1)}%)` : ''}`,
        progressPct: `${progressPct.toFixed(1)}%`,
        endLabel: nextThreshold === undefined ? 'Top bucket reached' : `${formatCurrency(nextThreshold)} threshold`,
        details: thresholdDetails,
        methodologyNote: thresholdMethodologyNote,
      },
    },
  };
};
