import { ReactNode } from 'react';
import { RiskMetrics } from '../domain/risks';
import { SimulationConfig } from '../domain/config';
import { formatPct, formatCurrency, formatSignedPct } from '../utils/formatters';
import HelpLink from './HelpLink';
import InfoTooltip from './InfoTooltip';

interface Props {
  riskMetrics: RiskMetrics;
  config: SimulationConfig;
  gdpGrowthMoM: number;
  inflationRate: number;
  unemploymentRate: number;
  baseRate: number;
  creditSpread: number;
  equity: number;
  assets: number;
  sharePrice: number;
  marketCap: number;
  epsTtm: number;
  peMultiple: number;
  roe: number;
  nim: number;
  depositFranchiseStrength: number;
  depositFranchiseDeltaMoM: number | null;
  onNavigateHelp?: (sectionId: string) => void;
}

const TopMetricsPanel = ({
  riskMetrics,
  config,
  gdpGrowthMoM,
  inflationRate,
  unemploymentRate,
  baseRate,
  creditSpread,
  equity,
  assets,
  sharePrice,
  marketCap,
  epsTtm,
  peMultiple,
  roe,
  nim,
  depositFranchiseStrength,
  depositFranchiseDeltaMoM,
  onNavigateHelp,
}: Props) => {
  const cet1HardDistance = riskMetrics.cet1Ratio - config.riskLimits.minCet1Ratio;
  const leverageHardDistance = riskMetrics.leverageRatio - config.riskLimits.minLeverageRatio;
  const lcrHardDistance = riskMetrics.lcr - config.riskLimits.minLcr;
  const nsfrHardDistance = riskMetrics.nsfr - config.riskLimits.minNsfr;
  const confidenceStateLabel =
    riskMetrics.fundingConfidenceState.charAt(0).toUpperCase() + riskMetrics.fundingConfidenceState.slice(1);
  const payoutHelper = riskMetrics.payoutBlockedByInternalTarget
    ? 'Internal capital target binding: distributions clipped before hard MDA breach.'
    : riskMetrics.mdaTriggered
      ? 'MDA active: payout constrained.'
      : 'No MDA constraint currently binding.';

  return (
    <div className="metric-groups">
      <MetricGroup title="Macro">
        <Metric label="GDP (MoM)" value={formatSignedPct(gdpGrowthMoM)} helper="Monthly growth signal." />
        <Metric label="Inflation (YoY)" value={formatPct(inflationRate)} helper="CPI-style inflation state." />
        <Metric label="Unemployment" value={formatPct(unemploymentRate)} helper="Labour market pressure." />
        <Metric label="Bank Rate" value={formatPct(baseRate)} helper="Policy-rate level." />
        <Metric label="Credit Spread" value={formatPct(creditSpread)} helper="Macro credit-risk premium." />
      </MetricGroup>

      <MetricGroup title="Regulatory">
        <Metric
          label="CET1 Ratio"
          value={formatPct(riskMetrics.cet1Ratio)}
          helper="CET1 capital over risk-weighted assets."
          tooltip={`Hard minimum ${formatPct(config.riskLimits.minCet1Ratio)}. Distance ${formatSignedPct(cet1HardDistance)}. Combined requirement ${formatPct(riskMetrics.cet1Requirement)}.`}
          helpSectionId="risk-metrics-and-compliance"
          onNavigateHelp={onNavigateHelp}
        />
        <Metric
          label="Leverage Ratio"
          value={formatPct(riskMetrics.leverageRatio)}
          helper="Tier 1 capital over total exposure."
          tooltip={`Hard minimum ${formatPct(config.riskLimits.minLeverageRatio)}. Distance ${formatSignedPct(leverageHardDistance)}.`}
          helpSectionId="risk-metrics-and-compliance"
          onNavigateHelp={onNavigateHelp}
        />
        <Metric
          label="LCR"
          value={formatPct(riskMetrics.lcr)}
          helper="Liquidity coverage over stressed outflows."
          tooltip={`Hard minimum ${formatPct(config.riskLimits.minLcr)}. Distance ${formatSignedPct(lcrHardDistance)}.`}
          helpSectionId="liquidity-ratios"
          onNavigateHelp={onNavigateHelp}
        />
        <Metric
          label="NSFR"
          value={formatPct(riskMetrics.nsfr)}
          helper="Stable funding over required funding."
          tooltip={`Hard minimum ${formatPct(config.riskLimits.minNsfr)}. Distance ${formatSignedPct(nsfrHardDistance)}.`}
          helpSectionId="liquidity-ratios"
          onNavigateHelp={onNavigateHelp}
        />
        <Metric
          label="CET1 Requirement"
          value={formatPct(riskMetrics.cet1Requirement)}
          helper="Minimum plus buffer stack."
        />
        <Metric
          label="CET1 Headroom"
          value={formatPct(riskMetrics.cet1Headroom)}
          helper="Distance to combined CET1 requirement."
        />
        <Metric
          label="Payout Cap"
          value={formatPct(riskMetrics.maxPayoutRatio)}
          helper={payoutHelper}
          tooltip={`Current payout cap ${formatPct(riskMetrics.maxPayoutRatio)}. Internal target headroom ${formatPct(riskMetrics.internalCet1Headroom)}.`}
          helpSectionId="capital-policy-and-distributions"
          onNavigateHelp={onNavigateHelp}
        />
      </MetricGroup>

      <MetricGroup title="Risk">
        <Metric
          label="NII +100bp"
          value={formatCurrency(riskMetrics.niiSensitivity100bp)}
          helper="1Y earnings sensitivity to rate shock."
        />
        <Metric
          label="EVE +100bp"
          value={formatCurrency(riskMetrics.eveSensitivity100bp)}
          helper="Economic value sensitivity to rate shock."
        />
        <Metric
          label="Funding <=3m"
          value={formatCurrency(riskMetrics.fundingMaturing3m)}
          helper="Funding wall within 3 months."
        />
        <Metric
          label="Funding <=12m"
          value={formatCurrency(riskMetrics.fundingMaturing12m)}
          helper="Funding wall within 12 months."
        />
        <Metric
          label="Sector Concentration"
          value={formatPct(riskMetrics.sectorConcentration)}
          helper="Largest sector share."
        />
        <Metric
          label="Geography Concentration"
          value={formatPct(riskMetrics.geographyConcentration)}
          helper="Largest geography share."
        />
        <Metric
          label="Board Pressure"
          value={riskMetrics.boardPressureScore.toFixed(1)}
          helper="Composite soft-pressure score (0-100)."
          tooltip="Composite of earnings volatility, franchise gap, and risk gap."
          helpSectionId="board-pressure"
          onNavigateHelp={onNavigateHelp}
        />
      </MetricGroup>

      <MetricGroup title="Franchise">
        <Metric
          label="Deposit Quality"
          value={formatPct(riskMetrics.depositQualityIndex)}
          helper="Stability score of customer deposits."
        />
        <Metric
          label="Confidence State"
          value={confidenceStateLabel}
          helper="Funding-access regime."
          tooltip={`Current confidence score ${formatPct(riskMetrics.fundingConfidenceScore)}.`}
          helpSectionId="confidence-state-machine"
          onNavigateHelp={onNavigateHelp}
        />
        <Metric
          label="Funding Confidence"
          value={formatPct(riskMetrics.fundingConfidenceScore)}
          helper="Market confidence proxy."
          tooltip={`Higher score improves rollover access. Current state ${confidenceStateLabel}.`}
          helpSectionId="confidence-state-machine"
          onNavigateHelp={onNavigateHelp}
        />
        <Metric
          label="Deposit Franchise"
          value={formatPct(depositFranchiseStrength)}
          helper={
            depositFranchiseDeltaMoM === null
              ? 'Long-run behavioural franchise score.'
              : `MoM ${formatSignedPct(depositFranchiseDeltaMoM)} from repricing and churn effects.`
          }
        />
      </MetricGroup>

      <MetricGroup title="Business">
        <Metric label="ROE (annualised)" value={formatPct(roe)} helper="Net income over common equity." />
        <Metric label="NIM (annualised)" value={formatPct(nim)} helper="Net interest income over assets." />
        <Metric
          label="Share Price"
          value={`GBP ${sharePrice.toFixed(2)}`}
          helper="Model price from profitability and resilience."
        />
        <Metric
          label="Market Cap"
          value={`GBP ${(marketCap / 1e9).toFixed(2)}bn`}
          helper="Share price times shares."
        />
        <Metric
          label="EPS (TTM proxy)"
          value={`GBP ${epsTtm.toFixed(3)}`}
          helper="Smoothed annualised EPS."
        />
        <Metric
          label="P/E"
          value={`${peMultiple.toFixed(2)}x`}
          helper="Implied valuation multiple."
        />
        <Metric label="Equity" value={`GBP ${(equity / 1e9).toFixed(1)}bn`} helper="CET1 + AT1 + OCI." />
        <Metric label="Total Assets" value={`GBP ${(assets / 1e9).toFixed(1)}bn`} helper="Balance sheet size." />
      </MetricGroup>
    </div>
  );
};

const MetricGroup = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="metric-group stack">
    <div className="metric-group-title">{title}</div>
    <div className="grid-metrics">{children}</div>
  </section>
);

const Metric = ({
  label,
  value,
  helper,
  tooltip,
  helpSectionId,
  onNavigateHelp,
}: {
  label: string;
  value: string;
  helper?: string;
  tooltip?: string;
  helpSectionId?: string;
  onNavigateHelp?: (sectionId: string) => void;
}) => (
  <div className="metric-card">
    <div className="metric-label metric-label-row">
      <span>{label}</span>
      {tooltip && <InfoTooltip label={`About ${label}`} content={<span>{tooltip}</span>} />}
      {helpSectionId && onNavigateHelp ? (
        <HelpLink label="Open help" sectionId={helpSectionId} onNavigate={onNavigateHelp} />
      ) : null}
    </div>
    <div className="metric-value">{value}</div>
    {helper && <div className="metric-helper">{helper}</div>}
  </div>
);

export default TopMetricsPanel;
