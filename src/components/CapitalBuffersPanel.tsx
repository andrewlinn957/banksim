import { BankState } from '../domain/bankState';
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
  const currentLem = m.osiiCurrentUkLeverageExposure ?? 0;
  const trailingLem = m.osiiTrailingAverageUkLeverageExposure ?? currentLem;
  const nextThreshold = m.osiiNextThreshold;
  const headroom = nextThreshold === undefined ? undefined : Math.max(0, nextThreshold - currentLem);
  const progress = nextThreshold && nextThreshold > 0 ? Math.max(0, Math.min(100, currentLem / nextThreshold * 100)) : 100;
  const bufferRows = [
    { label: 'Capital conservation buffer', short: 'CCoB', ratio: conservation },
    { label: 'Institution-specific CCyB', short: 'CCyB', ratio: ccyb },
    { label: 'O-SII buffer', short: 'O-SII', ratio: osii },
  ];
  const bufferScale = Math.max(0.025, ...bufferRows.map((row) => row.ratio));
  const inScope = m.osiiScopeRoute === 'largeDomesticBank' || m.osiiScopeRoute === 'ringFencedBankProxy';

  return <div className="capital-buffer-grid">
    <section className="capital-card capital-buffers-card">
      <header className="capital-section-heading">
        <div><h3>Capital buffers</h3><p className="muted">Combined buffer requirement and individual components</p></div>
      </header>
      <div className="buffer-card-body">
        <div className="buffer-total">
          <strong>{formatPct(combined)}</strong>
          <b>{formatCurrency(combined * m.rwa)}</b>
          <span>Total buffer requirement</span>
        </div>
        <div className="buffer-rows">
          {bufferRows.map((row) => <div className="buffer-row" key={row.label}>
            <span className="buffer-row-label">{row.label}</span>
            <div className="buffer-row-track"><i style={{ width: `${Math.max(0, row.ratio) / bufferScale * 100}%` }} /></div>
            <strong>{formatPct(row.ratio)}</strong>
            <span>{formatCurrency(row.ratio * m.rwa)}</span>
          </div>)}
        </div>
      </div>
      <details className="capital-disclosure compact-buffer-details">
        <summary>Buffer details</summary>
        <div className="table-scroll"><table><tbody>
          <tr><th>Current UK CCyB rate</th><td>{formatPct(m.ukCountercyclicalBufferRate ?? ccyb)}</td></tr>
          <tr><th>UK relevant credit RWA share</th><td>{formatPct(m.ukRelevantCreditRwaShare ?? 1)}</td></tr>
          <tr><th>Capital conservation buffer</th><td>{formatPct(conservation)}</td></tr>
          <tr><th>Institution-specific countercyclical buffer</th><td>{formatPct(ccyb)}</td></tr>
          <tr><th>O-SII buffer</th><td>{formatPct(osii)}</td></tr>
        </tbody></table></div>
      </details>
    </section>

    <section className="capital-card osii-threshold-card">
      <header className="capital-section-heading">
        <div><h3>O-SII threshold</h3><p className="muted">UK leverage exposure relative to the next threshold</p></div>
        <span className={`capital-status ${inScope ? 'capital-status-warning' : ''}`}>{scopeLabel(m.osiiScopeRoute)}</span>
      </header>
      <div className="osii-summary">
        <div><span>Current leverage exposure</span><strong>{formatCurrency(currentLem)}</strong></div>
        <div><span>Threshold</span><strong>{nextThreshold === undefined ? 'Top bucket' : formatCurrency(nextThreshold)}</strong></div>
        <div><span>Headroom</span><strong>{headroom === undefined ? '—' : formatCurrency(headroom)}</strong></div>
        <div><span>Current scope</span><strong>{inScope ? 'In scope' : 'Out of scope'}</strong></div>
      </div>
      <div className="osii-progress-wrap">
        <div className="osii-progress-track">
          <i className="osii-progress-fill" style={{ width: `${progress}%` }} />
          {nextThreshold !== undefined && <i className="osii-threshold-marker" />}
        </div>
        <div className="osii-progress-labels">
          <span>£0bn</span>
          <strong style={{ left: `${Math.min(96, Math.max(4, progress))}%` }}>{formatCurrency(currentLem)}<small>{nextThreshold ? ` (${progress.toFixed(1)}%)` : ''}</small></strong>
          <span>{nextThreshold === undefined ? 'Top bucket reached' : `${formatCurrency(nextThreshold)} threshold`}</span>
        </div>
      </div>
      <details className="capital-disclosure osii-details">
        <summary>O-SII details</summary>
        <div className="table-scroll"><table><tbody>
          <tr><th>Current scope</th><td>{scopeLabel(m.osiiScopeRoute)}</td></tr>
          <tr><th>Core deposits</th><td>{formatCurrency(coreDeposits)} / {formatCurrency(coreThreshold)} scope threshold</td></tr>
          <tr><th>Current UK leverage exposure</th><td>{formatCurrency(currentLem)}</td></tr>
          <tr><th>Trailing quarter-end average</th><td>{formatCurrency(trailingLem)}</td></tr>
          <tr><th>Average used at last rate setting</th><td>{formatCurrency(m.osiiAssessedAverageUkLeverageExposure ?? 0)}</td></tr>
          <tr><th>Next O-SII threshold</th><td>{nextThreshold === undefined ? 'Top bucket reached' : `${formatCurrency(nextThreshold)} → ${formatPct(m.osiiNextThresholdRate ?? 0)}`}</td></tr>
          {headroom !== undefined && <tr><th>Headroom to next threshold</th><td>{formatCurrency(headroom)}</td></tr>}
          <tr><th>Next annual rate setting</th><td>{monthsToReview === 0 ? 'Next close' : `${monthsToReview}m`}</td></tr>
          <tr><th>Threshold schedule</th><td>{m.osiiThresholdScheduleYear ?? 2027} framework</td></tr>
        </tbody></table></div>
        <p className="muted">O-SII is assessed annually from the trailing four quarter-end UK leverage exposure measures. BankSim applies a newly assessed rate at its annual review.</p>
      </details>
    </section>
  </div>;
}
