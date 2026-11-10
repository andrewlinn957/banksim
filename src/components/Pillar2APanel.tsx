import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { buildPillar2AAssessmentPresentation } from '../presentation/reports/capitalAssessments';

export default function Pillar2APanel({ state, config }: { state: BankState; config: SimulationConfig }) {
  const presentation = buildPillar2AAssessmentPresentation(state, config);
  if (!presentation) return null;
  const { waterfall: bars, chartMax, chartTicks, display } = presentation;
  const chartY = (ratio: number) => 235 - ratio / chartMax * 180;
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
      <div><span>Assessed P2A</span><strong>{display.summary.effectiveRate}</strong></div>
      <div><span>Current amount</span><strong>{display.summary.currentAmount}</strong></div>
      <div><span>Next review</span><strong>{display.summary.nextReview}</strong></div>
    </div>

    <div className="pillar2a-chart-wrap">
      <svg className="pillar2a-waterfall" viewBox="0 0 970 300" role="img" aria-label={display.chart.ariaLabel}>
        {chartTicks.map((tick, index) => <g key={tick}>
          <path d={`M50 ${chartY(tick)}H945`} className="pillar2a-gridline" />
          <text x="42" y={chartY(tick) + 4} textAnchor="end">{display.chart.axisTickLabels[index]}</text>
        </g>)}
        <text transform="translate(14 150) rotate(-90)" textAnchor="middle">{display.chart.axisTitle}</text>
        {bars.map((bar, index) => {
          const displayBar = display.chart.bars[index];
          const x = left + step * index + (step - barWidth) / 2;
          const top = Math.min(chartY(bar.start), chartY(bar.end));
          const height = Math.max(1, Math.abs(chartY(bar.end) - chartY(bar.start)));
          const labelY = Math.max(35, top - 9);
          const next = bars[index + 1];
          const nextX = next ? left + step * (index + 1) + (step - barWidth) / 2 : 0;
          const connectorY = chartY(bar.end);
          return <g key={bar.label} className={`pillar2a-waterfall-${bar.kind}`}>
            {next && index !== 4 && index !== 5 && <path d={`M${x + barWidth} ${connectorY}H${nextX}`} className="pillar2a-connector" />}
            {next && (index === 4 || index === 5 || index === 7) && <path d={`M${x + barWidth} ${connectorY}H${nextX}`} className="pillar2a-connector" />}
            <rect x={x} y={top} width={barWidth} height={height} rx="2" />
            <text x={x + barWidth / 2} y={labelY} textAnchor="middle" className="pillar2a-delta">{displayBar.value}</text>
            <text x={x + barWidth / 2} y="263" textAnchor="middle" className="pillar2a-label">
              {displayBar.lines.map((line, lineIndex) => <tspan key={line} x={x + barWidth / 2} dy={lineIndex === 0 ? 0 : 14}>{line}</tspan>)}
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
            {display.detailRows.map((row) => {
              return <tr key={row.label} className={row.total ? 'total-row' : undefined}>
                {row.total ? <th>{row.label}</th> : <td>{row.label}</td>}
                <td>{row.amount}</td>
                <td>{row.ratio}</td>
              </tr>;
            })}
          </tbody></table></div>
        </div>
        <div>
          <h4>Assessment drivers</h4>
          <div className="table-scroll"><table><tbody>
            {display.drivers.map((row) => <tr key={row.label}><th>{row.label}</th><td>{row.value}</td></tr>)}
          </tbody></table></div>
        </div>
      </div>
      <p className="muted pillar2a-method-note">{display.methodologyNote}</p>
    </details>
  </section>;
}
