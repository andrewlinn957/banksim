import { ReactNode, useMemo } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { StepAttribution } from '../domain/attribution';
import { formatPct, formatSignedPct } from '../utils/formatters';
import GiltCurveChart from './GiltCurveChart';
import { buildRiskDashboardData, RiskMetricTone } from '../presentation/reports/risk';
import './RiskDashboard.css';

interface Props {
  state: BankState;
  config: SimulationConfig;
  attribution?: StepAttribution | null;
}

const RiskDashboard = ({ state, config, attribution }: Props) => {
  const data = useMemo(() => buildRiskDashboardData(state, config, attribution), [state, config, attribution]);

  return (
    <section className="risk-command stack" aria-label="Risk dashboard">
      <header className="risk-command-header">
        <div>
          <div className="eyebrow">Risk dashboard</div>
          <h2>Bank risk position</h2>
          <p className="muted">Regulatory headroom, structural balance-sheet risk, macro conditions and market shape.</p>
        </div>
        <div className={`risk-command-status status-${data.status === 'Within limits' ? 'good' : data.status === 'Attention' ? 'watch' : 'bad'}`}>
          <span>Overall status</span>
          <strong>{data.status}</strong>
        </div>
      </header>

      <section id="risk-capital-liquidity" className="risk-signal-section">
        <div className="risk-section-heading">
          <div><span className="risk-section-mark risk-mark-regulatory" />Capital & liquidity</div>
          <small>Regulatory requirement and headroom</small>
        </div>
        <div className="risk-signal-grid">
          {data.signals.map((item) => (
            <section className={`risk-signal signal-${item.state}`} key={item.label}>
              <div className="risk-signal-label"><span>{item.label}</span><span className="risk-dot" aria-hidden="true" /></div>
              <strong>{formatPct(item.value)}</strong>
              <div className="risk-signal-meta"><span>Reference {formatPct(item.limit)}</span><span>{formatSignedPct(item.headroom)} headroom</span></div>
              <div className="risk-bar" aria-hidden="true"><span style={{ width: `${item.barWidthPct}%` }} /></div>
            </section>
          ))}
        </div>
      </section>

      <RiskStripSection
        id="risk-balance-sheet"
        title="Balance-sheet risk"
        subtitle="Rate sensitivity, near-term funding and concentration"
        sectionTone="balance"
        className="risk-strip-balance"
      >{data.balanceSheet.map((item) => <Metric key={item.label} {...item} />)}</RiskStripSection>

      <RiskStripSection
        id="risk-structural"
        title="Structural indicators"
        subtitle="Funding mix, liquidity intensity and credit deterioration"
        sectionTone="structural"
        className="risk-strip-structural"
      >{data.structural.map((item) => <Metric key={item.label} {...item} />)}</RiskStripSection>

      <RiskStripSection
        id="risk-earnings"
        title="Earnings & franchise"
        subtitle="Current earning power and market franchise"
        sectionTone="earnings"
        className="risk-strip-franchise"
      >{data.earnings.map((item) => <Metric key={item.label} {...item} />)}</RiskStripSection>

      <section id="risk-macro" className="risk-command-panel risk-section-macro">
        <div className="risk-panel-heading">
          <h3><span className="risk-section-mark risk-mark-macro" />Macro model</h3>
          <span>Observed conditions and internal model state</span>
        </div>
        <div className="risk-substrip-label">Observed conditions</div>
        <div className="risk-metric-strip risk-strip-macro-observed" aria-label="Macro observed conditions">
          {data.macroObserved.map((item) => <Metric key={item.label} {...item} />)}
        </div>
        <div className="risk-substrip-label">Model state</div>
        <div className="risk-metric-strip risk-strip-macro-state" aria-label="Macro model outputs">
          {data.macroModel.map((item) => <Metric key={item.label} {...item} />)}
        </div>
      </section>

      <section id="risk-gilt-curve" className="risk-command-panel risk-section-curve">
        <div className="risk-panel-heading">
          <h3><span className="risk-section-mark risk-mark-curve" />Gilt curve</h3>
          <span>Current UK risk-free term structure</span>
        </div>
        <div className="risk-curve-layout">
          <GiltCurveChart yields={data.curve.yields} />
          <div className="risk-curve-diagnostics" aria-label="Yield curve diagnostics">
            {data.curve.diagnostics.map((item) => <Metric key={item.label} {...item} />)}
          </div>
        </div>
      </section>

      {data.lastClose && (
        <section className="risk-command-panel risk-section-close">
          <div className="risk-panel-heading"><h3>Last close</h3><span>Change from the previous month</span></div>
          <div className="risk-delta-grid">
            {data.lastClose.map((item) => <Delta key={item.label} {...item} />)}
          </div>
        </section>
      )}
    </section>
  );
};

const RiskStripSection = ({
  id,
  title,
  subtitle,
  sectionTone,
  className,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  sectionTone: 'balance' | 'structural' | 'earnings';
  className: string;
  children: ReactNode;
}) => (
  <section id={id} className={`risk-command-panel risk-section-${sectionTone}`}>
    <div className="risk-panel-heading">
      <h3><span className={`risk-section-mark risk-mark-${sectionTone}`} />{title}</h3>
      <span>{subtitle}</span>
    </div>
    <div className={`risk-metric-strip ${className}`}>{children}</div>
  </section>
);

const Metric = ({
  label,
  value,
  helper,
  tone = 'default',
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: RiskMetricTone;
}) => (
  <div className={`risk-metric risk-metric-${tone}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    {helper && <small>{helper}</small>}
  </div>
);

const Delta = ({ label, value }: { label: string; value: string }) => (
  <div className="risk-delta"><span>{label}</span><strong>{value}</strong></div>
);

export default RiskDashboard;
