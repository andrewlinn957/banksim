import { CashFlowStatement } from '../domain/cashflow';
import { formatCurrency } from '../utils/formatters';

interface Props {
  cashFlow: CashFlowStatement;
}

const CashFlowPanel = ({ cashFlow }: Props) => {
  return (
    <div className="card stack">
      <h3>Cash Flow Statement (Monthly)</h3>
      <table className="data-table">
        <tbody>
          <Row label="Cash at start" value={formatCurrency(cashFlow.cashStart)} />
          <Row label="Operating cash flow" value={formatCurrency(cashFlow.operatingCashFlow)} />
          <Row label="Investing cash flow" value={formatCurrency(cashFlow.investingCashFlow)} />
          <Row label="Financing cash flow" value={formatCurrency(cashFlow.financingCashFlow)} />
          <Row label="Net change in cash" value={formatCurrency(cashFlow.netChange)} bold />
          <Row label="Cash at end" value={formatCurrency(cashFlow.cashEnd)} bold />
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

export default CashFlowPanel;
