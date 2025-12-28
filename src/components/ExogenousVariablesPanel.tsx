import { MarketState } from '../domain/market';
import { SimulationConfig } from '../domain/config';
import { formatPct, formatSignedPct, formatNumber, formatMultiple, formatCurrency } from '../utils/formatters';

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

const Row = ({ label, value }: { label: string; value: string }) => (
  <tr>
    <td>{label}</td>
    <td className="align-right" style={{ fontWeight: 600 }}>
      {value}
    </td>
  </tr>
);

const maybeRate = (value: number | undefined, digits: number = 2): string =>
  value === undefined ? 'N/A' : formatPct(value, digits);

const selectMacroMetrics = (market: MarketState): MetricItem[] => {
  const { gdpGrowthMoM, inflationRate, unemploymentRate, baseRate, creditSpread, macroModel } = market;
  const { gdpRegime, rngSeed, factors } = macroModel;

  return [
    { label: 'Regime', value: gdpRegime, helper: 'Can be either normal or recession.' },
    { label: 'GDP (MoM)', value: formatSignedPct(gdpGrowthMoM), helper: 'Monthly GDP growth.' },
    { label: 'Inflation (YoY)', value: formatPct(inflationRate), helper: 'Sticky CPI-like process.' },
    { label: 'Unemployment', value: formatPct(unemploymentRate) },
    { label: 'Bank Rate', value: formatPct(baseRate), helper: 'Policy rule with inertia.' },
    { label: 'Macro Credit Spread', value: formatPct(creditSpread), helper: 'Wider in financial stress / weak labour.' },
    { label: 'Demand', value: formatNumber(factors.D), helper: '(+) means positive demand shock' },
    { label: 'Supply)', value: formatNumber(factors.S), helper: '(+) means positive supply shock' },
    { label: 'Financial Conditions', value: formatNumber(factors.F), helper: '(+) means tighter conditions' },
    { label: 'R* (Neutral real)', value: formatNumber(factors.R) },
    { label: 'RNG Seed', value: `${rngSeed}`, helper: 'Deterministic path for reproducibility.' },
  ];
};

const selectGiltRows = (market: MarketState): RowItem[] => {
  const { yields } = market.giltCurve;

  return [
    { label: '1Y', value: formatPct(yields.y1) },
    { label: '2Y', value: formatPct(yields.y2) },
    { label: '3Y', value: formatPct(yields.y3) },
    { label: '5Y', value: formatPct(yields.y5) },
    { label: '10Y', value: formatPct(yields.y10) },
    { label: '20Y', value: formatPct(yields.y20) },
    { label: '30Y', value: formatPct(yields.y30) },
  ];
};

const selectFundingRows = (market: MarketState): RowItem[] => {
  const {
    competitorMortgageRate,
    competitorRetailDepositRate,
    competitorCorporateDepositRate,
    wholesaleFundingSpread,
    seniorDebtSpread,
    giltRepoHaircut,
    corpBondRepoHaircut,
    riskFreeLong,
    corporateLoanSpread,
  } = market;

  return [
    { label: 'Competitor Mortgage Rate', value: formatPct(competitorMortgageRate) },
    {
      label: 'Competitor Corporate Loan Rate',
      value: formatPct(riskFreeLong + corporateLoanSpread),
    },
    { label: 'Competitor retail deposit rate', value: formatPct(competitorRetailDepositRate) },
    { label: 'Competitor corporate deposit rate', value: maybeRate(competitorCorporateDepositRate) },
    { label: 'ST Wholesale funding spread (over 1y gilt)', value: formatPct(wholesaleFundingSpread) },
    { label: 'LT wholesale funding spread (over 30y gilt)', value: formatPct(seniorDebtSpread) },
    { label: 'Gilt repo haircut', value: formatPct(giltRepoHaircut) },
    { label: 'Corp bond repo haircut', value: formatPct(corpBondRepoHaircut) },
  ];
};

const selectSimulationRows = (config: SimulationConfig): RowItem[] => {
  const { global, riskLimits } = config;

  return [
    { label: 'Tax rate', value: formatPct(global.taxRate) },
    { label: 'Operating cost ratio (annual)', value: formatPct(global.operatingCostRatio) },
    { label: 'Fixed operating cost (monthly)', value: formatCurrency(global.fixedOperatingCostPerMonth ?? 0) },
    { label: 'Max deposit growth (per step)', value: formatPct(global.maxDepositGrowthPerStep) },
    { label: 'Max loan growth (per step)', value: formatPct(global.maxLoanGrowthPerStep) },
    { label: 'Min CET1 ratio', value: formatPct(riskLimits.minCet1Ratio) },
    { label: 'Min leverage ratio', value: formatPct(riskLimits.minLeverageRatio) },
    { label: 'Min LCR', value: formatMultiple(riskLimits.minLcr) },
    { label: 'Min NSFR', value: formatMultiple(riskLimits.minNsfr) },
  ];
};

const ExogenousVariablesPanel = ({ market, config }: Props) => {
  const macroMetrics = selectMacroMetrics(market);
  const giltRows = selectGiltRows(market);
  const fundingRows = selectFundingRows(market);
  const simulationRows = selectSimulationRows(config);

  return (
    <div className="grid-two">
      <div className="card stack">
        <div>
          <div className="eyebrow">Exogenous variables</div>
          <h3>UK Macro State</h3>
          <p className="muted" style={{ marginTop: 4 }}>
            Structural factors (D/S/F/R) drive GDP, inflation, unemployment, policy rate, the curve, and spreads.
          </p>
        </div>

        <div className="grid-metrics">
          {macroMetrics.map((metric) => (
            <Metric key={metric.label} {...metric} />
          ))}
        </div>
      </div>

      <div className="card stack">
        <div>
          <div className="eyebrow">Risk-free curve</div>
          <h3>Gilt Curve</h3>
          <p className="muted" style={{ marginTop: 4 }}>
            1y/5y/20y anchors are fit each month and other tenors are interpolated
          </p>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Tenor</th>
              <th className="align-right">Yield</th>
            </tr>
          </thead>
          <tbody>
            {giltRows.map((row) => (
              <Row key={row.label} {...row} />
            ))}
          </tbody>
        </table>

      </div>

      <div className="card stack">
        <div>
          <div className="eyebrow">Funding environment</div>
          <h3>Spreads, Haircuts, Competition</h3>
        </div>

        <table className="data-table">
          <tbody>
            {fundingRows.map((row) => (
              <Row key={row.label} {...row} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card stack">
        <div>
          <div className="eyebrow">Model inputs</div>
          <h3>Simulation Parameters</h3>
        </div>

        <table className="data-table">
          <tbody>
            {simulationRows.map((row) => (
              <Row key={row.label} {...row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExogenousVariablesPanel;
