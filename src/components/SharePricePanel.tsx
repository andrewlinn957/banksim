import { useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import TimeSeriesChart from './TimeSeriesChart';
import { formatCurrency, formatMultiple, formatPct, formatSignedPct } from '../utils/formatters';
import { buildMonthChange, buildSharePriceReportData, quotedPe, SHARE_PRICE_SERIES_OPTIONS, type SharePriceSeriesKey } from '../presentation/reports/sharePrice';

interface Props {
  state: BankState;
  history: BankState[];
  config: SimulationConfig;
}

const formatGbp = (value: number, digits = 2): string =>
  Number.isFinite(value) ? `GBP ${value.toFixed(digits)}` : 'N/A';

const formatSharesOutstanding = (value: number): string => {
  if (!Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}bn`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}m`;
  return `${Math.round(value)}`;
};

const SharePricePanel = ({ state, history, config }: Props) => {
  const [activeSeries, setActiveSeries] = useState<SharePriceSeriesKey>('sharePrice');
  const report = useMemo(() => buildSharePriceReportData(state, history, config), [state, history, config]);
  const seriesMap = report.series;
  const drivers = report.drivers;

  const selectedSeriesOption = SHARE_PRICE_SERIES_OPTIONS.find((option) => option.key === activeSeries) ?? SHARE_PRICE_SERIES_OPTIONS[0];
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

  return (
    <div className="stack">
      <div className="grid-metrics">
        <MetricCard label="Share Price" value={formatGbp(drivers.sharePrice)} />
        <MetricCard label="Market Cap" value={formatCurrency(drivers.marketCap)} />
        <MetricCard label="Smoothed annualised EPS" value={formatGbp(drivers.smoothedEps, 4)} />
        <MetricCard label="TTM EPS" value={formatGbp(drivers.trailingEps ?? Number.NaN, 4)} helper={drivers.trailingEps == null ? `${drivers.recordedEarningsMonths.toFixed(0)} of 12 months recorded` : undefined} />
        <MetricCard label="Model P/E" value={formatMultiple(drivers.modelPe)} />
        <MetricCard label="Quoted P/E (smoothed)" value={formatMultiple(quotedPe(drivers.sharePrice, drivers.smoothedEps))} />
        <MetricCard label="Quoted P/E (TTM)" value={formatMultiple(quotedPe(drivers.sharePrice, drivers.trailingEps))} />
        <MetricCard label="Fair Value / Share" value={formatGbp(drivers.fairValuePerShare)} />
        <MetricCard label="Shares Outstanding" value={formatSharesOutstanding(drivers.sharesOutstanding)} />
        <MetricCard label="Price / Book" value={formatMultiple(drivers.priceToBook)} />
        <MetricCard label="Market / Book" value={formatMultiple(drivers.marketToBook)} />
        <MetricCard label="Common BV / Share" value={formatGbp(drivers.bvps, 3)} />
      </div>

      <div className="card stack">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div className="stack" style={{ gap: 2 }}>
            <div className="eyebrow">Trend</div>
            <h3>{selectedSeriesOption.label}</h3>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {SHARE_PRICE_SERIES_OPTIONS.map((option) => (
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
              <td className="numeric">{formatPct(drivers.roeProxy)}</td>
              <td className="numeric">Smoothed annualised EPS / common BVPS</td>
            </tr>
            <tr>
              <td>Capital strength: CET1 headroom</td>
              <td className={`numeric ${drivers.cet1Headroom >= 0 ? 'positive' : 'negative'}`}>{formatSignedPct(drivers.cet1Headroom)}</td>
              <td className="numeric">vs CET1 requirement</td>
            </tr>
            <tr>
              <td>Capital strength: leverage headroom</td>
              <td className={`numeric ${drivers.leverageHeadroom >= 0 ? 'positive' : 'negative'}`}>
                {formatSignedPct(drivers.leverageHeadroom)}
              </td>
              <td className="numeric">vs min leverage ratio</td>
            </tr>
            <tr>
              <td>Macro: GDP growth (monthly)</td>
              <td className="numeric">{formatPct(drivers.gdpGrowthMoM)}</td>
              <td className="numeric">Higher tends to support valuation</td>
            </tr>
            <tr>
              <td>Macro: unemployment rate</td>
              <td className="numeric">{formatPct(drivers.unemploymentRate)}</td>
              <td className="numeric">Lower tends to support valuation</td>
            </tr>
            <tr>
              <td>Macro: credit spread</td>
              <td className="numeric">{formatPct(drivers.creditSpread)}</td>
              <td className="numeric">Lower tends to support valuation</td>
            </tr>
            {report.hasLatestValuation && <>
              <tr><td>Cost of equity</td><td className="numeric">{formatPct(drivers.costOfEquity ?? Number.NaN)}</td><td className="numeric">At latest valuation</td></tr>
              <tr><td>Earnings reliability</td><td className="numeric">{formatPct(drivers.earningsReliability ?? Number.NaN)}</td><td className="numeric">Earnings / book blend</td></tr>
            </>}
            <tr>
              <td>Franchise strength</td>
              <td className="numeric">{formatPct(drivers.depositFranchiseStrength)}</td>
              <td className="numeric">Deposit franchise score</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const MetricCard = ({ label, value, helper }: { label: string; value: string; helper?: string }) => (
  <div className="metric-card">
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
    {helper && <div className="metric-helper">{helper}</div>}
  </div>
);

export default SharePricePanel;
