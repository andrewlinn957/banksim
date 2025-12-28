import { useEffect, useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { BalanceSheetSide, ProductType } from '../domain/enums';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { formatCurrency, formatRate, formatChange } from '../utils/formatters';
import { SeriesPoint, StatementRow } from '../types/statements';
import TimeSeriesChart from './TimeSeriesChart';

type StatementKey = 'assets' | 'liabilities' | 'income' | 'cashflow';

interface Props {
  state: BankState;
  history: BankState[];
}

const buildStepChange = (series: SeriesPoint[]): number | null => {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const prior = [...series].reverse().find((p) => p.step < latest.step);
  if (!prior || !Number.isFinite(prior.value) || prior.value === 0) return null;
  return ((latest.value - prior.value) / Math.abs(prior.value)) * 100;
};

const balanceForProduct = (state: BankState, product: ProductType): number =>
  state.financial.balanceSheet.items.find((i) => i.productType === product)?.balance ?? 0;

const seriesFromHistory = (history: BankState[], selector: (state: BankState) => number): SeriesPoint[] =>
  history.map((s) => ({ step: s.time.step, value: selector(s) }));

const sumSide = (state: BankState, side: BalanceSheetSide): number =>
  state.financial.balanceSheet.items.filter((i) => i.side === side).reduce((sum, item) => sum + item.balance, 0);

const buildBalanceRow = (item: BalanceSheetItem, history: BankState[]): StatementRow => {
  const series = seriesFromHistory(history, (s) => balanceForProduct(s, item.productType));
  return {
    id: item.productType,
    label: item.label,
    value: item.balance,
    changePct: buildStepChange(series),
    series,
    rate: item.interestRate,
  };
};

const buildAssetRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const assets = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);
  const rows = assets.map((item) => buildBalanceRow(item, history));
  const totalSeries = seriesFromHistory(history, (s) => sumSide(s, BalanceSheetSide.Asset));
  rows.push({
    id: 'total-assets',
    label: 'Total assets',
    value: sumSide(state, BalanceSheetSide.Asset),
    changePct: buildStepChange(totalSeries),
    series: totalSeries,
  });
  return rows;
};

const buildLiabilityRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const liabilities = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Liability);
  const rows = liabilities.map((item) => buildBalanceRow(item, history));

  const cet1Series = seriesFromHistory(history, (s) => s.financial.capital.cet1);
  const at1Series = seriesFromHistory(history, (s) => s.financial.capital.at1);
  const equitySeries = seriesFromHistory(history, (s) => s.financial.capital.cet1 + s.financial.capital.at1);
  const liabilitiesSeries = seriesFromHistory(history, (s) => sumSide(s, BalanceSheetSide.Liability));
  const balanceSheetSeries = seriesFromHistory(
    history,
    (s) => sumSide(s, BalanceSheetSide.Liability) + s.financial.capital.cet1 + s.financial.capital.at1
  );

  rows.push(
    {
      id: 'capital-cet1',
      label: 'CET1 capital',
      value: state.financial.capital.cet1,
      changePct: buildStepChange(cet1Series),
      series: cet1Series,
    },
    {
      id: 'capital-at1',
      label: 'AT1 capital',
      value: state.financial.capital.at1,
      changePct: buildStepChange(at1Series),
      series: at1Series,
    },
    {
      id: 'capital-total',
      label: 'Total equity',
      value: state.financial.capital.cet1 + state.financial.capital.at1,
      changePct: buildStepChange(equitySeries),
      series: equitySeries,
    },
    {
      id: 'total-liabilities',
      label: 'Total liabilities',
      value: sumSide(state, BalanceSheetSide.Liability),
      changePct: buildStepChange(liabilitiesSeries),
      series: liabilitiesSeries,
    },
    {
      id: 'liabilities-equity',
      label: 'Liabilities + equity',
      value:
        sumSide(state, BalanceSheetSide.Liability) +
        state.financial.capital.cet1 +
        state.financial.capital.at1,
      changePct: buildStepChange(balanceSheetSeries),
      series: balanceSheetSeries,
    }
  );

  return rows;
};

const buildIncomeRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const fields: Array<{ id: string; label: string; selector: (s: BankState) => number }> = [
    { id: 'interestIncome', label: 'Interest income', selector: (s) => s.financial.incomeStatement.interestIncome },
    { id: 'interestExpense', label: 'Interest expense', selector: (s) => s.financial.incomeStatement.interestExpense },
    { id: 'netInterestIncome', label: 'Net interest income', selector: (s) => s.financial.incomeStatement.netInterestIncome },
    { id: 'feeIncome', label: 'Fee income', selector: (s) => s.financial.incomeStatement.feeIncome },
    { id: 'creditLosses', label: 'Credit losses', selector: (s) => s.financial.incomeStatement.creditLosses },
    { id: 'operatingExpenses', label: 'Operating expenses', selector: (s) => s.financial.incomeStatement.operatingExpenses },
    { id: 'preTaxProfit', label: 'Pre-tax profit', selector: (s) => s.financial.incomeStatement.preTaxProfit },
    { id: 'tax', label: 'Tax', selector: (s) => s.financial.incomeStatement.tax },
    { id: 'netIncome', label: 'Net income', selector: (s) => s.financial.incomeStatement.netIncome },
  ];

  return fields.map((field) => {
    const series = seriesFromHistory(history, field.selector);
    return {
      id: field.id,
      label: field.label,
      value: field.selector(state),
      changePct: buildStepChange(series),
      series,
    };
  });
};

const buildCashRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const fields: Array<{ id: string; label: string; selector: (s: BankState) => number }> = [
    { id: 'cashStart', label: 'Cash at start', selector: (s) => s.financial.cashFlowStatement.cashStart },
    { id: 'operatingCashFlow', label: 'Operating cash flow', selector: (s) => s.financial.cashFlowStatement.operatingCashFlow },
    { id: 'investingCashFlow', label: 'Investing cash flow', selector: (s) => s.financial.cashFlowStatement.investingCashFlow },
    { id: 'financingCashFlow', label: 'Financing cash flow', selector: (s) => s.financial.cashFlowStatement.financingCashFlow },
    { id: 'netChange', label: 'Net change in cash', selector: (s) => s.financial.cashFlowStatement.netChange },
    { id: 'cashEnd', label: 'Cash at end', selector: (s) => s.financial.cashFlowStatement.cashEnd },
  ];

  return fields.map((field) => {
    const series = seriesFromHistory(history, field.selector);
    return {
      id: field.id,
      label: field.label,
      value: field.selector(state),
      changePct: buildStepChange(series),
      series,
    };
  });
};

const StatementSection = ({
  title,
  subtitle,
  rows,
  selectedId,
  onSelect,
  isOpen,
  onToggle,
  yLabelForRow,
}: {
  title: string;
  subtitle: string;
  rows: StatementRow[];
  selectedId?: string;
  onSelect: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  yLabelForRow?: (row: StatementRow | undefined) => string;
}) => {
  const hasRateColumn = rows.some((r) => r.rate !== undefined);
  const activeRow = rows.find((r) => r.id === selectedId) ?? rows[0];
  const changeClass = (value: number | null) =>
    value === null ? 'muted' : value > 0 ? 'positive' : value < 0 ? 'negative' : 'muted';
  const yLabel = yLabelForRow ? yLabelForRow(activeRow) : 'Amount';

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
                  <th className="numeric">Amount</th>
                  <th className="numeric">MoM</th>
                  {hasRateColumn && <th className="numeric">Rate</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={row.id === activeRow?.id ? 'active' : ''}
                    onClick={() => onSelect(row.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{row.label}</td>
                    <td className="numeric">{formatCurrency(row.value)}</td>
                    <td className={`numeric ${changeClass(row.changePct)}`}>{formatChange(row.changePct)}</td>
                    {hasRateColumn && <td className="numeric muted">{formatRate(row.rate)}</td>}
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
                    <span className="pill">Now {formatCurrency(activeRow.value)}</span>
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

const AccountsPanel = ({ state, history }: Props) => {
  const assetRows = useMemo(() => buildAssetRows(state, history), [state, history]);
  const liabilityRows = useMemo(() => buildLiabilityRows(state, history), [state, history]);
  const incomeRows = useMemo(() => buildIncomeRows(state, history), [state, history]);
  const cashRows = useMemo(() => buildCashRows(state, history), [state, history]);

  const [selected, setSelected] = useState<Partial<Record<StatementKey, string>>>({});
  const [open, setOpen] = useState<Record<StatementKey, boolean>>({
    assets: true,
    liabilities: true,
    income: true,
    cashflow: true,
  });

  useEffect(() => {
    ensureSelection(assetRows, selected.assets, (id) => setSelected((prev) => ({ ...prev, assets: id })));
  }, [assetRows, selected.assets]);

  useEffect(() => {
    ensureSelection(liabilityRows, selected.liabilities, (id) =>
      setSelected((prev) => ({ ...prev, liabilities: id }))
    );
  }, [liabilityRows, selected.liabilities]);

  useEffect(() => {
    ensureSelection(incomeRows, selected.income, (id) => setSelected((prev) => ({ ...prev, income: id })));
  }, [incomeRows, selected.income]);

  useEffect(() => {
    ensureSelection(cashRows, selected.cashflow, (id) => setSelected((prev) => ({ ...prev, cashflow: id })));
  }, [cashRows, selected.cashflow]);

  return (
    <div className="stack">
      <StatementSection
        title="Assets"
        subtitle="Balance sheet — assets"
        rows={assetRows}
        selectedId={selected.assets}
        onSelect={(id) => setSelected((prev) => ({ ...prev, assets: id }))}
        isOpen={open.assets}
        onToggle={() => setOpen((prev) => ({ ...prev, assets: !prev.assets }))}
        yLabelForRow={() => '£ (bn)'}
      />
      <StatementSection
        title="Liabilities & equity"
        subtitle="Balance sheet — funding"
        rows={liabilityRows}
        selectedId={selected.liabilities}
        onSelect={(id) => setSelected((prev) => ({ ...prev, liabilities: id }))}
        isOpen={open.liabilities}
        onToggle={() => setOpen((prev) => ({ ...prev, liabilities: !prev.liabilities }))}
        yLabelForRow={() => '£ (bn)'}
      />
      <StatementSection
        title="Income statement"
        subtitle="P&L (monthly run rate)"
        rows={incomeRows}
        selectedId={selected.income}
        onSelect={(id) => setSelected((prev) => ({ ...prev, income: id }))}
        isOpen={open.income}
        onToggle={() => setOpen((prev) => ({ ...prev, income: !prev.income }))}
        yLabelForRow={() => '£ (bn)'}
      />
      <StatementSection
        title="Cash flow statement"
        subtitle="Cash movement (monthly)"
        rows={cashRows}
        selectedId={selected.cashflow}
        onSelect={(id) => setSelected((prev) => ({ ...prev, cashflow: id }))}
        isOpen={open.cashflow}
        onToggle={() => setOpen((prev) => ({ ...prev, cashflow: !prev.cashflow }))}
        yLabelForRow={() => '£ (bn)'}
      />
    </div>
  );
};

export default AccountsPanel;

