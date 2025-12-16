import { BalanceSheetItem } from '../domain/balanceSheet';

interface Props {
  items: BalanceSheetItem[];
}

const formatCurrency = (v: number) => `£${(v / 1e9).toFixed(2)}bn`;
const formatRate = (v: number) => `${(v * 100).toFixed(2)}%`;

const BalanceSheetTable = ({ items }: Props) => {
  const assets = items.filter((i) => i.side === 'Asset');
  const liabilities = items.filter((i) => i.side === 'Liability');

  return (
    <div className="grid-two">
      <div className="card">
        <h3>Assets</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="numeric">Balance</th>
              <th className="numeric">Rate</th>
              <th className="numeric">Encumbered</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.productType}>
                <td>{a.label}</td>
                <td className="numeric">{formatCurrency(a.balance)}</td>
                <td className="numeric">{formatRate(a.interestRate)}</td>
                <td className="numeric">{formatCurrency(a.encumbrance.encumberedAmount ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Liabilities & Capital</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="numeric">Balance</th>
              <th className="numeric">Rate</th>
            </tr>
          </thead>
          <tbody>
            {liabilities.map((l) => (
              <tr key={l.productType}>
                <td>{l.label}</td>
                <td className="numeric">{formatCurrency(l.balance)}</td>
                <td className="numeric">{formatRate(l.interestRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BalanceSheetTable;
