import { ReactNode } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide } from '../domain/enums';
import { StepAttribution } from '../domain/attribution';
import { formatCurrency, formatPct, formatSignedPct } from '../utils/formatters';
import './RiskDashboard.css';

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

// These are the policy-rule parameters used by the UK macro model.
// Keep the diagnostics here aligned with src/engine/ukMarketModel.ts.
const UK_MACRO_DIAGNOSTICS = {
  inflationTarget: 0.02,
  neutralRealMean: 0.0125,
  neutralRealStd: 0.0045,
  inflationResponse: 1.5,
  demandResponse: 0.003,
};

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
const formatFactor = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '—');

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

  const macro = state.market.macroModel;
  const factors = macro.factors;
  const rStarReal = UK_MACRO_DIAGNOSTICS.neutralRealMean + UK_MACRO_DIAGNOSTICS.neutralRealStd * factors.R;
  const neutralNominal = rStarReal + UK_MACRO_DIAGNOSTICS.inflationTarget;
  const policyTarget =
    rStarReal +
    state.market.inflationRate +
    UK_MACRO_DIAGNOSTICS.inflationResponse * (state.market.inflationRate - UK_MACRO_DIAGNOSTICS.inflationTarget) +
    UK_MACRO_DIAGNOSTICS.demandResponse * factors.D;

  const curve = state.market.giltCurve;
  const { yields, nelsonSiegel } = curve;
  const twoTenSlope = yields.y10 - yields.y2;
  const fiveThirtySlope = yields.y30 - yields.y5;

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

      <RiskStripSection title="Balance-sheet risk" className="risk-strip-balance">
        <Metric label="NII +100bp" value={formatCurrency(risk.niiSensitivity100bp)} />
        <Metric label="EVE +100bp" value={formatCurrency(risk.eveSensitivity100bp)} />
        <Metric label="Funding ≤3m" value={formatCurrency(risk.fundingMaturing3m)} />
        <Metric label="Funding ≤12m" value={formatCurrency(risk.fundingMaturing12m)} />
        <Metric label="Deposit quality" value={formatPct(risk.depositQualityIndex)} />
        <Metric label="Funding confidence" value={formatPct(risk.fundingConfidenceScore)} />
        <Metric label="Largest sector" value={formatPct(risk.sectorConcentration)} />
        <Metric label="Largest geography" value={formatPct(risk.geographyConcentration)} />
      </RiskStripSection>

      <RiskStripSection title="Franchise & earnings" className="risk-strip-franchise">
        <Metric label="ROE annualised" value={formatPct(roe)} />
        <Metric label="NIM annualised" value={formatPct(nim)} />
        <Metric label="Deposit franchise" value={formatPct(state.behaviour.depositFranchiseStrength)} />
        <Metric label="Share price" value={`£${state.equityMarket.sharePrice.toFixed(2)}`} />
        <Metric label="Market cap" value={formatCurrency(state.equityMarket.marketCap)} />
        <Metric label="Total assets" value={formatCurrency(assets)} />
      </RiskStripSection>

      <section className="risk-command-panel">
        <div className="risk-panel-heading"><h3>Macro model</h3></div>
        <div className="risk-metric-strip risk-strip-macro" aria-label="Macro model outputs">
          <Metric label="Regime" value={titleCase(macro.gdpRegime)} />
          <Metric label="GDP MoM" value={formatSignedPct(state.market.gdpGrowthMoM)} />
          <Metric label="Inflation YoY" value={formatPct(state.market.inflationRate)} />
          <Metric label="Unemployment" value={formatPct(state.market.unemploymentRate)} />
          <Metric label="Bank Rate" value={formatPct(state.market.baseRate)} />
          <Metric label="R* real" value={formatPct(rStarReal)} helper="Neutral real rate" />
          <Metric label="Neutral nominal" value={formatPct(neutralNominal)} />
          <Metric label="Policy target" value={formatPct(policyTarget)} helper="Before smoothing" />
          <Metric label="Term premium" value={formatPct(macro.termPremium)} />
          <Metric label="Credit spread" value={formatPct(state.market.creditSpread)} />
        </div>
        <div className="risk-substrip-label">Latent factors</div>
        <div className="risk-metric-strip risk-strip-factors" aria-label="Macro latent factors">
          <Metric label="Demand (D)" value={formatFactor(factors.D)} />
          <Metric label="Supply (S)" value={formatFactor(factors.S)} />
          <Metric label="Financial stress (F)" value={formatFactor(factors.F)} />
          <Metric label="Neutral-rate factor (R)" value={formatFactor(factors.R)} />
        </div>
      </section>

      <section className="risk-command-panel">
        <div className="risk-panel-heading"><h3>Gilt curve</h3></div>
        <div className="risk-metric-strip risk-strip-curve" aria-label="Gilt curve yields">
          <Metric label="1Y" value={formatPct(yields.y1)} />
          <Metric label="2Y" value={formatPct(yields.y2)} />
          <Metric label="3Y" value={formatPct(yields.y3)} />
          <Metric label="5Y" value={formatPct(yields.y5)} />
          <Metric label="10Y" value={formatPct(yields.y10)} />
          <Metric label="20Y" value={formatPct(yields.y20)} />
          <Metric label="30Y" value={formatPct(yields.y30)} />
        </div>
        <div className="risk-substrip-label">Curve diagnostics</div>
        <div className="risk-metric-strip risk-strip-curve-diagnostics" aria-label="Yield curve diagnostics">
          <Metric label="2s10s" value={formatSignedPct(twoTenSlope)} />
          <Metric label="5s30s" value={formatSignedPct(fiveThirtySlope)} />
          <Metric label="NS level β0" value={formatPct(nelsonSiegel.level)} />
          <Metric label="NS slope β1" value={formatSignedPct(nelsonSiegel.slope)} />
          <Metric label="NS curvature β2" value={formatSignedPct(nelsonSiegel.curvature)} />
          <Metric label="NS λ" value={nelsonSiegel.lambda.toFixed(2)} />
        </div>
      </section>

      {attribution && (
        <section className="risk-command-panel">
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
    </section>
  );
};

const RiskStripSection = ({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: ReactNode;
}) => (
  <section className="risk-command-panel">
    <div className="risk-panel-heading"><h3>{title}</h3></div>
    <div className={`risk-metric-strip ${className}`}>{children}</div>
  </section>
);

const Metric = ({ label, value, helper }: { label: string; value: string; helper?: string }) => (
  <div className="risk-metric">
    <span>{label}</span>
    <strong>{value}</strong>
    {helper && <small>{helper}</small>}
  </div>
);

const Delta = ({ label, value }: { label: string; value: string }) => (
  <div className="risk-delta"><span>{label}</span><strong>{value}</strong></div>
);

export default RiskDashboard;
