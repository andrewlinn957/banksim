import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { buildCapitalBuffersPresentation } from '../presentation/reports/capitalAssessments';

export default function CapitalBuffersPanel({ state, config }: { state: BankState; config: SimulationConfig }) {
  const presentation = buildCapitalBuffersPresentation(state, config);
  const { rows: bufferRows, osiiThreshold, display } = presentation;
  const bufferScale = Math.max(0.025, ...bufferRows.map((row) => row.ratio));

  return <div className="capital-buffer-grid">
    <section className="capital-card capital-buffers-card">
      <header className="capital-section-heading">
        <div><h3>Capital buffers</h3><p className="muted">Combined buffer requirement and individual components</p></div>
      </header>
      <div className="buffer-card-body">
        <div className="buffer-total">
          <strong>{display.total.ratio}</strong>
          <b>{display.total.amount}</b>
          <span>Total buffer requirement</span>
        </div>
        <div className="buffer-rows">
          {bufferRows.map((row, index) => <div className="buffer-row" key={row.label}>
            <span className="buffer-row-label">{display.rows[index].label}</span>
            <div className="buffer-row-track"><i style={{ width: `${Math.max(0, row.ratio) / bufferScale * 100}%` }} /></div>
            <strong>{display.rows[index].ratio}</strong>
            <span>{display.rows[index].amount}</span>
          </div>)}
        </div>
      </div>
      <details className="capital-disclosure compact-buffer-details">
        <summary>Buffer details</summary>
        <div className="table-scroll"><table><tbody>
          {display.details.map((row) => <tr key={row.label}><th>{row.label}</th><td>{row.value}</td></tr>)}
        </tbody></table></div>
      </details>
    </section>

    <section className="capital-card osii-threshold-card">
      <header className="capital-section-heading">
        <div><h3>O-SII threshold</h3><p className="muted">UK leverage exposure relative to the next threshold</p></div>
        <span className={`capital-status ${osiiThreshold.inScope ? 'capital-status-warning' : ''}`}>{display.threshold.scopeLabel}</span>
      </header>
      <div className="osii-summary">
        <div><span>Current leverage exposure</span><strong>{display.threshold.currentLem}</strong></div>
        <div><span>Threshold</span><strong>{display.threshold.threshold}</strong></div>
        <div><span>Headroom</span><strong>{display.threshold.headroom}</strong></div>
        <div><span>Current scope</span><strong>{display.threshold.inScopeLabel}</strong></div>
      </div>
      <div className="osii-progress-wrap">
        <div className="osii-progress-track">
          <i className="osii-progress-fill" style={{ width: `${osiiThreshold.progressPct}%` }} />
          {osiiThreshold.nextThreshold !== undefined && <i className="osii-threshold-marker" />}
        </div>
        <div className="osii-progress-labels">
          <span>{display.threshold.startLabel}</span>
          <strong style={{ left: `${Math.min(96, Math.max(4, osiiThreshold.progressPct))}%` }}>{display.threshold.currentLem}<small>{display.threshold.currentProgressLabel}</small></strong>
          <span>{display.threshold.endLabel}</span>
        </div>
      </div>
      <details className="capital-disclosure osii-details">
        <summary>O-SII details</summary>
        <div className="table-scroll"><table><tbody>
          {display.threshold.details.map((row) => <tr key={row.label}><th>{row.label}</th><td>{row.value}</td></tr>)}
        </tbody></table></div>
        <p className="muted">{display.threshold.methodologyNote}</p>
      </details>
    </section>
  </div>;
}
