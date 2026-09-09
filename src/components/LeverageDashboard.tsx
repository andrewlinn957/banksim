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
    threshold,
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
    cclb: metrics.leverageCclbRate ?? 0,
    alrb: metrics.leverageAlrbRate ?? 0,
    cclbIndicative: metrics.leverageCclbIndicativeRate ?? 0,
    alrbIndicative: metrics.leverageAlrbIndicativeRate ?? 0,
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
        <path d={`M${x(threshold)} 5v28`} stroke="var(--text)" strokeWidth="3" />
      )}
      {target !== undefined && Number.isFinite(target) && (
        <path
          d={`M${x(target)} 5v28`}
          stroke="#b24b92"
          strokeWidth="2"
          strokeDasharray="2 3"
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
  footer,
  gauge,
}: {
  title: string;
  status: string;
  shortfall: boolean;
  headline: string;
  headlineLabel?: string;
  secondary: SummaryValue[];
  footer: SummaryValue[];
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
            <span>{item.label}</span>
            <b className={item.valueClass}>{item.value}</b>
          </div>
        ))}
      </div>
      <Gauge {...gauge} />
      <div className="leverage-marker-key" aria-hidden="true">
        <span>
          <i className="leverage-marker-swatch" />
          {gauge.thresholdLabel}
        </span>
        {gauge.target !== undefined && gauge.targetLabel && (
          <span>
            <i className="leverage-marker-swatch target" />
            {gauge.targetLabel}
          </span>
        )}
      </div>
      <div className="capital-amounts">
        {footer.map(item => (
          <div key={item.label}>
            <b className={item.valueClass}>{item.value}</b>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </article>
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
    { label: 'AT1', value: d.at1, color: '#4d9ee3' },
  ];

  let cumulative = 0;
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
      d.threshold * 1.2,
      Number.isFinite(d.ratio) ? d.ratio * 1.15 : 0,
      compositionMax * 1.15
    ) / 0.01
  ) * 0.01;
  const chartRange = Math.max(0.01, chartMax - chartMin);
  const chartY = (n: number) => 250 - ((n - chartMin) / chartRange) * 205;
  const ticks = Array.from({ length: 5 }, (_, i) => chartMin + (chartRange * i) / 4);
  const targetsGrouped = Math.abs(d.target - d.threshold) < 1e-10;
  const scopeName = d.inScope ? 'In scope' : 'Expectation only';
  const cclbDisplay = d.inScope ? formatPct(d.cclb) : `${formatPct(d.cclbIndicative)} indicative`;
  const alrbDisplay = d.inScope ? formatPct(d.alrb) : `${formatPct(d.alrbIndicative)} indicative`;

  return (
    <div className="capital-dashboard leverage-dashboard">
      <div className="capital-cards">
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
          footer={[
            { label: 'Actual Tier 1 capital', value: formatCurrency(d.tier1) },
            { label: `${frameworkLabel} Tier 1`, value: formatCurrency(d.required) },
            { label: 'Capital headroom', value: signedMoney(d.surplus), valueClass: 'capital-gap' },
          ]}
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
            { label: d.inScope ? 'Minimum ratio' : 'Expectation', value: formatPct(d.minimum) },
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
            thresholdLabel: d.inScope ? 'Regulatory limit' : 'Expectation limit',
            targetLabel: 'Internal limit',
          }}
          footer={[
            { label: 'Actual leverage ratio', value: formatPct(d.ratio) },
            { label: d.inScope ? 'Requirement' : 'Expectation', value: formatPct(d.threshold) },
            {
              label: 'Spare exposure capacity',
              value: d.exposure > 0 ? formatPct(spare / d.exposure) : 'N/A',
              valueClass: 'capital-gap',
            },
          ]}
        />
      </div>

      <div className="capital-detail-grid leverage-detail-grid">
        <section className="capital-card leverage-composition-card">
          <h3>Tier 1 composition</h3>
          <p className="capital-total">
            Total Tier 1 held <strong>{formatCurrency(d.tier1)} ({formatPct(d.ratio)})</strong>
          </p>
          {d.exposure > 0 ? (
            <div className="leverage-composition-layout">
              <svg
                className="leverage-composition-chart"
                viewBox="0 0 360 300"
                role="img"
                aria-label={`Tier 1 composition: CET1 ${formatCurrency(d.cet1)}, AT1 ${formatCurrency(
                  d.at1
                )}; exposure ${formatCurrency(d.exposure)}. ${frameworkLabel} ${formatPct(
                  d.threshold
                )}, internal target ${formatPct(d.target)}.`}
              >
                {ticks.map(tick => (
                  <g key={tick}>
                    <path d={`M58 ${chartY(tick)}H320`} stroke="var(--border)" />
                    <text x="49" y={chartY(tick) + 4} textAnchor="end">
                      {formatPct(tick, 1)}
                    </text>
                  </g>
                ))}
                {chartMin < 0 && (
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
                {positionedParts.map(part => {
                  const top = chartY(Math.max(part.start, part.end));
                  const height = Math.abs(chartY(part.start) - chartY(part.end));
                  return (
                    <g key={part.label}>
                      <rect
                        x="104"
                        y={top}
                        width="165"
                        height={height}
                        fill={part.color}
                        data-capital-component={part.label}
                        data-start-ratio={part.start}
                        data-end-ratio={part.end}
                      />
                      {height > 34 && (
                        <text x="186.5" y={top + height / 2 - 5} textAnchor="middle" className="stack-label">
                          {part.label}
                          <tspan x="186.5" dy="18">
                            {formatCurrency(part.value)} ({formatPct(part.value / d.exposure)})
                          </tspan>
                        </text>
                      )}
                    </g>
                  );
                })}
                <path
                  d={`M58 ${chartY(d.threshold)}H320`}
                  fill="none"
                  stroke="#7956bd"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
                {!targetsGrouped && (
                  <path
                    d={`M58 ${chartY(d.target)}H320`}
                    fill="none"
                    stroke="#b24b92"
                    strokeWidth="2"
                    strokeDasharray="2 4"
                  />
                )}
                <text x="186.5" y="286" textAnchor="middle" fontWeight="700">
                  Leverage exposure {formatCurrency(d.exposure)}
                </text>
              </svg>

              <div className="leverage-threshold-list">
                {targetsGrouped ? (
                  <div className="leverage-threshold">
                    <span>{frameworkLabel} & internal target</span>
                    <strong>{formatPct(d.threshold)}</strong>
                    <small>{formatCurrency(d.required)} Tier 1</small>
                  </div>
                ) : (
                  <>
                    <div className="leverage-threshold">
                      <span>{d.inScope ? 'Leverage requirement' : 'Leverage expectation'}</span>
                      <strong>{formatPct(d.threshold)}</strong>
                      <small>{formatCurrency(d.required)} Tier 1</small>
                    </div>
                    <div className="leverage-threshold target">
                      <span>Internal leverage target</span>
                      <strong>{formatPct(d.target)}</strong>
                      <small>{formatCurrency(d.targetRequired)} Tier 1</small>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <p>Ratio composition is unavailable without positive leverage exposure.</p>
          )}
          <ul className="capital-legend">
            {parts.map(part => (
              <li key={part.label}>
                <i style={{ background: part.color }} />
                {part.label} · {formatCurrency(part.value)}
              </li>
            ))}
          </ul>
        </section>

        <section className="capital-card leverage-requirements-card">
          <h3>Leverage framework</h3>
          <div className="leverage-table-section">
            <h4>Scope</h4>
            <table className="leverage-detail-table">
              <tbody>
                <tr><th>Status</th><td>{scopeName}</td></tr>
                <tr><th>Retail deposits · 3y avg</th><td>{formatCurrency(d.averageRetailDeposits)} / {formatCurrency(d.retailDepositsThreshold)}</td></tr>
                <tr><th>Non-UK assets · 3y avg</th><td>{formatCurrency(d.averageNonUkAssets)} / {formatCurrency(d.nonUkAssetsThreshold)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="leverage-table-section">
            <h4>Ratio thresholds</h4>
            <table className="leverage-detail-table">
              <tbody>
                <tr><th>{d.inScope ? 'Minimum' : 'Expectation'}</th><td>{formatPct(d.minimum)}</td></tr>
                <tr><th>CCLB</th><td>{cclbDisplay}</td></tr>
                <tr><th>ALRB</th><td>{alrbDisplay}</td></tr>
                <tr className="emphasis-row"><th>{frameworkLabel}</th><td>{formatPct(d.threshold)}</td></tr>
                <tr><th>Internal target</th><td>{formatPct(d.target)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="leverage-table-section">
            <h4>Capital position</h4>
            <table className="leverage-detail-table">
              <tbody>
                <tr><th>Total leverage exposure</th><td>{formatCurrency(d.exposure)}</td></tr>
                <tr><th>{frameworkLabel} Tier 1</th><td>{formatCurrency(d.required)}</td></tr>
                <tr><th>{frameworkLabel} CET1</th><td>{formatCurrency(d.cet1Required)}</td></tr>
                <tr className="emphasis-row"><th>Actual Tier 1 capital</th><td>{formatCurrency(d.tier1)}</td></tr>
                <tr><th>Tier 1 headroom</th><td className={d.surplus >= 0 ? 'positive-value' : undefined}>{signedMoney(d.surplus)}</td></tr>
                <tr><th>CET1 headroom</th><td className={d.cet1Surplus >= 0 ? 'positive-value' : undefined}>{signedMoney(d.cet1Surplus)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="capital-card leverage-reconciliation">
        <h3>Leverage exposure reconciliation</h3>
        <table className="leverage-compact-table">
          <thead>
            <tr>
              <th>Contribution</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.exposureRows.map(row => (
              <tr key={row.label}>
                <th>{row.label}</th>
                <td>
                  {row.value < 0 ? '−' : ''}
                  {formatCurrency(Math.abs(row.value))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total leverage exposure</th>
              <td>{formatCurrency(d.exposure)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="capital-card capital-history">
        <h3>Leverage ratio over time</h3>
        <div style={{ height: 270 }}>
          <TimeSeriesChart
            data={history.map(s => ({ step: s.time.step, value: s.risk.riskMetrics.leverageRatio }))}
            xLabel="Month"
            yLabel="Leverage ratio (%)"
          />
        </div>
      </section>
    </div>
  );
}
