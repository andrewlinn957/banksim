import { useEffect, useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide, ProductType } from '../domain/enums';
import { PRODUCT_META } from '../domain/productMeta';
import { formatCurrency, formatPct, formatChange, formatSignedPct } from '../utils/formatters';
import { SeriesPoint, StatementRow } from '../types/statements';
import TimeSeriesChart from './TimeSeriesChart';
import { AttributionLineSelection, AttributionMetricKey, StepAttribution } from '../domain/attribution';
import HelpLink from './HelpLink';
import InfoTooltip from './InfoTooltip';

type MetricKey = 'rwa' | 'leverage' | 'nsfr' | 'lcr' | 'capital';
const ATTRIBUTION_METRIC_ORDER: AttributionMetricKey[] = ['cet1Ratio', 'lcr', 'nsfr', 'nim'];

interface Props {
  state: BankState;
  history: BankState[];
  config: SimulationConfig;
  attribution?: StepAttribution | null;
  onAttributionLineSelect?: (selection: AttributionLineSelection) => void;
  onNavigateHelp?: (sectionId: string) => void;
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
  value === undefined || !Number.isFinite(value) ? '--' : `${(value * 100).toFixed(0)}%`;

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
  Boolean(PRODUCT_META[productType]?.behaviour?.isCustomerDeposit);

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
  const depositQualitySeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.depositQualityIndex);

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
    },
    {
      id: 'lcr-deposit-quality',
      label: 'Deposit quality index',
      value: state.risk.riskMetrics.depositQualityIndex,
      changePct: buildMonthChange(depositQualitySeries),
      series: depositQualitySeries,
      display: 'percent',
      meta: { leg: 'Behavioural quality' },
    }
  );

  return rows;
};

const computeCapitalRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const cet1Series = seriesFromHistory(history, (s) => s.financial.capital.cet1);
  const at1Series = seriesFromHistory(history, (s) => s.financial.capital.at1);
  const ociSeries = seriesFromHistory(history, (s) => s.financial.capital.accumulatedOCI);
  const tier1Series = seriesFromHistory(
    history,
    (s) => s.financial.capital.cet1 + s.financial.capital.at1 + s.financial.capital.accumulatedOCI
  );
  const rwaSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.rwa);
  const cet1RatioSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.cet1Ratio);
  const requirementSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.cet1Requirement);
  const internalTargetSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.internalCet1TargetRatio);
  const headroomSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.cet1Headroom);
  const internalHeadroomSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.internalCet1Headroom);
  const payoutCapSeries = seriesFromHistory(history, (s) => s.risk.riskMetrics.maxPayoutRatio);
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
      id: 'cap-oci',
      label: 'Accumulated OCI',
      value: state.financial.capital.accumulatedOCI,
      changePct: buildMonthChange(ociSeries),
      series: ociSeries,
      meta: { type: 'Capital' },
    },
    {
      id: 'cap-tier1',
      label: 'Total equity (incl OCI)',
      value:
        state.financial.capital.cet1 +
        state.financial.capital.at1 +
        state.financial.capital.accumulatedOCI,
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
      id: 'cap-cet1-requirement',
      label: 'CET1 requirement (buffer stack)',
      value: state.risk.riskMetrics.cet1Requirement,
      changePct: buildMonthChange(requirementSeries),
      series: requirementSeries,
      display: 'percent',
      meta: { type: 'Buffer' },
    },
    {
      id: 'cap-cet1-headroom',
      label: 'CET1 headroom',
      value: state.risk.riskMetrics.cet1Headroom,
      changePct: buildMonthChange(headroomSeries),
      series: headroomSeries,
      display: 'percent',
      meta: { type: 'Buffer' },
    },
    {
      id: 'cap-internal-target',
      label: 'Internal CET1 target',
      value: state.risk.riskMetrics.internalCet1TargetRatio,
      changePct: buildMonthChange(internalTargetSeries),
      series: internalTargetSeries,
      display: 'percent',
      meta: { type: 'Buffer' },
    },
    {
      id: 'cap-internal-headroom',
      label: 'Internal CET1 headroom',
      value: state.risk.riskMetrics.internalCet1Headroom,
      changePct: buildMonthChange(internalHeadroomSeries),
      series: internalHeadroomSeries,
      display: 'percent',
      meta: { type: 'Buffer' },
    },
    {
      id: 'cap-payout-cap',
      label: 'Max payout ratio',
      value: state.risk.riskMetrics.maxPayoutRatio,
      changePct: buildMonthChange(payoutCapSeries),
      series: payoutCapSeries,
      display: 'percent',
      meta: {
        type: state.risk.riskMetrics.payoutBlockedByInternalTarget
          ? 'Internal target active'
          : state.risk.riskMetrics.mdaTriggered
            ? 'MDA active'
            : 'MDA inactive',
      },
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
  helpTooltip,
  helpSectionId,
  onNavigateHelp,
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
  helpTooltip?: string;
  helpSectionId?: string;
  onNavigateHelp?: (sectionId: string) => void;
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
          {helpTooltip ? <InfoTooltip label={`About ${title}`} content={<span>{helpTooltip}</span>} /> : null}
          {helpSectionId && onNavigateHelp ? (
            <HelpLink label="Open help" sectionId={helpSectionId} onNavigate={onNavigateHelp} />
          ) : null}
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

const RegMetricsPanel = ({
  state,
  history,
  config,
  attribution,
  onAttributionLineSelect,
  onNavigateHelp,
}: Props) => {
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
  const [selectedAttributionMetric, setSelectedAttributionMetric] =
    useState<AttributionMetricKey>('cet1Ratio');

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

  useEffect(() => {
    if (!attribution) return;
    if (attribution.metrics[selectedAttributionMetric]) return;
    const fallback = ATTRIBUTION_METRIC_ORDER.find((key) => attribution.metrics[key]);
    if (fallback) setSelectedAttributionMetric(fallback);
  }, [attribution, selectedAttributionMetric]);

  const activeAttribution = attribution ? attribution.metrics[selectedAttributionMetric] : undefined;
  const maxAttributionEffect = activeAttribution
    ? Math.max(...activeAttribution.lines.map((line) => Math.abs(line.effect)), 1e-9)
    : 1e-9;
  const activeTopPositive = activeAttribution?.lines.find(
    (line) => line.id === activeAttribution.topPositiveDriverId
  );
  const activeTopNegative = activeAttribution?.lines.find(
    (line) => line.id === activeAttribution.topNegativeDriverId
  );

  return (
    <div className="stack">
      {activeAttribution && (
        <div className="card stack attribution-card">
          <div className="statement-header">
            <div>
              <div className="eyebrow">Step attribution diagnostics</div>
              <h3>Metric waterfall and event linkage</h3>
            </div>
            <div className="chart-pills">
              <span className={`pill ${activeAttribution.delta > 0 ? 'positive' : activeAttribution.delta < 0 ? 'negative' : ''}`}>
                Delta {formatSignedPct(activeAttribution.delta)}
              </span>
              <span className={`pill ${activeAttribution.residual > 0 ? 'positive' : activeAttribution.residual < 0 ? 'negative' : ''}`}>
                Residual {formatSignedPct(activeAttribution.residual)}
              </span>
            </div>
          </div>
          <div className="metric-help-actions">
            <InfoTooltip
              label="About attribution waterfall"
              content={
                <span>
                  Decomposes the last-step metric movement into modeled drivers and links each driver to event-log
                  entries.
                </span>
              }
            />
            {onNavigateHelp ? (
              <HelpLink
                label="Open help"
                sectionId="attribution-events-reconciliation"
                onNavigate={onNavigateHelp}
              />
            ) : null}
          </div>

          <div className="attribution-metric-tabs">
            {ATTRIBUTION_METRIC_ORDER.map((metricKey) => {
              const metric = attribution?.metrics[metricKey];
              if (!metric) return null;
              return (
                <button
                  key={metricKey}
                  type="button"
                  className={`button small ${metricKey === selectedAttributionMetric ? 'primary' : 'ghost'}`}
                  onClick={() => setSelectedAttributionMetric(metricKey)}
                >
                  {metric.label}
                </button>
              );
            })}
          </div>

          <table className="data-table attribution-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th className="numeric">Impact</th>
                <th>Magnitude</th>
                <th className="numeric">Events</th>
                <th className="numeric">Link</th>
              </tr>
            </thead>
            <tbody>
              {activeAttribution.lines.map((line) => {
                const width = `${Math.max(2, (Math.abs(line.effect) / maxAttributionEffect) * 100)}%`;
                const signClass = line.effect > 0 ? 'positive' : line.effect < 0 ? 'negative' : '';
                return (
                  <tr key={line.id}>
                    <td>{line.label}</td>
                    <td className={`numeric ${signClass}`}>{formatSignedPct(line.effect)}</td>
                    <td>
                      <div className="waterfall-track">
                        <div className={`waterfall-bar ${signClass || 'neutral'}`} style={{ width }} />
                      </div>
                    </td>
                    <td className="numeric">{line.eventIds.length}</td>
                    <td className="numeric">
                      <button
                        type="button"
                        className="button ghost small"
                        disabled={line.eventIds.length === 0}
                        onClick={() =>
                          onAttributionLineSelect?.({
                            metric: selectedAttributionMetric,
                            metricLabel: activeAttribution.label,
                            lineId: line.id,
                            lineLabel: line.label,
                            effect: line.effect,
                            eventIds: line.eventIds,
                          })
                        }
                      >
                        Show
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="muted">
            Reconciled change: {formatSignedPct(activeAttribution.reconciledDelta)}.
            {activeTopPositive ? ` Top positive: ${activeTopPositive.label}.` : ''}
            {activeTopNegative ? ` Top negative: ${activeTopNegative.label}.` : ''}
          </div>
        </div>
      )}

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
        helpTooltip="RWA is the sum of exposure multiplied by risk weights across assets. Higher RWA lowers CET1 ratio for fixed capital."
        helpSectionId="risk-metrics-and-compliance"
        onNavigateHelp={onNavigateHelp}
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
        helpTooltip={`Leverage ratio = Tier 1 / total exposure. Hard minimum is ${formatPct(config.riskLimits.minLeverageRatio)}.`}
        helpSectionId="risk-metrics-and-compliance"
        onNavigateHelp={onNavigateHelp}
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
        helpTooltip={`NSFR = ASF / RSF over one year. Hard minimum is ${formatPct(config.riskLimits.minNsfr)}.`}
        helpSectionId="liquidity-ratios"
        onNavigateHelp={onNavigateHelp}
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
        helpTooltip={`LCR = HQLA / net 30-day outflows, with inflows capped at 75% of outflows. Hard minimum is ${formatPct(config.riskLimits.minLcr)}.`}
        helpSectionId="liquidity-ratios"
        onNavigateHelp={onNavigateHelp}
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
        helpTooltip={`Distributions are constrained by capital requirements, internal target, and payout cap. Current CET1 requirement is ${formatPct(state.risk.riskMetrics.cet1Requirement)}.`}
        helpSectionId="capital-policy-and-distributions"
        onNavigateHelp={onNavigateHelp}
        yLabelForRow={(row) => (row?.display === 'percent' ? 'Ratio (%)' : '£ (bn)')}
      />
    </div>
  );
};

export default RegMetricsPanel;


