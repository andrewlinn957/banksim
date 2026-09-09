import { useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide, AssetProductType } from '../domain/enums';
import { eligibleCet1, centralBankExclusion, committedExposure } from '../engine/prudential';
import { hedgeExposures } from '../engine/hedgeValuation';
import { calculateRiskMetrics } from '../engine/metrics';
import { formatCurrency, formatPct } from '../utils/formatters';
import TimeSeriesChart from './TimeSeriesChart';
import './LeverageDashboard.css';

export function leverageDashboardData(state: BankState, config: SimulationConfig) {
  const assets = state.financial.balanceSheet.items.filter(i => i.side === BalanceSheetSide.Asset);
  const book = assets.reduce((n, i) => n + i.balance, 0);
  const derivativeBook = assets.find(i => i.productType === AssetProductType.DerivativeAssets)?.balance ?? 0;
  const derivatives = hedgeExposures(state).leverage;
  const reserves = centralBankExclusion(state);
  const commitments = committedExposure(state) * 0.2;
  const metrics = calculateRiskMetrics({ state, config });
  const exposure = metrics.leverageExposure;
  const cet1 = eligibleCet1(state, config);
  const at1 = state.financial.capital.at1;
  const tier1 = cet1 + at1;
  const inScope = metrics.leverageFrameworkInScope ?? false;
  const minimum = metrics.leverageBaseRate ?? config.riskLimits.minLeverageRatio;
  const minimumCet1 = minimum * (metrics.leverageMinimumCet1Share ?? 0.75);
  const minimumAt1Eligible = Math.max(0, minimum - minimumCet1);
  const cclb = metrics.leverageCclbRate ?? 0;
  const alrb = metrics.leverageAlrbRate ?? 0;
  const cclbIndicative = metrics.leverageCclbIndicativeRate ?? 0;
  const alrbIndicative = metrics.leverageAlrbIndicativeRate ?? 0;
  const indicativeThreshold = minimum + cclbIndicative + alrbIndicative;
  const threshold = metrics.leverageApplicableThresholdRate ?? minimum;
  const cet1Threshold = metrics.leverageCet1ThresholdRate ?? minimumCet1;
  const target = Math.max(threshold, state.behaviour.riskAppetite?.leverage ?? threshold * 1.05);
  const ratio = metrics.leverageRatio;
  const leverageCet1Ratio = metrics.leverageCet1Ratio ?? (exposure > 0 ? cet1 / exposure : NaN);
  const hardMinimumBreached = inScope && (ratio < minimum || leverageCet1Ratio < minimumCet1);
  const required = exposure * threshold;
  const baseRequired = exposure * minimum;
  const cet1Required = exposure * cet1Threshold;
  const targetRequired = exposure * target;
  const limit = threshold > 0 ? Math.max(0, tier1 / threshold) : NaN;
  const internalLimit = target > 0 ? Math.max(0, tier1 / target) : NaN;

  return {
    cet1,
    at1,
    tier1,
    exposure,
    minimum,
    minimumCet1,
    minimumAt1Eligible,
    threshold,
    indicativeThreshold,
    cet1Threshold,
    target,
    ratio,
    leverageCet1Ratio,
    hardMinimumBreached,
    required,
    baseRequired,
    cet1Required,
    targetRequired,
    surplus: tier1 - required,
    cet1Surplus: cet1 - cet1Required,
    limit,
    internalLimit,
    inScope,
    scopeRoute: metrics.leverageFrameworkScopeRoute ?? 'belowThresholds',
    expectationMissed: metrics.leverageExpectationMissed ?? false,
    bufferShortfall: metrics.leverageBufferShortfall ?? false,
    cclb,
    alrb,
    cclbIndicative,
    alrbIndicative,
    retailDeposits: metrics.leverageRetailDeposits ?? 0,
    averageRetailDeposits: metrics.leverageRetailDepositsThreeYearAverage ?? 0,
    nonUkAssets: metrics.leverageNonUkAssets ?? 0,
    averageNonUkAssets: metrics.leverageNonUkAssetsThreeYearAverage ?? 0,
    retailDepositsThreshold: metrics.leverageRetailDepositThreshold ?? 75e9,
    nonUkAssetsThreshold: metrics.leverageNonUkAssetThreshold ?? 10e9,
    nextAssessmentStep: metrics.leverageFrameworkNextAssessmentStep,
    exposureRows: [
      { label: 'On-balance-sheet assets', value: book },
      { label: 'Remove derivative book assets', value: -derivativeBook },
      { label: 'Add prudential derivative exposure', value: derivatives },
      { label: 'Eligible central bank reserves exclusion', value: -reserves },
      { label: 'Undrawn commitments × 20% CCF', value: commitments },
    ],
  };
}

const signedMoney = (n: number) =>
  Number.isFinite(n) ? `${n < 0 ? '−' : '+'}${formatCurrency(Math.abs(n))}` : 'N/A';

const pp = (n: number) =>
  Number.isFinite(n) ? `${n < 0 ? '' : '+'}${(n * 100).toFixed(2)}pp` : 'N/A';

const distinctTarget = (threshold: number, target: number) =>
  Number.isFinite(target) && Math.abs(target - threshold) > 1e-10 ? target : undefined;

const signedPct = (n: number) =>
  Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%` : 'N/A';

const pctOfThreshold = (value: number, threshold: number) =>
  threshold > 0 ? Math.max(0, value / threshold) : 0;

function Gauge({
  actual,
  threshold,
  target,
  money = false,
  thresholdLabel,
  targetLabel,
}: {
  actual: number;
  threshold: number;
  target?: number;
  money?: boolean;
  thresholdLabel: string;
  targetLabel?: string;
}) {
  const max = Math.max(
    money ? 1 : 0.06,
    Number.isFinite(actual) ? Math.max(0, actual) * 1.18 : 0,
    Number.isFinite(threshold) ? Math.max(0, threshold) * 1.18 : 0,
    Number.isFinite(target) ? Math.max(0, target ?? 0) * 1.18 : 0
  );
  const x = (n: number) => 8 + (384 * Math.max(0, Math.min(max, n))) / max;
  const display = (n: number) => (money ? formatCurrency(n) : formatPct(n));

  return (
    <svg
      className="capital-bullet leverage-gauge"
      viewBox="0 0 400 58"
      role="img"
      aria-label={`Actual ${display(actual)}; ${thresholdLabel} ${display(threshold)}${
        target !== undefined && targetLabel ? `; ${targetLabel} ${display(target)}` : ''
      }`}
    >
      <rect x="8" y="10" width="384" height="18" rx="5" fill="var(--border)" />
      <rect
        x="8"
        y="10"
        width={Number.isFinite(actual) ? x(actual) - 8 : 0}
        height="18"
        rx="5"
        fill="currentColor"
      />
      {Number.isFinite(threshold) && (
        <path d={`M${x(threshold)} 5v28`} stroke="#164f91" strokeWidth="2.5" strokeDasharray="5 3" />
      )}
      {target !== undefined && Number.isFinite(target) && (
        <path
          d={`M${x(target)} 5v28`}
          stroke="#d81b78"
          strokeWidth="2"
          strokeDasharray="3 3"
        />
      )}
      {[0, 1, 2, 3, 4].map(i => (
        <text
          key={i}
          x={8 + i * 96}
          y="51"
          textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
        >
          {money ? `${((max * i) / 4 / 1e9).toFixed(1)}bn` : formatPct((max * i) / 4, 1)}
        </text>
      ))}
    </svg>
  );
}

interface SummaryValue {
  label: string;
  value: string;
  valueClass?: string;
}

function SummaryCard({
  title,
  status,
  shortfall,
  headline,
  headlineLabel = 'Actual',
  secondary,
  footer = [],
  gauge,
}: {
  title: string;
  status: string;
  shortfall: boolean;
  headline: string;
  headlineLabel?: string;
  secondary: SummaryValue[];
  footer?: SummaryValue[];
  gauge: {
    actual: number;
    threshold: number;
    target?: number;
    money?: boolean;
    thresholdLabel: string;
    targetLabel?: string;
  };
}) {
  return (
    <article className={`capital-card leverage-summary-card ${shortfall ? 'shortfall' : ''}`}>
      <header>
        <h3>{title}</h3>
        <span className="capital-status">{status}</span>
      </header>
      <div className="capital-ratios">
        <div>
          <strong>{headline}</strong>
          <span>{headlineLabel}</span>
        </div>
        {secondary.map(item => (
          <div key={item.label}>
            <b className={item.valueClass}>{item.value}</b>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <Gauge {...gauge} />
      <div className="leverage-marker-key" aria-hidden="true">
        <span className="actual-marker"><i />Actual</span>
        <span><i className="leverage-marker-swatch" />{gauge.thresholdLabel}</span>
        {gauge.target !== undefined && gauge.targetLabel && (
          <span><i className="leverage-marker-swatch target" />{gauge.targetLabel}</span>
        )}
      </div>
      {footer.length > 0 && (
        <div className="capital-amounts leverage-summary-footer">
          {footer.map(item => (
            <div key={item.label}>
              <b className={item.valueClass}>{item.value}</b>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

type RequirementView = 'ratio' | 'amount';
interface RequirementSegment {
  label: string;
  rate: number;
  color: string;
}

function RequirementBar({
  title,
  totalRate,
  exposure,
  segments,
  view,
}: {
  title: string;
  totalRate: number;
  exposure: number;
  segments: RequirementSegment[];
  view: RequirementView;
}) {
  const value = (rate: number) => view === 'ratio' ? formatPct(rate) : formatCurrency(rate * exposure);
  return (
    <div className="leverage-requirement-row">
      <div className="leverage-requirement-row-heading">
        <h4>{title}</h4>
        <strong>{formatPct(totalRate)} / {formatCurrency(totalRate * exposure)}</strong>
      </div>
      <div className="leverage-requirement-bar" role="img" aria-label={`${title}: ${formatPct(totalRate)}`}>
        {segments.map(segment => (
          <div
            key={segment.label}
            className={`leverage-requirement-segment ${segment.rate === 0 ? 'zero' : ''}`}
            style={{ background: segment.color, flexGrow: segment.rate, flexBasis: segment.rate === 0 ? 54 : 0 }}
            data-requirement-segment={segment.label}
          >
            <b>{value(segment.rate)}</b>
            {view === 'ratio' && segment.rate > 0.001 && <small>{formatCurrency(segment.rate * exposure)}</small>}
          </div>
        ))}
      </div>
      <ul className="leverage-requirement-legend">
        {segments.map(segment => (
          <li key={segment.label}>
            <i style={{ background: segment.color }} />
            <span>{segment.label}</span>
            <strong>{value(segment.rate)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScopeProgress({ label, value, threshold }: { label: string; value: number; threshold: number }) {
  const share = pctOfThreshold(value, threshold);
  return (
    <div className="leverage-scope-progress">
      <div className="leverage-scope-progress-heading">
        <strong>{label}</strong>
        <span>{formatCurrency(value)} / {formatCurrency(threshold)}</span>
        <b>{(share * 100).toFixed(1)}%</b>
      </div>
      <div className="leverage-scope-track" aria-label={`${label}: ${(share * 100).toFixed(1)}% of threshold`}>
        <i style={{ width: `${Math.min(100, share * 100)}%` }} />
      </div>
      <div className="leverage-scope-scale" aria-hidden="true">
        <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
      </div>
    </div>
  );
}

const exposureLabelLines = (label: string): string[] => {
  const map: Record<string, string[]> = {
    'On-balance-sheet assets': ['On-balance-', 'sheet assets'],
    'Remove derivative book assets': ['Remove', 'derivative book', 'assets'],
    'Add prudential derivative exposure': ['Add prudential', 'derivative', 'exposure'],
    'Eligible central bank reserves exclusion': ['Eligible central', 'bank reserves', 'exclusion'],
    'Undrawn commitments × 20% CCF': ['Undrawn', 'commitments', '× 20% CCF'],
    'Total leverage exposure': ['Total leverage', 'exposure'],
  };
  return map[label] ?? [label];
};

function ExposureWaterfall({ rows, total }: { rows: Array<{ label: string; value: number }>; total: number }) {
  const running: Array<{ label: string; value: number; start: number; end: number }> = [];
  let cumulative = 0;
  rows.forEach(row => {
    const start = cumulative;
    cumulative += row.value;
    running.push({ ...row, start, end: cumulative });
  });
  const allValues = [0, total, ...running.flatMap(row => [row.start, row.end])];
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const padding = Math.max(0.5e9, (maxValue - minValue) * 0.12);
  const domainMin = Math.min(0, minValue - padding * 0.25);
  const domainMax = Math.max(1, maxValue + padding);
  const y = (value: number) => 235 - ((value - domainMin) / Math.max(1, domainMax - domainMin)) * 185;
  const chartRows = [...running, { label: 'Total leverage exposure', value: total, start: 0, end: total }];
  const xFor = (index: number) => 72 + index * 101;

  return (
    <svg className="leverage-waterfall" viewBox="0 0 690 315" role="img" aria-label={`Leverage exposure reconciliation to ${formatCurrency(total)}`}>
      {[0, 0.25, 0.5, 0.75, 1].map(fraction => {
        const value = domainMin + (domainMax - domainMin) * fraction;
        return (
          <g key={fraction}>
            <path d={`M45 ${y(value)}H662`} stroke="var(--border)" />
            <text x="38" y={y(value) + 4} textAnchor="end">{(value / 1e9).toFixed(0)}</text>
          </g>
        );
      })}
      <text transform="translate(13 145) rotate(-90)" textAnchor="middle">£bn</text>
      {chartRows.map((row, index) => {
        const x = xFor(index);
        const isTotal = index === chartRows.length - 1;
        const top = y(Math.max(row.start, row.end));
        const bottom = y(Math.min(row.start, row.end));
        const height = Math.max(2, bottom - top);
        const color = isTotal ? '#18528b' : row.value < 0 ? '#ef476f' : row.value > 0 ? '#3b9ee5' : '#9bb9cf';
        const labelY = Math.max(16, top - 9);
        return (
          <g key={row.label} data-exposure-row={row.label}>
            {index > 0 && !isTotal && <path d={`M${x - 48} ${y(row.start)}H${x - 20}`} stroke="#9fc0d6" strokeDasharray="3 3" />}
            {Math.abs(row.value) < 1 ? (
              <path d={`M${x - 28} ${y(row.end)}H${x + 28}`} stroke={color} strokeWidth="3" />
            ) : (
              <rect x={x - 28} y={top} width="56" height={height} fill={color} rx="2" />
            )}
            <text x={x} y={labelY} textAnchor="middle" className={row.value < 0 ? 'negative' : ''}>
              {row.value < 0 && !isTotal ? '−' : ''}{formatCurrency(Math.abs(row.value))}
            </text>
            <text x={x} y="267" textAnchor="middle" className="waterfall-axis-label">
              {exposureLabelLines(row.label).map((line, lineIndex) => (
                <tspan key={line} x={x} dy={lineIndex === 0 ? 0 : 13}>{line}</tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function LeverageDashboard({
  state,
  config,
  history,
}: {
  state: BankState;
  config: SimulationConfig;
  history: BankState[];
}) {
  const [requirementView, setRequirementView] = useState<RequirementView>('ratio');
  const d = leverageDashboardData(state, config);
  const frameworkLabel = d.inScope ? 'Requirement' : 'Expectation';
  const gap = d.ratio - d.threshold;
  const status = !Number.isFinite(d.ratio)
    ? 'Unavailable'
    : d.inScope
      ? d.hardMinimumBreached
        ? 'Below minimum'
        : d.bufferShortfall
          ? 'Buffer shortfall'
          : 'Meets requirement'
      : d.expectationMissed
        ? 'Below expectation'
        : 'Expectation met';
  const shortfall = d.inScope ? d.hardMinimumBreached || d.bufferShortfall : d.expectationMissed;
  const spare = d.limit - d.exposure;
  const ratioTarget = distinctTarget(d.threshold, d.target);
  const capitalTarget = distinctTarget(d.required, d.targetRequired);
  const exposureTarget = distinctTarget(d.limit, d.internalLimit);
  const parts = [
    { label: 'CET1', value: d.cet1, color: '#18528b' },
    { label: 'AT1', value: d.at1, color: '#369bdf' },
  ];

  let cumulative = 0;
  const positionedParts = parts.map(part => {
    const start = cumulative;
    cumulative += d.exposure > 0 ? part.value / d.exposure : 0;
    return { ...part, start, end: cumulative };
  });
  const compositionMin = Math.min(0, ...positionedParts.flatMap(part => [part.start, part.end]));
  const compositionMax = Math.max(0, ...positionedParts.flatMap(part => [part.start, part.end]));
  const chartMin = compositionMin < 0 ? Math.floor((compositionMin * 1.15) / 0.01) * 0.01 : 0;
  const chartMax = Math.ceil(
    Math.max(0.09, d.target * 1.18, d.ratio * 1.12, compositionMax * 1.12) / 0.01
  ) * 0.01;
  const chartRange = Math.max(0.01, chartMax - chartMin);
  const chartY = (n: number) => 252 - ((n - chartMin) / chartRange) * 202;
  const ticks = Array.from({ length: 5 }, (_, i) => chartMin + (chartRange * i) / 4);
  const scopeName = d.inScope ? 'In scope' : 'Expectation only';
  const bufferThreshold = d.inScope ? d.threshold : d.indicativeThreshold;
  const bufferCclb = d.inScope ? d.cclb : d.cclbIndicative;
  const bufferAlrb = d.inScope ? d.alrb : d.alrbIndicative;
  const requirementSegments: RequirementSegment[] = [
    { label: 'CET1 minimum', rate: d.minimumCet1, color: '#1768ac' },
    { label: 'AT1 eligible', rate: d.minimumAt1Eligible, color: '#3ea5e7' },
  ];
  const bufferSegments: RequirementSegment[] = [
    ...requirementSegments,
    { label: 'CCLB (CET1 only)', rate: bufferCclb, color: '#c780df' },
    { label: 'ALRB (CET1 only)', rate: bufferAlrb, color: '#cbd7e1' },
  ];

  const historyWithCurrent = history.length === 0
    ? [state]
    : history[history.length - 1]?.time.step === state.time.step
      ? history
      : [...history, state];
  const currentExposure = d.exposure;
  const qoqTargetStep = state.time.step - 3;
  const qoqBase = [...historyWithCurrent].reverse().find(s => s.time.step <= qoqTargetStep) ?? historyWithCurrent[0];
  const qoqBaseExposure = qoqBase?.risk.riskMetrics.leverageExposure ?? currentExposure;
  const qoqChange = currentExposure - qoqBaseExposure;
  const qoqPct = qoqBaseExposure > 0 ? qoqChange / qoqBaseExposure : NaN;

  return (
    <div className="capital-dashboard leverage-dashboard">
      <div className="capital-cards leverage-top-cards">
        <SummaryCard
          title="Leverage ratio"
          status={status}
          shortfall={shortfall}
          headline={formatPct(d.ratio)}
          secondary={[
            { label: frameworkLabel, value: formatPct(d.threshold) },
            { label: 'Headroom', value: pp(gap), valueClass: 'capital-gap' },
          ]}
          gauge={{
            actual: d.ratio,
            threshold: d.threshold,
            target: ratioTarget,
            thresholdLabel: frameworkLabel,
            targetLabel: 'Internal target',
          }}
        />

        <SummaryCard
          title="Tier 1 capital"
          status={status}
          shortfall={shortfall}
          headline={formatCurrency(d.tier1)}
          secondary={[
            { label: frameworkLabel, value: formatCurrency(d.required) },
            { label: 'Headroom', value: signedMoney(d.surplus), valueClass: 'capital-gap' },
          ]}
          gauge={{
            actual: d.tier1,
            threshold: d.required,
            target: capitalTarget,
            money: true,
            thresholdLabel: frameworkLabel,
            targetLabel: 'Internal target',
          }}
          footer={[
            { label: 'Actual leverage ratio', value: formatPct(d.ratio) },
            { label: frameworkLabel, value: formatPct(d.threshold) },
            { label: 'Ratio headroom', value: pp(gap), valueClass: 'capital-gap' },
          ]}
        />

        <SummaryCard
          title="Leverage exposure"
          status={status}
          shortfall={shortfall}
          headline={formatCurrency(d.exposure)}
          secondary={[
            { label: 'Implied limit', value: formatCurrency(d.limit) },
            { label: 'Headroom', value: signedMoney(spare), valueClass: 'capital-gap' },
          ]}
          gauge={{
            actual: d.exposure,
            threshold: d.limit,
            target: exposureTarget,
            money: true,
            thresholdLabel: d.inScope ? 'Requirement limit' : 'Expectation limit',
            targetLabel: 'Internal target',
          }}
          footer={[
            { label: 'Actual leverage ratio', value: formatPct(d.ratio) },
            { label: frameworkLabel, value: formatPct(d.threshold) },
            {
              label: 'Spare exposure capacity',
              value: d.exposure > 0 ? formatPct(spare / d.exposure) : 'N/A',
              valueClass: 'capital-gap',
            },
          ]}
        />
      </div>

      <div className="leverage-primary-grid">
        <section className="capital-card leverage-position-card">
          <div className="leverage-card-heading">
            <div><h3>Leverage position</h3><p>Composition of Tier 1 capital versus leverage thresholds</p></div>
            <div className="leverage-heading-total"><span>Total Tier 1 held</span><strong>{formatCurrency(d.tier1)} ({formatPct(d.ratio)})</strong></div>
          </div>
          {d.exposure > 0 ? (
            <svg
              className="leverage-position-chart"
              viewBox="0 0 620 330"
              role="img"
              aria-label={`Leverage position: CET1 ${formatPct(d.leverageCet1Ratio)}, AT1 ${formatPct(d.at1 / d.exposure)}, minimum ${formatPct(d.minimum)}, minimum CET1 ${formatPct(d.minimumCet1)}`}
            >
              {ticks.map(tick => (
                <g key={tick}>
                  <path d={`M48 ${chartY(tick)}H335`} stroke="var(--border)" />
                  <text x="39" y={chartY(tick) + 4} textAnchor="end">{formatPct(tick, 1)}</text>
                </g>
              ))}
              {chartMin < 0 && <path className="leverage-zero-axis" d={`M48 ${chartY(0)}H335`} stroke="var(--text)" strokeWidth="1.5" />}
              <text transform="translate(13 158) rotate(-90)" textAnchor="middle">% of leverage exposure</text>
              {positionedParts.map(part => {
                const top = chartY(Math.max(part.start, part.end));
                const height = Math.abs(chartY(part.start) - chartY(part.end));
                const segmentRatio = d.exposure > 0 ? part.value / d.exposure : 0;
                return (
                  <g key={part.label}>
                    <rect
                      x="100"
                      y={top}
                      width="185"
                      height={height}
                      fill={part.color}
                      data-capital-component={part.label}
                      data-start-ratio={part.start}
                      data-end-ratio={part.end}
                    />
                    {height > 26 && (
                      <text x="192.5" y={top + height / 2 - 4} textAnchor="middle" className="stack-label">
                        {part.label}
                        <tspan x="192.5" dy="17">{formatPct(segmentRatio)} ({formatCurrency(part.value)})</tspan>
                      </text>
                    )}
                  </g>
                );
              })}
              <path d={`M48 ${chartY(d.target)}H355L382 ${chartY(d.target)}`} fill="none" stroke="#d81b78" strokeWidth="2" strokeDasharray="4 3" />
              <text x="394" y={chartY(d.target) - 7} className="threshold-label target">Internal leverage target</text>
              <text x="394" y={chartY(d.target) + 12} className="threshold-value target">{formatPct(d.target)}</text>
              <text x="394" y={chartY(d.target) + 29} className="threshold-amount">{formatCurrency(d.targetRequired)} Tier 1</text>

              <path d={`M48 ${chartY(d.minimum)}H355L382 ${chartY(d.minimum)}`} fill="none" stroke="#164f91" strokeWidth="2" strokeDasharray="6 4" />
              <text x="394" y={chartY(d.minimum) - 7} className="threshold-label">{d.inScope ? 'Minimum Tier 1 requirement' : 'Minimum Tier 1 expectation'}</text>
              <text x="394" y={chartY(d.minimum) + 12} className="threshold-value">{formatPct(d.minimum)}</text>
              <text x="394" y={chartY(d.minimum) + 29} className="threshold-amount">{formatCurrency(d.baseRequired)} Tier 1</text>

              <path d={`M48 ${chartY(d.minimumCet1)}H355L382 ${chartY(d.minimumCet1)}`} fill="none" stroke="#62a8db" strokeWidth="2" strokeDasharray="3 3" />
              <text x="394" y={chartY(d.minimumCet1) - 7} className="threshold-label cet1">Minimum CET1 component</text>
              <text x="394" y={chartY(d.minimumCet1) + 12} className="threshold-value cet1">{formatPct(d.minimumCet1)}</text>
              <text x="394" y={chartY(d.minimumCet1) + 29} className="threshold-amount">{formatCurrency(d.minimumCet1 * d.exposure)}</text>

              <text x="192.5" y="304" textAnchor="middle" fontWeight="700">Tier 1 capital ({formatPct(d.ratio)})</text>
            </svg>
          ) : <p>Ratio composition is unavailable without positive leverage exposure.</p>}
          <ul className="capital-legend leverage-position-legend">
            {parts.map(part => (
              <li key={part.label}><i style={{ background: part.color }} />{part.label} · {formatCurrency(part.value)} ({formatPct(part.value / Math.max(1, d.exposure))})</li>
            ))}
          </ul>
        </section>

        <section className="capital-card leverage-requirement-card">
          <div className="leverage-card-heading requirement-heading">
            <div><h3>Requirement composition</h3><p>Current thresholds and in-scope view</p></div>
            <div className="leverage-view-toggle" role="group" aria-label="Requirement display">
              <button className={requirementView === 'ratio' ? 'active' : ''} onClick={() => setRequirementView('ratio')} data-requirement-view="ratio">% of exposure</button>
              <button className={requirementView === 'amount' ? 'active' : ''} onClick={() => setRequirementView('amount')} data-requirement-view="amount">£ Amount</button>
            </div>
          </div>
          <RequirementBar
            title={d.inScope ? 'Minimum leverage requirement' : 'Minimum / PRA expectation'}
            totalRate={d.minimum}
            exposure={d.exposure}
            segments={requirementSegments}
            view={requirementView}
          />
          <RequirementBar
            title={d.inScope ? 'Leverage requirement including buffers' : 'Indicative requirement if in scope'}
            totalRate={bufferThreshold}
            exposure={d.exposure}
            segments={bufferSegments}
            view={requirementView}
          />
        </section>
      </div>

      <div className="leverage-secondary-grid">
        <section className="capital-card leverage-scope-card">
          <div className="leverage-card-heading">
            <div><h3>Framework scope</h3><p>Position against leverage ratio scope triggers</p></div>
            <span className="capital-status">{scopeName}</span>
          </div>
          <ScopeProgress label="Retail deposits · 3y avg" value={d.averageRetailDeposits} threshold={d.retailDepositsThreshold} />
          <ScopeProgress label="Non-UK assets · 3y avg" value={d.averageNonUkAssets} threshold={d.nonUkAssetsThreshold} />
          <div className="leverage-scope-stats">
            <div><span>Current scope</span><strong>{scopeName}</strong></div>
            <div><span>Current leverage exposure</span><strong>{formatCurrency(d.exposure)}</strong></div>
          </div>
        </section>

        <section className="capital-card leverage-reconciliation-card">
          <div className="leverage-card-heading">
            <div><h3>Leverage exposure reconciliation</h3><p>Build-up of total leverage exposure</p></div>
          </div>
          <ExposureWaterfall rows={d.exposureRows} total={d.exposure} />
        </section>
      </div>

      <section className="capital-card leverage-history-card">
        <div className="leverage-history-heading">
          <div><h3>Leverage exposure measure over time</h3><p>Trend in the firm's leverage exposure measure (LEM)</p></div>
          <div className="leverage-history-stats">
            <div><span>Current LEM</span><strong>{formatCurrency(currentExposure)}</strong></div>
            <div><span>Change (Q/Q)</span><strong className={qoqChange >= 0 ? 'positive-value' : 'negative-value'}>{signedPct(qoqPct)}</strong><small>{signedMoney(qoqChange)}</small></div>
          </div>
        </div>
        <div className="leverage-history-chart">
          <TimeSeriesChart
            data={historyWithCurrent.map(s => ({ step: s.time.step, value: s.risk.riskMetrics.leverageExposure / 1e9 }))}
            xLabel="Month"
            yLabel="Leverage exposure (£bn)"
          />
        </div>
        <div className="leverage-history-legend"><i />Leverage exposure measure (LEM)</div>
      </section>
    </div>
  );
}
