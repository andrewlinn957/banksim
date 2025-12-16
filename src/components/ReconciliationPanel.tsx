import { useMemo } from 'react';
import { BankState } from '../domain/bankState';
import { runSimulationTestSuite, SimulationTestResult, simulationTestCases } from '../engine/simulationTestSuite';

interface ReconciliationResult {
  name: string;
  passed: boolean;
  detail: string;
}

const formatCurrency = (v: number) => `£${(v / 1e9).toFixed(2)}bn`;

const ReconciliationPanel = ({ state }: { state: BankState }) => {
  const reconciliationResults = useMemo<ReconciliationResult[]>(() => {
    const results: ReconciliationResult[] = [];

    const totalAssets = state.balanceSheet.items
      .filter((i) => i.side === 'Asset')
      .reduce((sum, i) => sum + i.balance, 0);
    const totalLiabs = state.balanceSheet.items
      .filter((i) => i.side === 'Liability')
      .reduce((sum, i) => sum + i.balance, 0);
    const totalCapital = state.capital.cet1 + state.capital.at1;
    const balanceGap = totalAssets - (totalLiabs + totalCapital);
    results.push({
      name: 'Balance sheet balances',
      passed: Math.abs(balanceGap) < 1,
      detail: `Assets ${formatCurrency(totalAssets)} vs Liabilities+Equity ${formatCurrency(
        totalLiabs + totalCapital
      )} (gap ${balanceGap.toFixed(2)})`,
    });

    const cf = state.cashFlowStatement;
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

  const simulationResults = useMemo<SimulationTestResult[]>(() => runSimulationTestSuite(), []);
  const simulationSuiteMetadata = useMemo<SimulationTestResult[]>(() => {
    const ids = new Set<string>();
    const dupes = new Set<string>();
    simulationTestCases.forEach((testCase) => {
      if (ids.has(testCase.id)) dupes.add(testCase.id);
      ids.add(testCase.id);
    });
    return [
      {
        id: 'simulation-test-ids-unique',
        group: 'Simulation test suite metadata',
        name: 'simulation test ids are unique',
        passed: dupes.size === 0,
        detail: dupes.size === 0 ? 'No duplicate ids' : `Duplicate ids: ${[...dupes].join(', ')}`,
      },
    ];
  }, []);

  const allSimulationTestResults = useMemo<SimulationTestResult[]>(() => {
    return [...simulationSuiteMetadata, ...simulationResults];
  }, [simulationSuiteMetadata, simulationResults]);

  const passingTests = allSimulationTestResults.filter((r) => r.passed).length;

  const simulationResultsByGroup = useMemo(() => {
    const grouped = new Map<string, SimulationTestResult[]>();
    allSimulationTestResults.forEach((r) => {
      const existing = grouped.get(r.group);
      if (existing) {
        existing.push(r);
        return;
      }
      grouped.set(r.group, [r]);
    });
    return grouped;
  }, [allSimulationTestResults]);

  return (
    <div className="card stack">
      <h3>Reconciliations</h3>
      <div className="stack">
        <Section title="Current state checks" rows={reconciliationResults} />
        <div style={{ fontWeight: 700 }}>{`Simulation tests (${passingTests}/${allSimulationTestResults.length} passing)`}</div>
        {[...simulationResultsByGroup.entries()].map(([group, rows]) => {
          const passing = rows.filter((r) => r.passed).length;
          return <Section key={group} title={`${group} (${passing}/${rows.length} passing)`} rows={rows} />;
        })}
      </div>
    </div>
  );
};

const Section = ({ title, rows }: { title: string; rows: ReconciliationResult[] | SimulationTestResult[] }) => (
  <div className="stack">
    <div style={{ fontWeight: 700 }}>{title}</div>
    <div className="stack">
      {rows.map((r) => {
        const key = 'id' in r ? (r as SimulationTestResult).id : r.name;
        const displayName = 'id' in r ? `${(r as SimulationTestResult).id}: ${r.name}` : r.name;
        return (
          <div key={key} className="recon-item">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontWeight: 600 }}>{displayName}</div>
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
