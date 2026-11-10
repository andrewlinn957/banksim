import type { BankState } from '../domain/bankState';
import { buildThreeYearPlanPresentation } from '../presentation/reports/threeYearPlan';

interface Props { state: BankState; }

export default function ThreeYearPlanPanel({ state }: Props) {
  const display = buildThreeYearPlanPresentation(state);
  if (!display) return null;

  const renderRows = (rows: Array<{ id: string; label: string; actual: string; target: string; score: string; weight: string }>, targetColumn: string) => <table className="data-table">
    <thead><tr><th>Measure</th><th className="numeric">Actual</th><th className="numeric">{targetColumn}</th><th className="numeric">Score</th><th className="numeric">Weight</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}><td>{row.label}</td><td className="numeric">{row.actual}</td><td className="numeric">{row.target}</td><td className="numeric">{row.score}</td><td className="numeric">{row.weight}</td></tr>)}</tbody>
  </table>;

  return <section className="card stack three-year-plan" aria-label="Three-Year Plan">
    <div className="section-heading">
      <div><div className="eyebrow">Three-Year Plan</div><h2>{display.title}</h2></div>
      <div><strong>{display.boardConfidence}</strong><div className="muted">{display.boardConfidenceLabel}</div></div>
    </div>

    <div className="grid-two">
      <div><strong>{display.resultHeading}</strong><div className="muted">{display.resultDetail}</div></div>
      <div><strong>{display.milestoneHeading}</strong><div className="muted">{display.milestoneDetail}</div></div>
    </div>

    <div>
      <strong>{display.reviewHeading}</strong>
      <div className="muted">{display.reviewDetail}</div>
      {display.reviewDrivers && <div className="muted" style={{ marginTop: 6 }}>{display.reviewDrivers}</div>}
    </div>

    {display.progress && <>
      <div><strong>{display.progress.heading}</strong><div className="muted">{display.progress.detail}</div></div>
      {renderRows(display.progress.rows, display.progress.targetColumn)}
    </>}

    {display.finalResult && renderRows(display.finalResult.rows, display.finalResult.targetColumn)}

    <details open={display.expandedByDefault}><summary>{display.targetTable.summary}</summary>
      <table className="data-table">
        <thead><tr><th>Measure</th>{display.targetTable.columns.map((column) => <th className="numeric" key={column}>{column}</th>)}</tr></thead>
        <tbody>{display.targetTable.rows.map((row) => <tr key={row.id}><td>{row.label}</td>{row.milestones.map((target, index) => <td className="numeric" key={display.targetTable.columns[index]}>{target}</td>)}</tr>)}</tbody>
      </table>
    </details>
  </section>;
}
