import { useEffect, useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { formatCurrency, formatRate, formatChange } from '../utils/formatters';
import { StatementRow } from '../types/statements';
import TimeSeriesChart from './TimeSeriesChart';
import { buildAssetRows, buildLiabilityRows, buildIncomeRows, buildCashRows } from '../presentation/reports/accounts';


type StatementKey = 'assets' | 'liabilities' | 'income' | 'cashflow';

interface Props {
  state: BankState;
  history: BankState[];
}



















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

