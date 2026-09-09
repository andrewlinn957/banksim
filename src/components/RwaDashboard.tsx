import { useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide } from '../domain/enums';
import { UK_ITL1_LABELS, UK_ITL1_REGIONS, UkItl1Region } from '../domain/ukItl1';
import { assetCreditRwa, loanCreditRwaByRegion } from '../engine/creditRwa';
import { formatCurrency, formatPct } from '../utils/formatters';
import TimeSeriesChart from './TimeSeriesChart';
import './RwaDashboard.css';

interface AssetRwaRow {
  label: string;
  exposure: number;
  rwa: number;
  effectiveWeight?: number;
}

export const rwaDashboardData = (state: BankState, config: SimulationConfig) => {
  const assets = state.financial.balanceSheet.items.filter(item => item.side === BalanceSheetSide.Asset);
  const assetRows: AssetRwaRow[] = assets.map(item => {
    const rwa = assetCreditRwa(state, config, item);
    return {
      label: item.label,
      exposure: Math.max(0, item.balance),
      rwa,
      effectiveWeight: item.balance > 0 ? rwa / item.balance : undefined,
    };
  });

  const regionalRwa = Object.fromEntries(
    UK_ITL1_REGIONS.map(region => [region, 0])
  ) as Record<UkItl1Region, number>;
  assets.forEach(item => {
    const byRegion = loanCreditRwaByRegion(state, config, item);
    UK_ITL1_REGIONS.forEach(region => {
      regionalRwa[region] += byRegion[region];
    });
  });

  const creditRwa = assetRows.reduce((sum, row) => sum + row.rwa, 0);
  const loanRwa = UK_ITL1_REGIONS.reduce((sum, region) => sum + regionalRwa[region], 0);
  const totalRwa = state.risk.riskMetrics.rwa;
  const addOns = totalRwa - creditRwa;
  const creditExposure = assetRows.reduce((sum, row) => sum + row.exposure, 0);

  return {
    totalRwa,
    creditRwa,
    loanRwa,
    addOns,
    effectiveCreditWeight: creditExposure > 0 ? creditRwa / creditExposure : NaN,
    regionalRwa,
    assetRows,
  };
};

const MAP_PATHS: Record<UkItl1Region, string> = {
  northernIreland: 'M28 214 L65 200 L90 220 L84 255 L55 274 L28 260 Z',
  scotland: 'M135 20 L205 28 L228 68 L214 110 L236 140 L205 168 L155 162 L132 125 L110 103 L122 58 Z',
  northEast: 'M205 168 L236 140 L251 181 L241 217 L216 226 L201 203 Z',
  northWest: 'M155 162 L205 168 L201 203 L187 232 L147 230 L130 198 Z',
  yorkshireAndTheHumber: 'M187 232 L201 203 L216 226 L241 217 L246 254 L222 273 L187 267 Z',
  westMidlands: 'M147 230 L187 232 L187 267 L173 310 L140 300 L125 265 Z',
  eastMidlands: 'M187 267 L222 273 L231 314 L203 332 L173 310 Z',
  wales: 'M125 265 L140 300 L132 339 L102 358 L82 334 L91 297 Z',
  eastOfEngland: 'M222 273 L246 254 L263 298 L260 345 L232 359 L203 332 L231 314 Z',
  southWest: 'M132 339 L173 310 L203 332 L190 369 L169 405 L130 424 L88 416 L102 385 Z',
  southEast: 'M203 332 L232 359 L260 345 L276 386 L247 416 L213 402 L190 369 Z',
  london: 'M220 356 L233 359 L238 372 L225 378 L215 369 Z',
};

const SummaryCard = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <article className="capital-card rwa-summary-card">
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{sub}</small>
  </article>
);

function RegionMap({ regionalRwa }: { regionalRwa: Record<UkItl1Region, number> }) {
  const [active, setActive] = useState<UkItl1Region | null>(null);
  const maxRwa = Math.max(1, ...UK_ITL1_REGIONS.map(region => regionalRwa[region]));
  const fill = (region: UkItl1Region) => {
    const share = Math.max(0, Math.min(1, regionalRwa[region] / maxRwa));
    return `hsl(207 72% ${92 - share * 48}%)`;
  };
  const selected = active ?? UK_ITL1_REGIONS.reduce(
    (best, region) => regionalRwa[region] > regionalRwa[best] ? region : best,
    UK_ITL1_REGIONS[0]
  );

  return (
    <div className="rwa-map-layout">
      <div className="rwa-map-wrap">
        <svg className="rwa-region-map" viewBox="0 0 320 450" role="img" aria-label="UK loan risk-weighted assets by ITL1 region">
          {UK_ITL1_REGIONS.map(region => (
            <path
              key={region}
              d={MAP_PATHS[region]}
              fill={fill(region)}
              stroke="var(--panel)"
              strokeWidth={region === active ? 4 : 2}
              tabIndex={0}
              data-itl1-region={region}
              aria-label={`${UK_ITL1_LABELS[region]}: ${formatCurrency(regionalRwa[region])} RWA`}
              onMouseEnter={() => setActive(region)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(region)}
              onBlur={() => setActive(null)}
            >
              <title>{UK_ITL1_LABELS[region]} · {formatCurrency(regionalRwa[region])} RWA</title>
            </path>
          ))}
        </svg>
        <div className="rwa-map-scale" aria-label={`Colour scale from £0 to ${formatCurrency(maxRwa)}`}>
          <span>£0</span><i /><span>{formatCurrency(maxRwa)}</span>
        </div>
      </div>
      <div className="rwa-map-detail" aria-live="polite">
        <span>{UK_ITL1_LABELS[selected]}</span>
        <strong>{formatCurrency(regionalRwa[selected])}</strong>
        <small>Loan RWA</small>
        <ol>
          {[...UK_ITL1_REGIONS]
            .sort((a, b) => regionalRwa[b] - regionalRwa[a])
            .map(region => (
              <li key={region} className={region === active ? 'active' : ''}>
                <span>{UK_ITL1_LABELS[region]}</span><b>{formatCurrency(regionalRwa[region])}</b>
              </li>
            ))}
        </ol>
      </div>
    </div>
  );
}

export default function RwaDashboard({ state, config, history }: { state: BankState; config: SimulationConfig; history: BankState[] }) {
  const d = useMemo(() => rwaDashboardData(state, config), [state, config]);
  const compositionRows = [
    ...d.assetRows,
    { label: 'Configured risk add-ons', exposure: 0, rwa: d.addOns, effectiveWeight: undefined },
  ];
  const maxComposition = Math.max(1, ...compositionRows.map(row => Math.max(0, row.rwa)));
  const historyWithCurrent = history.length === 0 || history[history.length - 1]?.time.step !== state.time.step
    ? [...history, state]
    : history;

  return (
    <div className="rwa-dashboard">
      <div className="rwa-summary-grid">
        <SummaryCard label="Total RWA" value={formatCurrency(d.totalRwa)} sub="All risk-weighted assets" />
        <SummaryCard label="Credit RWA" value={formatCurrency(d.creditRwa)} sub={d.totalRwa > 0 ? `${formatPct(d.creditRwa / d.totalRwa)} of total` : 'N/A'} />
        <SummaryCard label="Loan RWA" value={formatCurrency(d.loanRwa)} sub={d.creditRwa > 0 ? `${formatPct(d.loanRwa / d.creditRwa)} of credit RWA` : 'N/A'} />
        <SummaryCard label="Effective credit RW" value={formatPct(d.effectiveCreditWeight)} sub="RWA / on-balance-sheet assets" />
      </div>

      <div className="rwa-main-grid">
        <section className="capital-card rwa-map-card">
          <div className="rwa-card-heading"><div><h3>UK loan RWA by region</h3><p>12 UK ITL1 statistical regions</p></div><strong>{formatCurrency(d.loanRwa)}</strong></div>
          <RegionMap regionalRwa={d.regionalRwa} />
        </section>

        <section className="capital-card rwa-composition-card">
          <div className="rwa-card-heading"><div><h3>RWA composition</h3><p>Credit exposures and configured add-ons</p></div><strong>{formatCurrency(d.totalRwa)}</strong></div>
          <div className="rwa-bars">
            {compositionRows.map(row => (
              <div className="rwa-bar-row" key={row.label}>
                <div><span>{row.label}</span><strong>{formatCurrency(row.rwa)}</strong></div>
                <div className="rwa-bar-track"><i style={{ width: `${Math.max(0, row.rwa) / maxComposition * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="table-wrap rwa-detail-table">
            <table>
              <thead><tr><th>Exposure</th><th className="align-right">Balance</th><th className="align-right">RWA</th><th className="align-right">Effective RW</th></tr></thead>
              <tbody>
                {d.assetRows.map(row => (
                  <tr key={row.label}><td>{row.label}</td><td className="align-right">{formatCurrency(row.exposure)}</td><td className="align-right">{formatCurrency(row.rwa)}</td><td className="align-right">{row.effectiveWeight === undefined ? '·' : formatPct(row.effectiveWeight)}</td></tr>
                ))}
                <tr><td>Configured risk add-ons</td><td className="align-right">·</td><td className="align-right">{formatCurrency(d.addOns)}</td><td className="align-right">·</td></tr>
                <tr className="total-row"><td>Total RWA</td><td className="align-right">·</td><td className="align-right">{formatCurrency(d.totalRwa)}</td><td className="align-right">·</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="capital-card rwa-history-card">
        <div className="rwa-card-heading"><div><h3>Risk-weighted assets over time</h3><p>Total RWA trend</p></div><strong>{formatCurrency(d.totalRwa)}</strong></div>
        <div className="rwa-history-chart">
          <TimeSeriesChart
            data={historyWithCurrent.map(s => ({ step: s.time.step, value: s.risk.riskMetrics.rwa / 1e9 }))}
            xLabel="Month"
            yLabel="RWA (£bn)"
          />
        </div>
      </section>
    </div>
  );
}
