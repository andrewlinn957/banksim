import { useEffect, useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide, LiabilityProductType, ProductType } from '../domain/enums';
import { formatCurrency, formatPct, formatChange, buildValueTicks, formatAxisValue } from '../utils/formatters';
import { SeriesPoint, StatementRow } from '../types/statements';

type MetricKey = 'rwa' | 'leverage' | 'nsfr' | 'lcr' | 'capital';

interface Props {
  state: BankState;
  history: BankState[];
  config: SimulationConfig;
}

interface ColumnDef {
  id: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: StatementRow) => React.ReactNode;
}

const HQLA_FACTORS: Record<string, number> = {
  Level1: 1.0,
  Level2A: 0.85,
  Level2B: 0.5,
  None: 0,
};

const formatFactor = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(0)}%`;

const seriesFromHistory = (history: BankState[], selector: (s: BankState) => number): SeriesPoint[] =>
  history.map((s) => ({ step: s.time.step, value: selector(s) }));

const buildMonthChange = (series: SeriesPoint[]): number | null => {
  if (series.length < 2) return null;
  const ordered = [...series].sort((a, b) => a.step - b.step);
  const latest = ordered[ordered.length - 1];
  const prior = ordered.find((p) => p.step === latest.step - 1);
  if (!prior || prior.value === 0) return null;
  if (!Number.isFinite(latest.value) || !Number.isFinite(prior.value)) return null;
  return ((latest.value - prior.value) / Math.abs(prior.value)) * 100;
};

const findItem = (state: BankState, productType: ProductType): BalanceSheetItem | undefined =>
  state.financial.balanceSheet.items.find((i) => i.productType === productType);

const isStressDepositOutflow = (productType: ProductType): boolean =>
  productType === LiabilityProductType.RetailDeposits || productType === LiabilityProductType.CorporateDeposits;

const computeRwaRows = (state: BankState, history: BankState[], config: SimulationConfig): StatementRow[] => {
  const assetItems = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);

  const rows = assetItems.map((item) => {
    const rw = config.productParameters[item.productType]?.riskWeight ?? 0;
    const series = seriesFromHistory(history, (s) => {
      const match = findItem(s, item.productType);
      return (match?.balance ?? 0) * rw;
    });
    return {
      id: item.productType,
      label: item.label,
      value: item.balance * rw,
      changePct: buildMonthChange(series),
      series,
      meta: { exposure: item.balance, riskWeight: rw },
    };
  });

  const totalSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.rwa);
  rows.push({
    id: 'rwa-total',
    label: 'Total RWA',
    value: state.risk.riskMetrics.rwa,
    changePct: buildMonthChange(totalSeries),
    series: totalSeries,
    meta: { exposure: assetItems.reduce((sum, a) => sum + a.balance, 0) },
  });

  return rows;
};

const computeLeverageRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const assets = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);

  const rows: StatementRow[] = assets.map((item) => {
    const series = seriesFromHistory(history, (s) => findItem(s, item.productType)?.balance ?? 0);
    return {
      id: `lev-${item.productType}`,
      label: item.label,
      value: item.balance,
      changePct: buildMonthChange(series),
      series,
      meta: { category: 'Exposure' },
    };
  });

  const exposureSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.leverageExposure);
  rows.push({
    id: 'lev-total-exposure',
    label: 'Total exposure',
    value: state.risk.riskMetrics.leverageExposure,
    changePct: buildMonthChange(exposureSeries),
    series: exposureSeries,
    meta: { category: 'Exposure' },
  });

  const tier1Series = seriesFromHistory(history, (s) => s.financial.capital.cet1 + s.financial.capital.at1);
  rows.push({
    id: 'lev-tier1',
    label: 'Tier 1 capital',
    value: state.financial.capital.cet1 + state.financial.capital.at1,
    changePct: buildMonthChange(tier1Series),
    series: tier1Series,
    meta: { category: 'Capital' },
  });

  const ratioSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.leverageRatio);
  rows.push({
    id: 'lev-ratio',
    label: 'Leverage ratio',
    value: state.risk.riskMetrics.leverageRatio,
    changePct: buildMonthChange(ratioSeries),
    series: ratioSeries,
    display: 'percent',
    meta: { category: 'Ratio' },
  });

  return rows;
};

const computeNsfrRows = (state: BankState, history: BankState[], config: SimulationConfig): StatementRow[] => {
  const rows: StatementRow[] = [];

  const assets = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);
  assets.forEach((item) => {
    const factor = item.liquidityTag?.nsfrRsfFactor ?? config.liquidityTags[item.productType]?.nsfrRsfFactor ?? 0;
    const series = seriesFromHistory(history, (s) => {
      const match = findItem(s, item.productType);
      return (match?.balance ?? 0) * factor;
    });
    rows.push({
      id: `nsfr-rsf-${item.productType}`,
      label: item.label,
      value: item.balance * factor,
      changePct: buildMonthChange(series),
      series,
      meta: { leg: 'RSF', base: item.balance, factor },
    });
  });

  const liabilities = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Liability);
  liabilities.forEach((item) => {
    const factor = item.liquidityTag?.nsfrAsfFactor ?? config.liquidityTags[item.productType]?.nsfrAsfFactor ?? 0;
    const series = seriesFromHistory(history, (s) => {
      const match = findItem(s, item.productType);
      return (match?.balance ?? 0) * factor;
    });
    rows.push({
      id: `nsfr-asf-${item.productType}`,
      label: item.label,
      value: item.balance * factor,
      changePct: buildMonthChange(series),
      series,
      meta: { leg: 'ASF', base: item.balance, factor },
    });
  });

  const capitalLegs: Array<{ id: string; label: string; base: number }> = [
    { id: 'cet1', label: 'CET1 capital', base: state.financial.capital.cet1 },
    { id: 'at1', label: 'AT1 capital', base: state.financial.capital.at1 },
  ];
  capitalLegs.forEach((cap) => {
    const series = seriesFromHistory(history, (s) =>
      cap.id === 'cet1' ? s.financial.capital.cet1 : s.financial.capital.at1
    );
    rows.push({
      id: `nsfr-asf-${cap.id}`,
      label: cap.label,
      value: cap.base, // factor = 1
      changePct: buildMonthChange(series),
      series,
      meta: { leg: 'ASF', base: cap.base, factor: 1 },
    });
  });

  const asfSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.asf);
  const rsfSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.rsf);
  const nsfrSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.nsfr);

  rows.push(
    {
      id: 'nsfr-total-asf',
      label: 'Total ASF',
      value: state.risk.riskMetrics.asf,
      changePct: buildMonthChange(asfSeries),
      series: asfSeries,
      meta: { leg: 'ASF total', factor: undefined, base: undefined },
    },
    {
      id: 'nsfr-total-rsf',
      label: 'Total RSF',
      value: state.risk.riskMetrics.rsf,
      changePct: buildMonthChange(rsfSeries),
      series: rsfSeries,
      meta: { leg: 'RSF total', factor: undefined, base: undefined },
    },
    {
      id: 'nsfr-ratio',
      label: 'NSFR',
      value: state.risk.riskMetrics.nsfr,
      changePct: buildMonthChange(nsfrSeries),
      series: nsfrSeries,
      display: 'percent',
      meta: { leg: 'Ratio', factor: undefined, base: undefined },
    }
  );

  return rows;
};

const computeLcrComponents = (state: BankState) => {
  let outflows = 0;
  let inflows = 0;
  let hqla = 0;
  const outflowMultiplier = state.risk.riskMetrics.lcrOutflowMultiplier ?? 1;

  state.financial.balanceSheet.items.forEach((item) => {
    const tag = item.liquidityTag;
    const encumbered = item.encumbrance?.encumberedAmount ?? 0;
    const unencumbered = Math.max(0, item.balance - encumbered);
    if (tag?.lcrOutflowRate !== undefined) {
      const effRate = isStressDepositOutflow(item.productType)
        ? tag.lcrOutflowRate * outflowMultiplier
        : tag.lcrOutflowRate;
      outflows += item.balance * effRate;
    }
    if (tag?.lcrInflowRate !== undefined) {
      inflows += item.balance * tag.lcrInflowRate;
    }
    const factor = HQLA_FACTORS[tag?.hqlaLevel ?? 'None'] ?? 0;
    if (factor > 0) {
      hqla += unencumbered * factor;
    }
  });

  const inflowsCapped = Math.min(inflows, 0.75 * outflows);
  const netOutflows = Math.max(0, outflows - inflowsCapped);

  return { outflows, inflows, inflowsCapped, netOutflows, hqla };
};

const computeLcrRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const rows: StatementRow[] = [];

  // HQLA rows
  state.financial.balanceSheet.items.forEach((item) => {
    const tag = item.liquidityTag;
    const factor = HQLA_FACTORS[tag?.hqlaLevel ?? 'None'] ?? 0;
    if (factor <= 0) return;
    const encumbered = item.encumbrance?.encumberedAmount ?? 0;
    const unencumbered = Math.max(0, item.balance - encumbered);
    const series = seriesFromHistory(history, (s) => {
      const match = findItem(s, item.productType);
      const enc = match?.encumbrance?.encumberedAmount ?? 0;
      const unenc = Math.max(0, (match?.balance ?? 0) - enc);
      return unenc * factor;
    });
    rows.push({
      id: `lcr-hqla-${item.productType}`,
      label: `${item.label} (HQLA)`,
      value: unencumbered * factor,
      changePct: buildMonthChange(series),
      series,
      meta: { leg: 'HQLA', base: unencumbered, factor },
    });
  });

  // Outflows
  state.financial.balanceSheet.items.forEach((item) => {
    const rate = item.liquidityTag?.lcrOutflowRate;
    if (rate === undefined) return;
    const effectiveRate = isStressDepositOutflow(item.productType)
      ? rate * (state.risk.riskMetrics.lcrOutflowMultiplier ?? 1)
      : rate;
    const series = seriesFromHistory(history, (s) => {
      const mult = s.risk.riskMetrics.lcrOutflowMultiplier ?? 1;
      const perStateRate = isStressDepositOutflow(item.productType) ? rate * mult : rate;
      return (findItem(s, item.productType)?.balance ?? 0) * perStateRate;
    });
    rows.push({
      id: `lcr-out-${item.productType}`,
      label: `${item.label} outflow`,
      value: item.balance * effectiveRate,
      changePct: buildMonthChange(series),
      series,
      meta: { leg: 'Outflow', base: item.balance, factor: effectiveRate },
    });
  });

  // Inflows
  state.financial.balanceSheet.items.forEach((item) => {
    const rate = item.liquidityTag?.lcrInflowRate;
    if (rate === undefined) return;
    const series = seriesFromHistory(history, (s) => (findItem(s, item.productType)?.balance ?? 0) * rate);
    rows.push({
      id: `lcr-in-${item.productType}`,
      label: `${item.label} inflow`,
      value: item.balance * rate,
      changePct: buildMonthChange(series),
      series,
      meta: { leg: 'Inflow', base: item.balance, factor: rate },
    });
  });

  const currentTotals = computeLcrComponents(state);
  const outflowSeries = seriesFromHistory(history, (s) => computeLcrComponents(s).outflows);
  const inflowSeries = seriesFromHistory(history, (s) => computeLcrComponents(s).inflows);
  const inflowCapSeries = seriesFromHistory(history, (s) => computeLcrComponents(s).inflowsCapped);
  const netOutflowSeries = seriesFromHistory(history, (s) => computeLcrComponents(s).netOutflows);
  const hqlaSeries = seriesFromHistory(history, (s) => computeLcrComponents(s).hqla);
  const lcrSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.lcr);

  rows.push(
    {
      id: 'lcr-total-hqla',
      label: 'Total HQLA',
      value: currentTotals.hqla,
      changePct: buildMonthChange(hqlaSeries),
      series: hqlaSeries,
      meta: { leg: 'HQLA total' },
    },
    {
      id: 'lcr-total-outflows',
      label: 'Total outflows',
      value: currentTotals.outflows,
      changePct: buildMonthChange(outflowSeries),
      series: outflowSeries,
      meta: { leg: 'Outflow total' },
    },
    {
      id: 'lcr-total-inflows',
      label: 'Total inflows',
      value: currentTotals.inflows,
      changePct: buildMonthChange(inflowSeries),
      series: inflowSeries,
      meta: { leg: 'Inflow total' },
    },
    {
      id: 'lcr-cap-inflows',
      label: 'Inflows capped (75% of outflows)',
      value: currentTotals.inflowsCapped,
      changePct: buildMonthChange(inflowCapSeries),
      series: inflowCapSeries,
      meta: { leg: 'Cap' },
    },
    {
      id: 'lcr-net-outflows',
      label: 'Net outflows',
      value: currentTotals.netOutflows,
      changePct: buildMonthChange(netOutflowSeries),
      series: netOutflowSeries,
      meta: { leg: 'Net outflow' },
    },
    {
      id: 'lcr-ratio',
      label: 'LCR',
      value: state.risk.riskMetrics.lcr,
      changePct: buildMonthChange(lcrSeries),
      series: lcrSeries,
      display: 'percent',
      meta: { leg: 'Ratio' },
    }
  );

  return rows;
};

const computeCapitalRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const cet1Series = seriesFromHistory(history, (s) => s.financial.capital.cet1);
  const at1Series = seriesFromHistory(history, (s) => s.financial.capital.at1);
  const tier1Series = seriesFromHistory(history, (s) => s.financial.capital.cet1 + s.financial.capital.at1);
  const rwaSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.rwa);
  const cet1RatioSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.cet1Ratio);
  const levRatioSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.leverageRatio);

  return [
    {
      id: 'cap-cet1',
      label: 'CET1 capital',
      value: state.financial.capital.cet1,
      changePct: buildMonthChange(cet1Series),
      series: cet1Series,
      meta: { type: 'Capital' },
    },
    {
      id: 'cap-at1',
      label: 'AT1 capital',
      value: state.financial.capital.at1,
      changePct: buildMonthChange(at1Series),
      series: at1Series,
      meta: { type: 'Capital' },
    },
    {
      id: 'cap-tier1',
      label: 'Tier 1 capital',
      value: state.financial.capital.cet1 + state.financial.capital.at1,
      changePct: buildMonthChange(tier1Series),
      series: tier1Series,
      meta: { type: 'Capital' },
    },
    {
      id: 'cap-rwa',
      label: 'Risk weighted assets',
      value: state.risk.riskMetrics.rwa,
      changePct: buildMonthChange(rwaSeries),
      series: rwaSeries,
      meta: { type: 'Buffer' },
    },
    {
      id: 'cap-cet1-ratio',
      label: 'CET1 ratio',
      value: state.risk.riskMetrics.cet1Ratio,
      changePct: buildMonthChange(cet1RatioSeries),
      series: cet1RatioSeries,
      display: 'percent',
      meta: { type: 'Ratio' },
    },
    {
      id: 'cap-lev-ratio',
      label: 'Leverage ratio',
      value: state.risk.riskMetrics.leverageRatio,
      changePct: buildMonthChange(levRatioSeries),
      series: levRatioSeries,
      display: 'percent',
      meta: { type: 'Ratio' },
    },
  ];
};

const TimeSeriesChart = ({
  data,
  xLabel = 'Simulation step',
  yLabel = 'Value',
  xTickInterval = 12,
}: {
  data: SeriesPoint[];
  xLabel?: string;
  yLabel?: string;
  xTickInterval?: number;
}) => {
  const finiteData = data.filter((d) => Number.isFinite(d.value));

  if (!finiteData.length) {
    return (
      <div className="series-chart empty">
        <div className="muted">No history yet — run the simulation to build a trend.</div>
      </div>
    );
  }

  const values = finiteData.map((d) => d.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const yTicks = buildValueTicks(min, max, 5);
  const scaleMin = yTicks.length ? Math.min(min, ...yTicks) : min;
  const scaleMax = yTicks.length ? Math.max(max, ...yTicks) : max;
  const rawRange = scaleMax - scaleMin;
  const range = rawRange === 0 ? Math.max(Math.abs(scaleMax), 1) : rawRange;
  const zeroWithinRange = scaleMin < 0 && scaleMax > 0;
  const zeroY = 100 - ((0 - scaleMin) / range) * 100;

  const steps = finiteData.map((d) => d.step);
  const minStep = Math.min(...steps);
  const maxStep = Math.max(...steps);
  const stepRange = Math.max(1, maxStep - minStep);

  const points = finiteData.map((point) => {
    const x = ((point.step - minStep) / stepRange) * 100;
    const y = 100 - ((point.value - scaleMin) / range) * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const areaPoints = `${points.join(' ')} 100,100 0,100`;

  const ticks: number[] = [];
  const interval = Math.max(1, xTickInterval);
  ticks.push(minStep);
  for (let s = Math.ceil(minStep / interval) * interval; s < maxStep; s += interval) {
    if (s > minStep && s < maxStep) ticks.push(s);
  }
  if (maxStep !== minStep) ticks.push(maxStep);

  return (
    <div className="series-chart">
      <div className="series-plot">
        <div className="axis-label y-axis-label">{yLabel}</div>
        <div className="axis-ticks y-axis-ticks">
          {yTicks.map((tick) => {
            const bottom = ((tick - scaleMin) / range) * 100;
            return (
              <span key={tick} style={{ bottom: `${bottom}%` }}>
                {formatAxisValue(tick, yLabel)}
              </span>
            );
          })}
        </div>
        <div className="plot-body">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Time series">
            <defs>
              <linearGradient id="series-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {zeroWithinRange && <line x1="0" y1={zeroY} x2="100" y2={zeroY} className="series-zero" />}
            <polygon className="series-area" points={areaPoints} fill="url(#series-fill)" />
            <polyline className="series-line" points={points.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />
          </svg>
          <div className="axis-ticks x-axis-ticks">
            {ticks.map((tick) => {
              const left = ((tick - minStep) / stepRange) * 100;
              return (
                <span key={tick} style={{ left: `${left}%` }}>
                  {tick}
                </span>
              );
            })}
          </div>
          <div className="axis-label x-axis-label">{xLabel}</div>
        </div>
      </div>
    </div>
  );
};

const StatementSection = ({
  title,
  subtitle,
  rows,
  columns,
  selectedId,
  onSelect,
  isOpen,
  onToggle,
  valueHeader = 'Value',
  valueFormatter,
  yLabelForRow,
}: {
  title: string;
  subtitle: string;
  rows: StatementRow[];
  columns?: ColumnDef[];
  selectedId?: string;
  onSelect: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  valueHeader?: string;
  valueFormatter?: (row: StatementRow) => string;
  yLabelForRow?: (row: StatementRow | undefined) => string;
}) => {
  const activeRow = rows.find((r) => r.id === selectedId) ?? rows[0];
  const changeClass = (value: number | null) =>
    value === null ? 'muted' : value > 0 ? 'positive' : value < 0 ? 'negative' : 'muted';
  const yLabel = yLabelForRow ? yLabelForRow(activeRow) : 'Value';

  const renderValue = (row: StatementRow) => {
    if (valueFormatter) return valueFormatter(row);
    if (row.display === 'percent') return formatPct(row.value);
    return formatCurrency(row.value);
  };

  return (
    <div className="card statement-card">
      <div className="statement-header">
        <div>
          <div className="eyebrow">{subtitle}</div>
          <h3>{title}</h3>
        </div>
        <div className="statement-header-actions">
          <button className="button ghost small" type="button" onClick={onToggle}>
            {isOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="statement-body">
          <div className="statement-table">
            <table className="data-table clickable">
              <thead>
                <tr>
                  <th>Line item</th>
                  {columns?.map((col) => (
                    <th key={col.id} className={col.align === 'right' ? 'numeric' : undefined}>
                      {col.label}
                    </th>
                  ))}
                  <th className="numeric">{valueHeader}</th>
                  <th className="numeric">MoM</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={row.id === activeRow?.id ? 'active' : ''}
                    onClick={() => onSelect(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(row.id);
                      }
                    }}
                    tabIndex={0}
                    aria-selected={row.id === activeRow?.id}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{row.label}</td>
                    {columns?.map((col) => (
                      <td key={col.id} className={col.align === 'right' ? 'numeric' : undefined}>
                        {col.render(row)}
                      </td>
                    ))}
                    <td className="numeric">{renderValue(row)}</td>
                    <td className={`numeric ${changeClass(row.changePct)}`}>{formatChange(row.changePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="statement-chart">
            {activeRow ? (
              <>
                <div className="chart-meta">
                  <div>
                    <div className="eyebrow">Time series</div>
                    <div className="chart-title">{activeRow.label}</div>
                  </div>
                  <div className="chart-pills">
                    <span className="pill">Now {renderValue(activeRow)}</span>
                    <span className={`pill ${changeClass(activeRow.changePct)}`}>MoM {formatChange(activeRow.changePct)}</span>
                  </div>
                </div>
                <TimeSeriesChart data={activeRow.series} yLabel={yLabel} xTickInterval={12} />
              </>
            ) : (
              <div className="muted">Select a line item to plot.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ensureSelection = (
  rows: StatementRow[],
  selectedId: string | undefined,
  setSelected: (id: string) => void
) => {
  if (!rows.length) return;
  const exists = rows.some((r) => r.id === selectedId);
  if (!selectedId || !exists) {
    setSelected(rows[0].id);
  }
};

const RegMetricsPanel = ({ state, history, config }: Props) => {
  const rwaRows = useMemo(() => computeRwaRows(state, history, config), [state, history, config]);
  const leverageRows = useMemo(() => computeLeverageRows(state, history), [state, history]);
  const nsfrRows = useMemo(() => computeNsfrRows(state, history, config), [state, history, config]);
  const lcrRows = useMemo(() => computeLcrRows(state, history), [state, history]);
  const capitalRows = useMemo(() => computeCapitalRows(state, history), [state, history]);

  const [selected, setSelected] = useState<Partial<Record<MetricKey, string>>>({});
  const [open, setOpen] = useState<Record<MetricKey, boolean>>({
    rwa: true,
    leverage: true,
    nsfr: true,
    lcr: true,
    capital: true,
  });

  useEffect(() => {
    ensureSelection(rwaRows, selected.rwa, (id) => setSelected((prev) => ({ ...prev, rwa: id })));
  }, [rwaRows, selected.rwa]);

  useEffect(() => {
    ensureSelection(leverageRows, selected.leverage, (id) => setSelected((prev) => ({ ...prev, leverage: id })));
  }, [leverageRows, selected.leverage]);

  useEffect(() => {
    ensureSelection(nsfrRows, selected.nsfr, (id) => setSelected((prev) => ({ ...prev, nsfr: id })));
  }, [nsfrRows, selected.nsfr]);

  useEffect(() => {
    ensureSelection(lcrRows, selected.lcr, (id) => setSelected((prev) => ({ ...prev, lcr: id })));
  }, [lcrRows, selected.lcr]);

  useEffect(() => {
    ensureSelection(capitalRows, selected.capital, (id) => setSelected((prev) => ({ ...prev, capital: id })));
  }, [capitalRows, selected.capital]);

  return (
    <div className="stack">
      <StatementSection
        title="Risk-weighted assets"
        subtitle="RWA stack by product"
        rows={rwaRows}
        columns={[
          { id: 'exposure', label: 'Exposure', align: 'right', render: (row) => formatCurrency(Number(row.meta?.exposure ?? 0)) },
          { id: 'rw', label: 'RW', align: 'right', render: (row) => formatPct(Number(row.meta?.riskWeight ?? 0)) },
        ]}
        valueHeader="RWA"
        selectedId={selected.rwa}
        onSelect={(id) => setSelected((prev) => ({ ...prev, rwa: id }))}
        isOpen={open.rwa}
        onToggle={() => setOpen((prev) => ({ ...prev, rwa: !prev.rwa }))}
        yLabelForRow={(row) => (row?.display === 'percent' ? 'Ratio (%)' : '£ (bn)')}
      />

      <StatementSection
        title="Leverage ratio"
        subtitle="Exposure vs Tier 1 capital"
        rows={leverageRows}
        columns={[
          { id: 'category', label: 'Category', align: 'left', render: (row) => row.meta?.category ?? '—' },
        ]}
        valueHeader="Value"
        valueFormatter={(row) => (row.display === 'percent' ? formatPct(row.value) : formatCurrency(row.value))}
        selectedId={selected.leverage}
        onSelect={(id) => setSelected((prev) => ({ ...prev, leverage: id }))}
        isOpen={open.leverage}
        onToggle={() => setOpen((prev) => ({ ...prev, leverage: !prev.leverage }))}
        yLabelForRow={(row) => (row?.display === 'percent' ? 'Ratio (%)' : '£ (bn)')}
      />

      <StatementSection
        title="NSFR"
        subtitle="Available vs required stable funding"
        rows={nsfrRows}
        columns={[
          { id: 'leg', label: 'Leg', render: (row) => row.meta?.leg ?? '—' },
          { id: 'base', label: 'Base', align: 'right', render: (row) => (row.meta?.base !== undefined ? formatCurrency(Number(row.meta.base)) : '—') },
          { id: 'factor', label: 'Factor', align: 'right', render: (row) => formatFactor(Number(row.meta?.factor)) },
        ]}
        valueHeader="Required / available"
        valueFormatter={(row) => (row.display === 'percent' ? formatPct(row.value) : formatCurrency(row.value))}
        selectedId={selected.nsfr}
        onSelect={(id) => setSelected((prev) => ({ ...prev, nsfr: id }))}
        isOpen={open.nsfr}
        onToggle={() => setOpen((prev) => ({ ...prev, nsfr: !prev.nsfr }))}
        yLabelForRow={(row) => (row?.display === 'percent' ? 'Ratio (%)' : '£ (bn)')}
      />

      <StatementSection
        title="LCR"
        subtitle="Liquidity coverage components"
        rows={lcrRows}
        columns={[
          { id: 'leg', label: 'Leg', render: (row) => row.meta?.leg ?? '—' },
          { id: 'base', label: 'Base', align: 'right', render: (row) => (row.meta?.base !== undefined ? formatCurrency(Number(row.meta.base)) : '—') },
          { id: 'factor', label: 'Factor', align: 'right', render: (row) => formatFactor(Number(row.meta?.factor)) },
        ]}
        valueHeader="Amount"
        valueFormatter={(row) => (row.display === 'percent' ? formatPct(row.value) : formatCurrency(row.value))}
        selectedId={selected.lcr}
        onSelect={(id) => setSelected((prev) => ({ ...prev, lcr: id }))}
        isOpen={open.lcr}
        onToggle={() => setOpen((prev) => ({ ...prev, lcr: !prev.lcr }))}
        yLabelForRow={(row) => (row?.display === 'percent' ? 'Ratio (%)' : '£ (bn)')}
      />

      <StatementSection
        title="Capital stack"
        subtitle="CET1, AT1, and ratios"
        rows={capitalRows}
        columns={[{ id: 'type', label: 'Type', render: (row) => row.meta?.type ?? '—' }]}
        valueHeader="Value"
        valueFormatter={(row) => (row.display === 'percent' ? formatPct(row.value) : formatCurrency(row.value))}
        selectedId={selected.capital}
        onSelect={(id) => setSelected((prev) => ({ ...prev, capital: id }))}
        isOpen={open.capital}
        onToggle={() => setOpen((prev) => ({ ...prev, capital: !prev.capital }))}
        yLabelForRow={(row) => (row?.display === 'percent' ? 'Ratio (%)' : '£ (bn)')}
      />
    </div>
  );
};

export default RegMetricsPanel;
