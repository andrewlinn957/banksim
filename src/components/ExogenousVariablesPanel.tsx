import { MarketState } from '../domain/market';
import { SimulationConfig } from '../domain/config';

interface Props {
  market: MarketState;
  config: SimulationConfig;
}

const formatPct = (value: number, digits: number = 2): string =>
  Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : 'N/A';

const formatSignedPct = (value: number, digits: number = 2): string => {
  if (!Number.isFinite(value)) return 'N/A';
  const pct = (value * 100).toFixed(digits);
  return `${value > 0 ? '+' : ''}${pct}%`;
};

const formatNumber = (value: number, digits: number = 2): string =>
  Number.isFinite(value) ? value.toFixed(digits) : 'N/A';

const formatCurrency = (value: number): string => {
  if (!Number.isFinite(value)) return 'N/A';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `Aœ${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 2)}bn`;
  if (abs >= 1e6) return `Aœ${(value / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}m`;
  return `Aœ${value.toFixed(0)}`;
};

const formatMultiple = (value: number, digits: number = 2): string =>
  Number.isFinite(value) ? `${value.toFixed(digits)}x` : 'N/A';

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

const ExogenousVariablesPanel = ({ market, config }: Props) => {
  const yields = market.giltCurve.yields;
  const ns = market.giltCurve.nelsonSiegel;
  const factors = market.macroModel.factors;

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
          <Metric label="Regime" value={market.macroModel.gdpRegime} helper="Can be either normal or recession." />
          <Metric label="GDP (MoM)" value={formatSignedPct(market.gdpGrowthMoM)} helper="Monthly GDP growth." />
          <Metric label="Inflation (YoY)" value={formatPct(market.inflationRate)} helper="Sticky CPI-like process." />
          <Metric label="Unemployment" value={formatPct(market.unemploymentRate)} />
          <Metric label="Bank Rate" value={formatPct(market.baseRate)} helper="Policy rule with inertia." />
          <Metric label="Macro Credit Spread" value={formatPct(market.creditSpread)} helper="Wider in financial stress / weak labour." />
          <Metric label="Demand" value={formatNumber(factors.D)} helper="(+) means positive demand shock" />
          <Metric label="Supply)" value={formatNumber(factors.S)} helper="(+) means positive supply shock"/>
          <Metric label="Financial Conditions" value={formatNumber(factors.F)} helper="(+) means tighter conditions"/>
          <Metric label="R* (Neutral real)" value={formatNumber(factors.R)} />
          <Metric label="RNG Seed" value={`${market.macroModel.rngSeed}`} helper="Deterministic path for reproducibility." />
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
            <Row label="1Y" value={formatPct(yields.y1)} />
            <Row label="2Y" value={formatPct(yields.y2)} />
            <Row label="3Y" value={formatPct(yields.y3)} />
            <Row label="5Y" value={formatPct(yields.y5)} />
            <Row label="10Y" value={formatPct(yields.y10)} />
            <Row label="20Y" value={formatPct(yields.y20)} />
            <Row label="30Y" value={formatPct(yields.y30)} />
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
            <Row label="Competitor Mortgage Rate" value={formatPct(market.competitorMortgageRate)} />
            <Row label="Competitor Corporate Loan Rate" value={formatPct(market.riskFreeLong + market.corporateLoanSpread)} />
            <Row label="Competitor retail deposit rate" value={formatPct(market.competitorRetailDepositRate)} />
            <Row label="Competitor corporate deposit rate" value={maybeRate(market.competitorCorporateDepositRate)} />
            <Row label="ST Wholesale funding spread (over 1y gilt)" value={formatPct(market.wholesaleFundingSpread)} />
            <Row label="LT wholesale funding spread (over 30y gilt)" value={formatPct(market.seniorDebtSpread)} />
            <Row label="Gilt repo haircut" value={formatPct(market.giltRepoHaircut)} />
            <Row label="Corp bond repo haircut" value={formatPct(market.corpBondRepoHaircut)} />
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
            <Row label="Tax rate" value={formatPct(config.global.taxRate)} />
            <Row label="Operating cost ratio (annual)" value={formatPct(config.global.operatingCostRatio)} />
            <Row label="Fixed operating cost (monthly)" value={formatCurrency(config.global.fixedOperatingCostPerMonth ?? 0)} />
            <Row label="Max deposit growth (per step)" value={formatPct(config.global.maxDepositGrowthPerStep)} />
            <Row label="Max loan growth (per step)" value={formatPct(config.global.maxLoanGrowthPerStep)} />
            <Row label="Min CET1 ratio" value={formatPct(config.riskLimits.minCet1Ratio)} />
            <Row label="Min leverage ratio" value={formatPct(config.riskLimits.minLeverageRatio)} />
            <Row label="Min LCR" value={formatMultiple(config.riskLimits.minLcr)} />
            <Row label="Min NSFR" value={formatMultiple(config.riskLimits.minNsfr)} />
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExogenousVariablesPanel;
