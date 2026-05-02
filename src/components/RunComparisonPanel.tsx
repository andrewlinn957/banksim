import { useEffect, useMemo, useState } from 'react';
import { RunRecord } from '../domain/runHistory';
import { formatCurrency, formatPct } from '../utils/formatters';

interface Props {
  runs: RunRecord[];
  currentSummary: {
    timelineLength: number;
    snapshots: number;
  };
  onReplay: (run: RunRecord) => void;
}

const RunComparisonPanel = ({ runs, currentSummary, onReplay }: Props) => {
  const [leftId, setLeftId] = useState<string>('');
  const [rightId, setRightId] = useState<string>('');

  useEffect(() => {
    if (!leftId && runs[0]) setLeftId(runs[0].id);
    if (!rightId && runs[1]) setRightId(runs[1].id);
  }, [leftId, rightId, runs]);

  const left = useMemo(() => runs.find((run) => run.id === leftId), [leftId, runs]);
  const right = useMemo(() => runs.find((run) => run.id === rightId), [rightId, runs]);

  return (
    <div className="stack">
      <div className="card stack">
        <div className="eyebrow">Current run</div>
        <div className="muted">
          Decisions recorded: <strong>{currentSummary.timelineLength}</strong> | Snapshots:{' '}
          <strong>{currentSummary.snapshots}</strong>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="card stack">
          <div className="muted">No saved runs yet. Use "Save run" in the header after stepping the model.</div>
        </div>
      ) : (
        <div className="card stack">
          <div className="eyebrow">Saved runs</div>
          <div className="form-row">
            <label className="field">
              <span>Run A</span>
              <select value={leftId} onChange={(e) => setLeftId(e.target.value)}>
                <option value="">Select run...</option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Run B</span>
              <select value={rightId} onChange={(e) => setRightId(e.target.value)}>
                <option value="">Select run...</option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            {left && (
              <button className="button small" type="button" onClick={() => onReplay(left)}>
                Replay {left.label}
              </button>
            )}
            {right && (
              <button className="button small" type="button" onClick={() => onReplay(right)}>
                Replay {right.label}
              </button>
            )}
          </div>

          {(left || right) && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="numeric">{left?.label ?? 'Run A'}</th>
                  <th className="numeric">{right?.label ?? 'Run B'}</th>
                </tr>
              </thead>
              <tbody>
                <CompareRow
                  label="CET1 ratio"
                  left={left ? formatPct(left.finalState.risk.riskMetrics.cet1Ratio) : '-'}
                  right={right ? formatPct(right.finalState.risk.riskMetrics.cet1Ratio) : '-'}
                />
                <CompareRow
                  label="LCR"
                  left={left ? formatPct(left.finalState.risk.riskMetrics.lcr) : '-'}
                  right={right ? formatPct(right.finalState.risk.riskMetrics.lcr) : '-'}
                />
                <CompareRow
                  label="NSFR"
                  left={left ? formatPct(left.finalState.risk.riskMetrics.nsfr) : '-'}
                  right={right ? formatPct(right.finalState.risk.riskMetrics.nsfr) : '-'}
                />
                <CompareRow
                  label="Net income"
                  left={left ? formatCurrency(left.finalState.financial.incomeStatement.netIncome) : '-'}
                  right={right ? formatCurrency(right.finalState.financial.incomeStatement.netIncome) : '-'}
                />
                <CompareRow
                  label="Share price"
                  left={left ? `GBP ${left.finalState.equityMarket.sharePrice.toFixed(2)}` : '-'}
                  right={right ? `GBP ${right.finalState.equityMarket.sharePrice.toFixed(2)}` : '-'}
                />
                <CompareRow
                  label="Decisions"
                  left={left ? String(left.timeline.length) : '-'}
                  right={right ? String(right.timeline.length) : '-'}
                />
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

const CompareRow = ({ label, left, right }: { label: string; left: string; right: string }) => (
  <tr>
    <td>{label}</td>
    <td className="numeric">{left}</td>
    <td className="numeric">{right}</td>
  </tr>
);

export default RunComparisonPanel;
