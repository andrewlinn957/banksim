import { MarketState } from '../domain/market';
import { SimulationConfig } from '../domain/config';
import { formatPct, formatSignedPct, formatMultiple } from '../utils/formatters';

interface Props {
  market: MarketState;
  config: SimulationConfig;
}

type MetricItem = {
  label: string;
  value: string;
  helper?: string;
};

type RowItem = {
  label: string;
  value: string;
};

const Metric = ({ label, value, helper }: { label: string; value: string; helper?: string }) => (
  <div className="metric-card">
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
    {helper && <div className="metric-helper">{helper}</div>}
  </div>
);

const Row = ({ label, value }: RowItem) => (
  <tr>
    <td>{label}</td>
    <td className="align-right" style={{ fontWeight: 600 }}>{value}</td>
  </tr>
);

const maybeRate = (value: number | undefined, digits: number = 2): string =>
  value === undefined ? 'N/A' : formatPct(value, digits);

const selectMacroMetrics = (market: MarketState): MetricItem[] => [
  { label: 'Regime', value: market.macroModel.gdpRegime, helper: 'Normal or recession.' },
  { label: 'GDP (MoM)', value: formatSignedPct(market.gdpGrowthMoM), helper: 'Current monthly activity signal.' },
  { label: 'Inflation (YoY)', value: formatPct(market.inflationRate) },
  { label: 'Unemployment', value: formatPct(market.unemploymentRate) },
  { label: 'Bank Rate', value: formatPct(market.baseRate) },
  { label: 'Credit spread', value: formatPct(market.creditSpread), helper: 'Wider spreads tighten corporate credit conditions.' },
];

const selectGiltRows = (market: MarketState): RowItem[] => {
  const { yields } = market.giltCurve;
  return [
    { label: '1Y', value: formatPct(yields.y1) },
    { label: '2Y', value: formatPct(yields.y2) },
    { label: '5Y', value: formatPct(yields.y5) },
    { label: '10Y', value: formatPct(yields.y10) },
    { label: '20Y', value: formatPct(yields.y20) },
    { label: '30Y', value: formatPct(yields.y30) },
  ];
};

const selectMarketRows = (market: MarketState): RowItem[] => [
  { label: 'Competitor mortgage rate', value: formatPct(market.competitorMortgageRate) },
  { label: 'Competitor corporate loan rate', value: formatPct(market.riskFreeLong + market.corporateLoanSpread) },
  { label: 'Competitor retail deposit rate', value: formatPct(market.competitorRetailCurrentAccountRate) },
  { label: 'Competitor corporate deposit rate', value: maybeRate(market.competitorCorporateDepositRate) },
  { label: 'Short-term wholesale funding spread', value: formatPct(market.wholesaleFundingSpread) },
  { label: 'Long-term wholesale funding spread', value: formatPct(market.seniorDebtSpread) },
];

const selectRequirements = (config: SimulationConfig): RowItem[] => [
  { label: 'Minimum CET1 ratio', value: formatPct(config.riskLimits.minCet1Ratio) },
  { label: 'Minimum leverage ratio', value: formatPct(config.riskLimits.minLeverageRatio) },
  { label: 'Minimum LCR', value: formatMultiple(config.riskLimits.minLcr) },
  { label: 'Minimum NSFR', value: formatMultiple(config.riskLimits.minNsfr) },
];

const ExogenousVariablesPanel = ({ market, config }: Props) => {
  const macroMetrics = selectMacroMetrics(market);
  const giltRows = selectGiltRows(market);
  const marketRows = selectMarketRows(market);
  const requirements = selectRequirements(config);

  return (
    <div className="grid-two">
      <div className="card stack">
        <div>
          <div className="eyebrow">Economic environment</div>
          <h3>UK macro state</h3>
          <p className="muted" style={{ marginTop: 4 }}>
            Activity, labour markets and borrowing conditions feed loan demand, credit risk, rates and funding costs.
          </p>
        </div>
        <div className="grid-metrics">
          {macroMetrics.map((metric) => <Metric key={metric.label} {...metric} />)}
        </div>
      </div>

      <div className="card stack">
        <div>
          <div className="eyebrow">Risk-free curve</div>
          <h3>Gilt curve</h3>
        </div>
        <table className="data-table"><tbody>{giltRows.map((row) => <Row key={row.label} {...row} />)}</tbody></table>
      </div>

      <div className="card stack">
        <div>
          <div className="eyebrow">Market pricing</div>
          <h3>Competition and funding</h3>
        </div>
        <table className="data-table"><tbody>{marketRows.map((row) => <Row key={row.label} {...row} />)}</tbody></table>
      </div>

      <div className="card stack">
        <div>
          <div className="eyebrow">Regulatory reference</div>
          <h3>Core minimums</h3>
          <p className="muted" style={{ marginTop: 4 }}>Detailed capital and liquidity requirements remain in the Regulatory report.</p>
        </div>
        <table className="data-table"><tbody>{requirements.map((row) => <Row key={row.label} {...row} />)}</tbody></table>
      </div>
    </div>
  );
};

export default ExogenousVariablesPanel;
