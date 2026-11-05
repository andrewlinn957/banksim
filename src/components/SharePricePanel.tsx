import { useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { BalanceSheetSide } from '../domain/enums';
import { SimulationConfig } from '../domain/config';
import TimeSeriesChart from './TimeSeriesChart';
import { SeriesPoint } from '../types/statements';
import { formatCurrency, formatMultiple, formatPct, formatSignedPct } from '../utils/formatters';

type SeriesKey = 'sharePrice' | 'marketCap' | 'epsTtm' | 'trailingEps' | 'peMultiple' | 'quotedPeSmoothed' | 'quotedPeTtm' | 'priceToBook';

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
  { key: 'epsTtm', label: 'Smoothed annualised EPS', yLabel: 'Smoothed annualised EPS (GBP)' },
  { key: 'trailingEps', label: 'TTM EPS', yLabel: 'TTM EPS (GBP)' },
  { key: 'peMultiple', label: 'Model P/E', yLabel: 'Model P/E multiple' },
  { key: 'quotedPeSmoothed', label: 'Quoted P/E (smoothed)', yLabel: 'Quoted P/E (smoothed EPS)' },
  { key: 'quotedPeTtm', label: 'Quoted P/E (TTM)', yLabel: 'Quoted P/E (TTM EPS)' },
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
      epsTtm: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.smoothedAnnualisedEps ?? snapshot.equityMarket.epsTtm),
      trailingEps: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.trailingEps ?? Number.NaN),
      quotedPeSmoothed: seriesFromHistory(history, (snapshot) => quotedPe(snapshot.equityMarket.sharePrice, snapshot.equityMarket.smoothedAnnualisedEps ?? snapshot.equityMarket.epsTtm)),
      quotedPeTtm: seriesFromHistory(history, (snapshot) => quotedPe(snapshot.equityMarket.sharePrice, snapshot.equityMarket.trailingEps)),
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

  const commonEquity = state.financial.balanceSheet.items.reduce((sum, item) => sum + (item.side === BalanceSheetSide.Asset ? item.balance : -item.balance), 0) - state.financial.capital.at1;
  const smoothedEps = state.equityMarket.smoothedAnnualisedEps ?? state.equityMarket.epsTtm;
  const trailingEps = state.equityMarket.trailingEps;
  const valuation = state.periodFlows?.shareValuation;
  const sharesOutstanding = Math.max(1, state.equityMarket.sharesOutstanding);
  const bvps = state.equityMarket.bookValuePerShare ?? commonEquity / sharesOutstanding;
  const roeProxy = bvps > 0 ? smoothedEps / bvps : Number.NaN;
  const cet1Headroom = state.risk.riskMetrics.cet1Ratio - state.risk.riskMetrics.cet1Requirement;
  const leverageHeadroom = state.risk.riskMetrics.leverageRatio - config.riskLimits.minLeverageRatio;
  const priceToBook = state.equityMarket.priceToBook ?? (bvps > 0 ? state.equityMarket.sharePrice / bvps : Number.NaN);
  const marketToBook = commonEquity > 0 ? state.equityMarket.marketCap / commonEquity : Number.NaN;

  return (
    <div className="stack">
      <div className="grid-metrics">
        <MetricCard label="Share Price" value={formatGbp(state.equityMarket.sharePrice)} />
        <MetricCard label="Market Cap" value={formatCurrency(state.equityMarket.marketCap)} />
        <MetricCard label="Smoothed annualised EPS" value={formatGbp(smoothedEps, 4)} />
        <MetricCard label="TTM EPS" value={formatGbp(trailingEps ?? Number.NaN, 4)} helper={trailingEps == null ? `${(state.equityMarket.trailingEarningsMonths ?? 0).toFixed(0)} of 12 months recorded` : undefined} />
        <MetricCard label="Model P/E" value={formatMultiple(state.equityMarket.peMultiple)} />
        <MetricCard label="Quoted P/E (smoothed)" value={formatMultiple(quotedPe(state.equityMarket.sharePrice, smoothedEps))} />
        <MetricCard label="Quoted P/E (TTM)" value={formatMultiple(quotedPe(state.equityMarket.sharePrice, trailingEps))} />
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
              <td className="numeric">Smoothed annualised EPS / common BVPS</td>
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
              <td className="numeric">{formatPct(valuation?.gdpGrowthMoM ?? state.market.gdpGrowthMoM)}</td>
              <td className="numeric">Higher tends to support valuation</td>
            </tr>
            <tr>
              <td>Macro: unemployment rate</td>
              <td className="numeric">{formatPct(valuation?.unemploymentRate ?? state.market.unemploymentRate)}</td>
              <td className="numeric">Lower tends to support valuation</td>
            </tr>
            <tr>
              <td>Macro: credit spread</td>
              <td className="numeric">{formatPct(valuation?.creditSpread ?? state.market.creditSpread)}</td>
              <td className="numeric">Lower tends to support valuation</td>
            </tr>
            {valuation && <>
              <tr><td>Cost of equity</td><td className="numeric">{formatPct(valuation.costOfEquity)}</td><td className="numeric">At latest valuation</td></tr>
              <tr><td>Earnings reliability</td><td className="numeric">{formatPct(valuation.earningsReliability)}</td><td className="numeric">Earnings / book blend</td></tr>
            </>}
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

const quotedPe = (price: number, eps: number | null | undefined): number =>
  eps != null && eps > 0 ? price / eps : Number.NaN;

const MetricCard = ({ label, value, helper }: { label: string; value: string; helper?: string }) => (
  <div className="metric-card">
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
    {helper && <div className="metric-helper">{helper}</div>}
  </div>
);

export default SharePricePanel;
