import { useMemo } from 'react';
import { BankState } from '../domain/bankState';
import { formatCurrency } from '../utils/formatters';

interface ReconciliationResult {
  name: string;
  passed: boolean;
  detail: string;
}

const ReconciliationPanel = ({ state }: { state: BankState }) => {
  const reconciliationResults = useMemo<ReconciliationResult[]>(() => {
    const results: ReconciliationResult[] = [];

    const totalAssets = state.financial.balanceSheet.items
      .filter((i) => i.side === 'Asset')
      .reduce((sum, i) => sum + i.balance, 0);
    const totalLiabs = state.financial.balanceSheet.items
      .filter((i) => i.side === 'Liability')
      .reduce((sum, i) => sum + i.balance, 0);
    const totalCapital =
      state.financial.capital.cet1 +
      state.financial.capital.at1 +
      state.financial.capital.accumulatedOCI;
    const balanceGap = totalAssets - (totalLiabs + totalCapital);
    results.push({
      name: 'Balance sheet balances',
      passed: Math.abs(balanceGap) < 1,
      detail: `Assets ${formatCurrency(totalAssets)} vs Liabilities+Equity ${formatCurrency(
        totalLiabs + totalCapital
      )} (gap ${balanceGap.toFixed(2)})`,
    });

    const cf = state.financial.cashFlowStatement;
    const cfRollPassed = Math.abs(cf.cashStart + cf.netChange - cf.cashEnd) < 1;
    results.push({
      name: 'Cash rollforward',
      passed: cfRollPassed,
      detail: `Start ${formatCurrency(cf.cashStart)} + net change ${formatCurrency(
        cf.netChange
      )} = end ${formatCurrency(cf.cashEnd)}`,
    });

    const cfComponentsSum = cf.operatingCashFlow + cf.investingCashFlow + cf.financingCashFlow;
    const cfComponentsPassed = Math.abs(cfComponentsSum - cf.netChange) < 1;
    results.push({
      name: 'Cash flow components sum',
      passed: cfComponentsPassed,
      detail: `Op ${formatCurrency(cf.operatingCashFlow)} + Inv ${formatCurrency(
        cf.investingCashFlow
      )} + Fin ${formatCurrency(cf.financingCashFlow)} = ${formatCurrency(cfComponentsSum)} vs net change ${formatCurrency(
        cf.netChange
      )}`,
    });

    return results;
  }, [state]);

  return (
    <div className="card stack">
      <h3>Reconciliations</h3>
      <div className="stack">
        <Section title="Current state checks" rows={reconciliationResults} />
      </div>
    </div>
  );
};

const Section = ({ title, rows }: { title: string; rows: ReconciliationResult[] }) => (
  <div className="stack">
    <div style={{ fontWeight: 700 }}>{title}</div>
    <div className="stack">
      {rows.map((r) => {
        return (
          <div key={r.name} className="recon-item">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontWeight: 600 }}>{r.name}</div>
              <span className={`status-badge ${r.passed ? 'pass' : 'fail'}`}>{r.passed ? 'PASS' : 'FAIL'}</span>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>{r.detail}</div>
          </div>
        );
      })}
    </div>
  </div>
);

export default ReconciliationPanel;
