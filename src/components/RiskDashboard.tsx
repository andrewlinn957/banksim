import { ReactNode } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType, BalanceSheetSide, LiabilityProductType } from '../domain/enums';
import { PRODUCTS } from '../products/catalogue';
import { StepAttribution } from '../domain/attribution';
import { formatCurrency, formatPct, formatSignedPct } from '../utils/formatters';
import GiltCurveChart from './GiltCurveChart';
import './RiskDashboard.css';

interface Props {
  state: BankState;
  config: SimulationConfig;
  attribution?: StepAttribution | null;
}

type SignalState = 'good' | 'watch' | 'bad';
type MetricTone = 'default' | 'good' | 'watch' | 'bad' | 'info';

const signalState = (value: number, limit: number, watchBuffer: number): SignalState => {
  if (value < limit) return 'bad';
  if (value < limit + watchBuffer) return 'watch';
  return 'good';
};

const UK_MACRO_DIAGNOSTICS = {
  inflationTarget: 0.02,
  neutralRealMean: 0.0125,
  neutralRealStd: 0.0045,
  inflationResponse: 1.5,
  demandResponse: 0.003,
};

const LOAN_PRODUCTS = new Set<string>(
  Object.values(PRODUCTS).filter(product => product.behaviour.isLoan).map(product => product.productType)
);

const CUSTOMER_DEPOSIT_PRODUCTS = new Set<string>(
  Object.values(PRODUCTS).filter(product => product.behaviour.isCustomerDeposit).map(product => product.productType)
);

const LIQUID_ASSET_PRODUCTS = new Set<string>([
  AssetProductType.CashReserves,
  AssetProductType.Gilts,
]);

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
const formatFactor = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '—');
const formatOptionalPct = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : formatPct(value);

const fundingTone = (state: string): MetricTone => {
  if (state === 'stressed') return 'bad';
  if (state === 'watch') return 'watch';
  if (state === 'strong' || state === 'stable') return 'good';
  return 'default';
};

const limitTone = (value: number, limit: number): MetricTone => {
  if (value > limit) return 'bad';
  if (value > limit * 0.9) return 'watch';
  return 'good';
};

const RiskDashboard = ({ state, config, attribution }: Props) => {
  const risk = state.risk.riskMetrics;
  const balanceSheet = state.financial.balanceSheet.items;
  const assets = balanceSheet
    .filter((item) => item.side === BalanceSheetSide.Asset)
    .reduce((sum, item) => sum + item.balance, 0);
  const loans = balanceSheet
    .filter((item) => item.side === BalanceSheetSide.Asset && LOAN_PRODUCTS.has(item.productType))
    .reduce((sum, item) => sum + item.balance, 0);
  const customerDeposits = balanceSheet
    .filter((item) => item.side === BalanceSheetSide.Liability && CUSTOMER_DEPOSIT_PRODUCTS.has(item.productType))
    .reduce((sum, item) => sum + item.balance, 0);
  const liquidAssets = balanceSheet
    .filter((item) => item.side === BalanceSheetSide.Asset && LIQUID_ASSET_PRODUCTS.has(item.productType))
    .reduce((sum, item) => sum + item.balance, 0);

  const equity = state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;
  const roe = equity > 0 ? state.financial.incomeStatement.netIncome * 12 / equity : 0;
  const nim = assets > 0 ? state.financial.incomeStatement.netInterestIncome * 12 / assets : 0;
  const loanToDeposit = customerDeposits > 0 ? loans / customerDeposits : 0;
  const liquidAssetShare = assets > 0 ? liquidAssets / assets : 0;
  const rwaDensity = assets > 0 ? risk.rwa / assets : 0;

  const cohorts = Object.values(state.loanCohorts).flatMap((rows) => rows ?? []);
  const grossCohortLoans = cohorts.reduce((sum, cohort) => sum + cohort.outstandingPrincipal, 0);
  const stage23Loans = cohorts
    .filter((cohort) => cohort.stage === 'stage2' || cohort.stage === 'stage3')
    .reduce((sum, cohort) => sum + cohort.outstandingPrincipal, 0);
  const stage3Loans = cohorts
    .filter((cohort) => cohort.stage === 'stage3')
    .reduce((sum, cohort) => sum + cohort.outstandingPrincipal, 0);
  const stage23Share = grossCohortLoans > 0 ? stage23Loans / grossCohortLoans : 0;
  const stage3Share = grossCohortLoans > 0 ? stage3Loans / grossCohortLoans : 0;
  const provisionCoverage = stage3Loans > 0 ? state.financial.provisionStock.total / stage3Loans : null;

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

  const insuredRetailShare = risk.insuredRetailDepositShare ?? state.behaviour.insuredRetailDepositShare;
  const largeDepositorShare = risk.largeDepositorShare ?? state.behaviour.largeDepositorShare;

  return (
    <section className="risk-command stack" aria-label="Risk dashboard">
      <header className="risk-command-header">
        <div>
          <div className="eyebrow">Risk dashboard</div>
          <h2>Bank risk position</h2>
          <p className="muted">Regulatory headroom, structural balance-sheet risk, macro conditions and market shape.</p>
        </div>
        <div className={`risk-command-status status-${status === 'Within limits' ? 'good' : status === 'Attention' ? 'watch' : 'bad'}`}>
          <span>Overall status</span>
          <strong>{status}</strong>
        </div>
      </header>

      <section id="risk-capital-liquidity" className="risk-signal-section">
        <div className="risk-section-heading">
          <div><span className="risk-section-mark risk-mark-regulatory" />Capital & liquidity</div>
          <small>Regulatory requirement and headroom</small>
        </div>
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
      </section>

      <RiskStripSection
        id="risk-balance-sheet"
        title="Balance-sheet risk"
        subtitle="Rate sensitivity, near-term funding and concentration"
        sectionTone="balance"
        className="risk-strip-balance"
      >
        <Metric label="NII +100bp" value={formatCurrency(risk.niiSensitivity100bp)} tone="info" />
        <Metric label="EVE +100bp" value={formatCurrency(risk.eveSensitivity100bp)} tone="info" />
        <Metric label="Funding ≤3m" value={formatCurrency(risk.fundingMaturing3m)} />
        <Metric label="Funding ≤12m" value={formatCurrency(risk.fundingMaturing12m)} />
        <Metric label="Deposit quality" value={formatPct(risk.depositQualityIndex)} />
        <Metric label="Funding confidence" value={formatPct(risk.fundingConfidenceScore)} helper={titleCase(risk.fundingConfidenceState)} tone={fundingTone(risk.fundingConfidenceState)} />
        <Metric label="Largest sector" value={formatPct(risk.sectorConcentration)} tone={limitTone(risk.sectorConcentration, config.riskLimits.concentration.maxSingleSectorShare)} />
        <Metric label="Largest geography" value={formatPct(risk.geographyConcentration)} tone={limitTone(risk.geographyConcentration, config.riskLimits.concentration.maxSingleGeographyShare)} />
      </RiskStripSection>

      <RiskStripSection
        id="risk-structural"
        title="Structural indicators"
        subtitle="Funding mix, liquidity intensity and credit deterioration"
        sectionTone="structural"
        className="risk-strip-structural"
      >
        <Metric label="Loan / deposit" value={formatPct(loanToDeposit)} helper="Net loans ÷ customer deposits" tone="info" />
        <Metric label="Liquid assets / assets" value={formatPct(liquidAssetShare)} helper="Reserves + gilts" tone="info" />
        <Metric label="RWA density" value={formatPct(rwaDensity)} helper="RWA ÷ total assets" tone="info" />
        <Metric label="Stage 2 + 3 loans" value={formatPct(stage23Share)} helper="Share of cohort principal" />
        <Metric label="Stage 3 loans" value={formatPct(stage3Share)} helper="Share of cohort principal" />
        <Metric label="Provision / Stage 3" value={formatOptionalPct(provisionCoverage)} helper="Total provisions ÷ Stage 3" />
        <Metric label="Largest depositor" value={formatOptionalPct(largeDepositorShare)} helper="Share of total deposits" />
        <Metric label="Retail deposits insured" value={formatOptionalPct(insuredRetailShare)} helper="Approx. FSCS-protected share" />
      </RiskStripSection>

      <RiskStripSection
        id="risk-earnings"
        title="Earnings & franchise"
        subtitle="Current earning power and market franchise"
        sectionTone="earnings"
        className="risk-strip-franchise"
      >
        <Metric label="ROE annualised" value={formatPct(roe)} tone={roe < 0 ? 'bad' : 'default'} />
        <Metric label="NIM annualised" value={formatPct(nim)} tone={nim < 0 ? 'bad' : 'default'} />
        <Metric label="Deposit franchise" value={formatPct(state.behaviour.depositFranchiseStrength)} />
        <Metric label="Share price" value={`£${state.equityMarket.sharePrice.toFixed(2)}`} />
        <Metric label="Market cap" value={formatCurrency(state.equityMarket.marketCap)} />
        <Metric label="Total assets" value={formatCurrency(assets)} />
      </RiskStripSection>

      <section id="risk-macro" className="risk-command-panel risk-section-macro">
        <div className="risk-panel-heading">
          <h3><span className="risk-section-mark risk-mark-macro" />Macro model</h3>
          <span>Observed conditions and internal model state</span>
        </div>
        <div className="risk-substrip-label">Observed conditions</div>
        <div className="risk-metric-strip risk-strip-macro-observed" aria-label="Macro observed conditions">
          <Metric label="Regime" value={titleCase(macro.gdpRegime)} tone={macro.gdpRegime === 'recession' ? 'bad' : 'good'} />
          <Metric label="GDP MoM" value={formatSignedPct(state.market.gdpGrowthMoM)} tone="info" />
          <Metric label="Inflation YoY" value={formatPct(state.market.inflationRate)} tone="info" />
          <Metric label="Unemployment" value={formatPct(state.market.unemploymentRate)} tone="info" />
          <Metric label="Bank Rate" value={formatPct(state.market.baseRate)} tone="info" />
          <Metric label="Credit spread" value={formatPct(state.market.creditSpread)} tone="info" />
        </div>
        <div className="risk-substrip-label">Model state</div>
        <div className="risk-metric-strip risk-strip-macro-state" aria-label="Macro model outputs">
          <Metric label="R* real" value={formatPct(rStarReal)} helper="Neutral real rate" tone="info" />
          <Metric label="Neutral nominal" value={formatPct(neutralNominal)} tone="info" />
          <Metric label="Policy target" value={formatPct(policyTarget)} helper="Before smoothing" tone="info" />
          <Metric label="Term premium" value={formatPct(macro.termPremium)} tone="info" />
          <Metric label="Demand (D)" value={formatFactor(factors.D)} />
          <Metric label="Supply (S)" value={formatFactor(factors.S)} />
          <Metric label="Financial stress (F)" value={formatFactor(factors.F)} />
          <Metric label="Neutral-rate factor (R)" value={formatFactor(factors.R)} />
        </div>
      </section>

      <section id="risk-gilt-curve" className="risk-command-panel risk-section-curve">
        <div className="risk-panel-heading">
          <h3><span className="risk-section-mark risk-mark-curve" />Gilt curve</h3>
          <span>Current UK risk-free term structure</span>
        </div>
        <div className="risk-curve-layout">
          <GiltCurveChart yields={yields} />
          <div className="risk-curve-diagnostics" aria-label="Yield curve diagnostics">
            <Metric label="1Y" value={formatPct(yields.y1)} tone="info" />
            <Metric label="10Y" value={formatPct(yields.y10)} tone="info" />
            <Metric label="30Y" value={formatPct(yields.y30)} tone="info" />
            <Metric label="2s10s" value={formatSignedPct(twoTenSlope)} />
            <Metric label="5s30s" value={formatSignedPct(fiveThirtySlope)} />
            <Metric label="NS level β0" value={formatPct(nelsonSiegel.level)} />
            <Metric label="NS slope β1" value={formatSignedPct(nelsonSiegel.slope)} />
            <Metric label="NS curvature β2" value={formatSignedPct(nelsonSiegel.curvature)} />
            <Metric label="NS λ" value={nelsonSiegel.lambda.toFixed(2)} />
          </div>
        </div>
      </section>

      {attribution && (
        <section className="risk-command-panel risk-section-close">
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
  tone?: MetricTone;
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
