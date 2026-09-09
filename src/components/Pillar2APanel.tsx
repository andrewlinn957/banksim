import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { formatCurrency, formatPct } from '../utils/formatters';

const hhiPct = (value: number) => `${(value * 100).toFixed(2)}%`;

type WaterfallBar = {
  label: string;
  lines: string[];
  start: number;
  end: number;
  delta: number;
  kind: 'positive' | 'total' | 'negative' | 'final';
};

export default function Pillar2APanel({ state, config }: { state: BankState; config: SimulationConfig }) {
  const assessment = state.risk.pillar2A;
  if (!assessment) return null;

  const currentRwa = state.risk.riskMetrics.rwa;
  const effectiveRate = state.risk.riskMetrics.pillar2ARate ?? assessment.assessedRate;
  const currentAmount = effectiveRate * currentRwa;
  const totalOffset = assessment.ps1520.initialOffsetRate + assessment.ps1520.additionalOffsetRate;
  const monthsToReview = Math.max(0, assessment.nextAssessmentStep - state.time.step);
  const configuredFloor = Math.max(0, config.riskLimits.pillar2A?.totalRatio ?? 0);
  const componentRows = [
    { label: 'SA credit-risk underestimation', lines: ['SA credit-risk', 'underestimation'], amount: assessment.components.creditRisk },
    { label: 'Single-name concentration', lines: ['Single-name', 'concentration'], amount: assessment.components.singleNameConcentration },
    { label: 'Sector concentration', lines: ['Sector', 'concentration'], amount: assessment.components.sectorConcentration },
    { label: 'Geographic concentration', lines: ['Geographic', 'concentration'], amount: assessment.components.geographicConcentration },
    { label: 'IRRBB', lines: ['IRRBB'], amount: assessment.components.irrbb },
  ];

  let running = 0;
  const bars: WaterfallBar[] = componentRows.map((row) => {
    const ratio = assessment.assessmentRwa > 0 ? row.amount / assessment.assessmentRwa : 0;
    const start = running;
    running += ratio;
    return { label: row.label, lines: row.lines, start, end: running, delta: ratio, kind: 'positive' as const };
  });

  bars.push({
    label: 'Gross variable P2A',
    lines: ['Gross variable', 'P2A'],
    start: 0,
    end: assessment.grossRate,
    delta: assessment.grossRate,
    kind: 'total',
  });
  const afterInitial = Math.max(0, assessment.grossRate - assessment.ps1520.initialOffsetRate);
  bars.push({
    label: 'PS15/20 initial offset',
    lines: ['PS15/20', 'initial offset'],
    start: assessment.grossRate,
    end: afterInitial,
    delta: -assessment.ps1520.initialOffsetRate,
    kind: 'negative',
  });
  bars.push({
    label: 'PS15/20 additional small-bank offset',
    lines: ['PS15/20 additional', 'small-bank offset'],
    start: afterInitial,
    end: assessment.assessedRate,
    delta: -assessment.ps1520.additionalOffsetRate,
    kind: 'negative',
  });
  bars.push({
    label: configuredFloor > assessment.assessedRate + 1e-10 ? 'Effective P2A' : 'Assessed variable P2A',
    lines: configuredFloor > assessment.assessedRate + 1e-10 ? ['Effective P2A', '(scenario floor)'] : ['Assessed variable', 'P2A'],
    start: 0,
    end: effectiveRate,
    delta: effectiveRate,
    kind: 'final',
  });

  const chartMaxRaw = Math.max(0.04, assessment.grossRate * 1.18, effectiveRate * 1.18);
  const chartMax = Math.ceil(chartMaxRaw / 0.01) * 0.01;
  const chartY = (ratio: number) => 235 - ratio / chartMax * 180;
  const ticks = Array.from({ length: 5 }, (_, i) => chartMax * i / 4);
  const left = 62;
  const right = 930;
  const step = (right - left) / bars.length;
  const barWidth = Math.min(64, step * 0.68);

  return <section className="capital-card pillar2a-panel pillar2a-waterfall-panel">
    <header className="capital-section-heading">
      <div><h3>Pillar 2A assessment</h3><p className="muted">Build-up of assessed Pillar 2A requirement</p></div>
      <span className="capital-methodology-hint">Methodology in Help →</span>
    </header>

    <div className="pillar2a-summary">
      <div><span>Assessed P2A</span><strong>{formatPct(effectiveRate)}</strong></div>
      <div><span>Current amount</span><strong>{formatCurrency(currentAmount)}</strong></div>
      <div><span>Next review</span><strong>{monthsToReview === 0 ? 'Next close' : `${monthsToReview}m`}</strong></div>
    </div>

    <div className="pillar2a-chart-wrap">
      <svg className="pillar2a-waterfall" viewBox="0 0 970 300" role="img" aria-label={`Pillar 2A assessment: gross ${formatPct(assessment.grossRate)}, offsets ${formatPct(totalOffset)}, assessed ${formatPct(effectiveRate)}`}>
        {ticks.map((tick) => <g key={tick}>
          <path d={`M50 ${chartY(tick)}H945`} className="pillar2a-gridline" />
          <text x="42" y={chartY(tick) + 4} textAnchor="end">{formatPct(tick, 0)}</text>
        </g>)}
        <text transform="translate(14 150) rotate(-90)" textAnchor="middle">% of RWA</text>
        {bars.map((bar, index) => {
          const x = left + step * index + (step - barWidth) / 2;
          const top = Math.min(chartY(bar.start), chartY(bar.end));
          const height = Math.max(1, Math.abs(chartY(bar.end) - chartY(bar.start)));
          const labelY = Math.max(35, top - 9);
          const deltaLabel = bar.kind === 'negative'
            ? `−${formatPct(Math.abs(bar.delta))}`
            : bar.kind === 'positive'
              ? `+${formatPct(bar.delta)}`
              : formatPct(bar.end);
          const next = bars[index + 1];
          const nextX = next ? left + step * (index + 1) + (step - barWidth) / 2 : 0;
          const connectorY = chartY(bar.end);
          return <g key={bar.label} className={`pillar2a-waterfall-${bar.kind}`}>
            {next && index !== 4 && index !== 5 && <path d={`M${x + barWidth} ${connectorY}H${nextX}`} className="pillar2a-connector" />}
            {next && (index === 4 || index === 5 || index === 7) && <path d={`M${x + barWidth} ${connectorY}H${nextX}`} className="pillar2a-connector" />}
            <rect x={x} y={top} width={barWidth} height={height} rx="2" />
            <text x={x + barWidth / 2} y={labelY} textAnchor="middle" className="pillar2a-delta">{deltaLabel}</text>
            <text x={x + barWidth / 2} y="263" textAnchor="middle" className="pillar2a-label">
              {bar.lines.map((line, lineIndex) => <tspan key={line} x={x + barWidth / 2} dy={lineIndex === 0 ? 0 : 14}>{line}</tspan>)}
            </text>
          </g>;
        })}
      </svg>
    </div>

    <details className="capital-disclosure pillar2a-details">
      <summary>Calculation details</summary>
      <div className="pillar2a-detail-grid">
        <div>
          <h4>Latest assessment</h4>
          <div className="table-scroll"><table><thead><tr><th>Risk component</th><th>At assessment</th><th>% assessment RWA</th></tr></thead><tbody>
            {componentRows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{formatCurrency(row.amount)}</td><td>{assessment.assessmentRwa > 0 ? formatPct(row.amount / assessment.assessmentRwa) : 'N/A'}</td></tr>)}
            <tr className="total-row"><th>Gross variable P2A</th><td>{formatCurrency(assessment.grossRate * assessment.assessmentRwa)}</td><td>{formatPct(assessment.grossRate)}</td></tr>
            <tr><td>PS15/20 initial offset</td><td>−{formatCurrency(assessment.ps1520.initialOffsetRate * assessment.assessmentRwa)}</td><td>−{formatPct(assessment.ps1520.initialOffsetRate)}</td></tr>
            <tr><td>PS15/20 additional small-bank offset</td><td>−{formatCurrency(assessment.ps1520.additionalOffsetRate * assessment.assessmentRwa)}</td><td>−{formatPct(assessment.ps1520.additionalOffsetRate)}</td></tr>
            <tr className="total-row"><th>Assessed variable P2A</th><td>{formatCurrency(assessment.assessedRate * assessment.assessmentRwa)}</td><td>{formatPct(assessment.assessedRate)}</td></tr>
            {configuredFloor > assessment.assessedRate + 1e-10 && <tr><td>Scenario/manual P2A floor</td><td>{formatCurrency(configuredFloor * assessment.assessmentRwa)}</td><td>{formatPct(configuredFloor)}</td></tr>}
          </tbody></table></div>
        </div>
        <div>
          <h4>Assessment drivers</h4>
          <div className="table-scroll"><table><tbody>
            <tr><th>Assessment date</th><td>{new Date(assessment.assessmentDate).toLocaleDateString()}</td></tr>
            <tr><th>Assessment RWA</th><td>{formatCurrency(assessment.assessmentRwa)}</td></tr>
            <tr><th>UK CCyB pass-through</th><td>{formatPct(assessment.ps1520.ukCcybPassThroughRate)}</td></tr>
            <tr><th>Total PS15/20 offset</th><td>{formatPct(totalOffset)}</td></tr>
            <tr><th>Single-name HHI</th><td>{hhiPct(assessment.concentration.singleNameHhi)}</td></tr>
            <tr><th>Sector HHI</th><td>{hhiPct(assessment.concentration.sectorHhi)}</td></tr>
            <tr><th>Geographic HHI</th><td>{hhiPct(assessment.concentration.geographicHhi)}</td></tr>
            <tr><th>Worst ±200bp EVE loss</th><td>{formatCurrency(assessment.irrbb.worstLoss200bp)}</td></tr>
            <tr><th>Board IRRBB EVE limit</th><td>{formatCurrency(assessment.irrbb.policyLimit)}</td></tr>
            <tr><th>IRRBB capitalisation scalar</th><td>{formatPct(assessment.irrbb.capitalConversionFactor)}</td></tr>
          </tbody></table></div>
        </div>
      </div>
      <p className="muted pillar2a-method-note">BankSim uses the PRA's published concentration HHI ranges and PS15/20 offset mechanics. The equal-obligor single-name approximation, automatic low-risk/MREL eligibility, and IRRBB capitalisation scalar are explicit game simplifications where public policy does not provide a complete mechanical calculation.</p>
    </details>
  </section>;
}
