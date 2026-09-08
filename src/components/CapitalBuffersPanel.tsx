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
