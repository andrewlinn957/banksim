import { BankState } from '../domain/bankState';
import { buildReconciliationReportData, type ReconciliationResult } from '../presentation/reports/reconciliations';

const ReconciliationPanel = ({ state }: { state: BankState }) => {
  const reconciliationResults = buildReconciliationReportData(state);

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
