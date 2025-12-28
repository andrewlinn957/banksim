import { RiskMetrics } from '../domain/risks';
import { formatPct, formatCurrency } from '../utils/formatters';

interface Props {
  riskMetrics: RiskMetrics;
  equity: number;
  assets: number;
  roe: number;
  nim: number;
}

const TopMetricsPanel = ({ riskMetrics, equity, assets, roe, nim }: Props) => {
  return (
    <div className="grid-metrics">
      <Metric
        label="CET1 Ratio"
        value={formatPct(riskMetrics.cet1Ratio)}
        helper="CET1 capital divided by risk-weighted assets (>= limit to avoid breach)."
      />
      <Metric
        label="Leverage Ratio"
        value={formatPct(riskMetrics.leverageRatio)}
        helper="Tier 1 capital over total exposure; backstop against model risk."
      />
      <Metric
        label="LCR"
        value={formatPct(riskMetrics.lcr)}
        helper="High-quality liquid assets over 30-day stressed net outflows."
      />
      <Metric
        label="NSFR"
        value={formatPct(riskMetrics.nsfr)}
        helper="Available stable funding over required stable funding (1-year view)."
      />
      <Metric label="ROE (annualised)" value={formatPct(roe)} helper="Net income annualised over common equity." />
      <Metric label="NIM (annualised)" value={formatPct(nim)} helper="Net interest income over average assets." />
      <Metric label="Equity" value={`£${(equity / 1e9).toFixed(1)}bn`} helper="CET1 + AT1 capital." />
      <Metric label="Total Assets" value={`£${(assets / 1e9).toFixed(1)}bn`} helper="Balance sheet size." />
    </div>
  );
};

const Metric = ({ label, value, helper }: { label: string; value: string; helper?: string }) => (
  <div className="metric-card">
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
    {helper && <div className="metric-helper">{helper}</div>}
  </div>
);

export default TopMetricsPanel;
