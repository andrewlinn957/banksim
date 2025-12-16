import { IncomeStatement } from '../domain/pnl';

interface Props {
  income: IncomeStatement;
}

const formatCurrency = (v: number) => `£${(v / 1e9).toFixed(2)}bn`;

const CostsPanel = ({ income }: Props) => {
  return (
    <div className="card stack">
      <h3>Costs & P&L (Monthly)</h3>
      <table className="data-table">
        <tbody>
          <Row label="Interest Income" value={formatCurrency(income.interestIncome)} />
          <Row label="Interest Expense" value={formatCurrency(income.interestExpense)} />
          <Row label="Net Interest Income" value={formatCurrency(income.netInterestIncome)} bold />
          <Row label="Fees" value={formatCurrency(income.feeIncome)} />
          <Row label="Credit Losses" value={formatCurrency(income.creditLosses)} />
          <Row label="Operating Expenses" value={formatCurrency(income.operatingExpenses)} />
          <Row label="Tax" value={formatCurrency(income.tax)} />
          <Row label="Net Income" value={formatCurrency(income.netIncome)} bold />
        </tbody>
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
