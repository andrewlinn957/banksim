import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide } from '../domain/enums';
import { StepAttribution } from '../domain/attribution';
import { formatCurrency, formatPct, formatSignedPct } from '../utils/formatters';

interface Props {
  state: BankState;
  config: SimulationConfig;
  attribution?: StepAttribution | null;
}

type SignalState = 'good' | 'watch' | 'bad';

const signalState = (value: number, limit: number, watchBuffer: number): SignalState => {
  if (value < limit) return 'bad';
  if (value < limit + watchBuffer) return 'watch';
  return 'good';
};

const RiskDashboard = ({ state, config, attribution }: Props) => {
  const risk = state.risk.riskMetrics;
  const assets = state.financial.balanceSheet.items
    .filter((item) => item.side === BalanceSheetSide.Asset)
    .reduce((sum, item) => sum + item.balance, 0);
  const equity = state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;
  const roe = equity > 0 ? state.financial.incomeStatement.netIncome * 12 / equity : 0;
  const nim = assets > 0 ? state.financial.incomeStatement.netInterestIncome * 12 / assets : 0;

  const cet1Limit = risk.cet1Requirement;
  const leverageLimit = config.riskLimits.minLeverageRatio;
  const lcrLimit = config.riskLimits.minLcr;
  const nsfrLimit = config.riskLimits.minNsfr;

  const signals = [
    { label: 'CET1', value: risk.cet1Ratio, limit: cet1Limit, watch: 0.015 },
    { label: 'Leverage', value: risk.leverageRatio, limit: leverageLimit, watch: 0.0075 },
    { label: 'LCR', value: risk.lcr, limit: lcrLimit, watch: 0.15 },
    { label: 'NSFR', value: risk.nsfr, limit: nsfrLimit, watch: 0.12 },
  ];

  const hasBadSignal = signals.some((item) => signalState(item.value, item.limit, item.watch) === 'bad');
  const hasWatchSignal = signals.some((item) => signalState(item.value, item.limit, item.watch) === 'watch');
  const status = state.status.hasFailed || hasBadSignal ? 'Critical' : hasWatchSignal || risk.internalCet1Headroom < 0 ? 'Attention' : 'Within limits';

  return (
    <section className="risk-command stack" aria-label="Risk dashboard">
      <header className="risk-command-header">
        <div>
          <div className="eyebrow">Risk dashboard</div>
          <h2>Bank risk position</h2>
          <p className="muted">Current resilience, funding risk, earnings sensitivity and market context.</p>
        </div>
        <div className={`risk-command-status status-${status === 'Within limits' ? 'good' : status === 'Attention' ? 'watch' : 'bad'}`}>
          <span>Overall status</span>
          <strong>{status}</strong>
        </div>
      </header>

      <div className="risk-signal-grid">
        {signals.map((item) => {
          const stateName = signalState(item.value, item.limit, item.watch);
          const headroom = item.value - item.limit;
          const width = Math.max(0, Math.min(100, (item.value / Math.max(item.limit * 1.5, 0.0001)) * 100));
          return (
            <section className={`risk-signal signal-${stateName}`} key={item.label}>
              <div className="risk-signal-label"><span>{item.label}</span><span className="risk-dot" aria-hidden="true" /></div>
              <strong>{formatPct(item.value)}</strong>
              <div className="risk-signal-meta"><span>Reference {formatPct(item.limit)}</span><span>{formatSignedPct(headroom)} headroom</span></div>
              <div className="risk-bar" aria-hidden="true"><span style={{ width: `${width}%` }} /></div>
            </section>
          );
        })}
      </div>

      <div className="risk-command-grid">
        <section className="risk-command-panel risk-command-panel-wide">
          <div className="risk-panel-heading"><h3>Balance-sheet risk</h3><span>{risk.fundingConfidenceState} funding confidence</span></div>
          <dl className="risk-data-list">
            <RiskRow label="NII sensitivity (+100bp)" value={formatCurrency(risk.niiSensitivity100bp)} />
            <RiskRow label="EVE sensitivity (+100bp)" value={formatCurrency(risk.eveSensitivity100bp)} />
            <RiskRow label="Funding due within 3m" value={formatCurrency(risk.fundingMaturing3m)} />
            <RiskRow label="Funding due within 12m" value={formatCurrency(risk.fundingMaturing12m)} />
            <RiskRow label="Deposit quality" value={formatPct(risk.depositQualityIndex)} />
            <RiskRow label="Funding confidence" value={formatPct(risk.fundingConfidenceScore)} />
            <RiskRow label="Largest sector concentration" value={formatPct(risk.sectorConcentration)} />
            <RiskRow label="Largest geography concentration" value={formatPct(risk.geographyConcentration)} />
          </dl>
        </section>

        <section className="risk-command-panel">
          <div className="risk-panel-heading"><h3>Franchise & earnings</h3></div>
          <dl className="risk-data-list">
            <RiskRow label="ROE (annualised)" value={formatPct(roe)} />
            <RiskRow label="NIM (annualised)" value={formatPct(nim)} />
            <RiskRow label="Deposit franchise" value={formatPct(state.behaviour.depositFranchiseStrength)} />
            <RiskRow label="Share price" value={`£${state.equityMarket.sharePrice.toFixed(2)}`} />
            <RiskRow label="Market capitalisation" value={formatCurrency(state.equityMarket.marketCap)} />
            <RiskRow label="Total assets" value={formatCurrency(assets)} />
          </dl>
        </section>

        <section className="risk-command-panel">
          <div className="risk-panel-heading"><h3>Market context</h3></div>
          <dl className="risk-data-list">
            <RiskRow label="Bank Rate" value={formatPct(state.market.baseRate)} />
            <RiskRow label="Inflation" value={formatPct(state.market.inflationRate)} />
            <RiskRow label="Unemployment" value={formatPct(state.market.unemploymentRate)} />
            <RiskRow label="GDP (MoM)" value={formatSignedPct(state.market.gdpGrowthMoM)} />
            <RiskRow label="Credit spread" value={formatPct(state.market.creditSpread)} />
          </dl>
        </section>

        {attribution && (
          <section className="risk-command-panel risk-command-panel-wide">
            <div className="risk-panel-heading"><h3>Last close</h3><span>Change from the previous month</span></div>
            <div className="risk-delta-grid">
              <Delta label="CET1" value={formatSignedPct(attribution.metrics.cet1Ratio.delta)} />
              <Delta label="LCR" value={formatSignedPct(attribution.metrics.lcr.delta)} />
              <Delta label="NSFR" value={formatSignedPct(attribution.metrics.nsfr.delta)} />
              <Delta label="NIM" value={formatSignedPct(attribution.metrics.nim.delta)} />
              <Delta
                label="Top CET1 driver"
                value={attribution.metrics.cet1Ratio.lines.find(
                  (line) => line.id === attribution.metrics.cet1Ratio.topPositiveDriverId
                )?.label ?? 'None'}
              />
            </div>
          </section>
        )}
      </div>
    </section>
  );
};

const RiskRow = ({ label, value }: { label: string; value: string }) => (
  <div><dt>{label}</dt><dd>{value}</dd></div>
);

const Delta = ({ label, value }: { label: string; value: string }) => (
  <div className="risk-delta"><span>{label}</span><strong>{value}</strong></div>
);

export default RiskDashboard;
