import { IncomeStatement } from '../domain/pnl';
import { formatCurrency } from '../utils/formatters';
import { buildCostsReportData } from '../presentation/reports/costs';

interface Props {
  income: IncomeStatement;
}

const CostsPanel = ({ income }: Props) => {
  const rows = buildCostsReportData(income);
  return (
    <div className="card stack">
      <h3>Costs & P&L (Monthly)</h3>
      <table className="data-table">
        <tbody>{rows.map((row) => <Row key={row.label} label={row.label} value={formatCurrency(row.value)} bold={row.bold} />)}</tbody>
      </table>
    </div>
  );
};

const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <tr>
    <td>{label}</td>
    <td className="numeric" style={{ fontWeight: bold ? 700 : 500 }}>
      {value}
    </td>
  </tr>
);

export default CostsPanel;
