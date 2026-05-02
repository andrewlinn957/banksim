import { useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import TimeSeriesChart from './TimeSeriesChart';
import { SeriesPoint } from '../types/statements';
import { formatCurrency, formatMultiple, formatPct, formatSignedPct } from '../utils/formatters';

type SeriesKey = 'sharePrice' | 'marketCap' | 'epsTtm' | 'peMultiple' | 'priceToBook';

interface Props {
  state: BankState;
  history: BankState[];
  config: SimulationConfig;
}

interface SeriesOption {
  key: SeriesKey;
  label: string;
  yLabel: string;
}

const SERIES_OPTIONS: SeriesOption[] = [
  { key: 'sharePrice', label: 'Share Price', yLabel: 'Share price (GBP)' },
  { key: 'marketCap', label: 'Market Cap', yLabel: 'Market cap' },
  { key: 'epsTtm', label: 'EPS (TTM)', yLabel: 'EPS (GBP)' },
  { key: 'peMultiple', label: 'P/E', yLabel: 'P/E multiple' },
  { key: 'priceToBook', label: 'P/B', yLabel: 'Price / book' },
];

const seriesFromHistory = (history: BankState[], selector: (state: BankState) => number): SeriesPoint[] =>
  history.map((snapshot) => ({ step: snapshot.time.step, value: selector(snapshot) }));

const buildMonthChange = (series: SeriesPoint[]): number | null => {
  if (series.length < 2) return null;
  const ordered = [...series].sort((a, b) => a.step - b.step);
  const latest = ordered[ordered.length - 1];
  const prior = [...ordered].reverse().find((point) => point.step < latest.step);
  if (!prior || !Number.isFinite(prior.value) || prior.value === 0 || !Number.isFinite(latest.value)) {
    return null;
  }
  return (latest.value - prior.value) / Math.abs(prior.value);
};

const formatGbp = (value: number, digits = 2): string =>
  Number.isFinite(value) ? `GBP ${value.toFixed(digits)}` : 'N/A';

const formatSharesOutstanding = (value: number): string => {
  if (!Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}bn`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}m`;
  return `${Math.round(value)}`;
};

const SharePricePanel = ({ state, history, config }: Props) => {
  const [activeSeries, setActiveSeries] = useState<SeriesKey>('sharePrice');

  const seriesMap = useMemo(
    () => ({
      sharePrice: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.sharePrice),
      marketCap: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.marketCap),
      epsTtm: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.epsTtm),
      peMultiple: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.peMultiple),
      priceToBook: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.priceToBook ?? 0),
    }),
    [history]
  );

  const selectedSeriesOption = SERIES_OPTIONS.find((option) => option.key === activeSeries) ?? SERIES_OPTIONS[0];
  const selectedSeries = seriesMap[selectedSeriesOption.key];
  const selectedSeriesMoM = buildMonthChange(selectedSeries);
  const selectedSeriesMoMClass =
    selectedSeriesMoM === null
      ? 'muted'
      : selectedSeriesMoM > 0
        ? 'numeric positive'
        : selectedSeriesMoM < 0
          ? 'numeric negative'
          : 'muted';

  const commonEquity = state.financial.capital.cet1 + state.financial.capital.accumulatedOCI;
  const sharesOutstanding = Math.max(1, state.equityMarket.sharesOutstanding);
  const bvps = state.equityMarket.bookValuePerShare ?? commonEquity / sharesOutstanding;
  const roeProxy = bvps > 0 ? state.equityMarket.epsTtm / bvps : Number.NaN;
  const cet1Headroom = state.risk.riskMetrics.cet1Ratio - state.risk.riskMetrics.cet1Requirement;
  const leverageHeadroom = state.risk.riskMetrics.leverageRatio - config.riskLimits.minLeverageRatio;
  const priceToBook = state.equityMarket.priceToBook ?? (bvps > 0 ? state.equityMarket.sharePrice / bvps : Number.NaN);
  const marketToBook = commonEquity > 0 ? state.equityMarket.marketCap / commonEquity : Number.NaN;

  return (
    <div className="stack">
      <div className="grid-metrics">
        <MetricCard label="Share Price" value={formatGbp(state.equityMarket.sharePrice)} />
        <MetricCard label="Market Cap" value={formatCurrency(state.equityMarket.marketCap)} />
        <MetricCard label="EPS (TTM proxy)" value={formatGbp(state.equityMarket.epsTtm, 3)} />
        <MetricCard label="P/E" value={formatMultiple(state.equityMarket.peMultiple)} />
        <MetricCard label="Fair Value / Share" value={formatGbp(state.equityMarket.fairValuePerShare ?? state.equityMarket.sharePrice)} />
        <MetricCard label="Shares Outstanding" value={formatSharesOutstanding(state.equityMarket.sharesOutstanding)} />
        <MetricCard label="Price / Book" value={formatMultiple(priceToBook)} />
        <MetricCard label="Market / Book" value={formatMultiple(marketToBook)} />
        <MetricCard label="Common BV / Share" value={formatGbp(bvps, 3)} />
      </div>

      <div className="card stack">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 2 }}>
            <div className="eyebrow">Trend</div>
            <h3>{selectedSeriesOption.label}</h3>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {SERIES_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`button small ${activeSeries === option.key ? 'primary' : 'ghost'}`}
                onClick={() => setActiveSeries(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="muted">
          Latest MoM move:{' '}
          <span className={selectedSeriesMoMClass}>
            {selectedSeriesMoM === null ? '-' : formatSignedPct(selectedSeriesMoM)}
          </span>
        </div>
        <TimeSeriesChart data={selectedSeries} yLabel={selectedSeriesOption.yLabel} xTickInterval={12} />
      </div>

      <div className="card stack">
        <div className="eyebrow">Model Inputs</div>
        <h3>Share Price Driver Snapshot</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th className="numeric">Current</th>
              <th className="numeric">Reference</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Profitability (ROE proxy)</td>
              <td className="numeric">{formatPct(roeProxy)}</td>
              <td className="numeric">EPS / common BVPS</td>
            </tr>
            <tr>
              <td>Capital strength: CET1 headroom</td>
              <td className={`numeric ${cet1Headroom >= 0 ? 'positive' : 'negative'}`}>{formatSignedPct(cet1Headroom)}</td>
              <td className="numeric">vs CET1 requirement</td>
            </tr>
            <tr>
              <td>Capital strength: leverage headroom</td>
              <td className={`numeric ${leverageHeadroom >= 0 ? 'positive' : 'negative'}`}>
                {formatSignedPct(leverageHeadroom)}
              </td>
              <td className="numeric">vs min leverage ratio</td>
            </tr>
            <tr>
              <td>Macro: GDP growth (monthly)</td>
              <td className="numeric">{formatPct(state.market.gdpGrowthMoM)}</td>
              <td className="numeric">Higher tends to support valuation</td>
            </tr>
            <tr>
              <td>Macro: unemployment rate</td>
              <td className="numeric">{formatPct(state.market.unemploymentRate)}</td>
              <td className="numeric">Lower tends to support valuation</td>
            </tr>
            <tr>
              <td>Macro: credit spread</td>
              <td className="numeric">{formatPct(state.market.creditSpread)}</td>
              <td className="numeric">Lower tends to support valuation</td>
            </tr>
            <tr>
              <td>Franchise strength</td>
              <td className="numeric">{formatPct(state.behaviour.depositFranchiseStrength)}</td>
              <td className="numeric">Deposit franchise score</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const MetricCard = ({ label, value }: { label: string; value: string }) => (
  <div className="metric-card">
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
  </div>
);

export default SharePricePanel;
