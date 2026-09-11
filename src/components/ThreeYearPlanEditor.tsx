import type { BankState } from '../domain/bankState';
import type { ThreeYearPlanTarget } from '../domain/threeYearPlan';
import { bankThreeYearPlanMetricRegistry } from '../engine/threeYearPlanMetrics';

interface Props {
  state: BankState;
  onChange: (targets: readonly ThreeYearPlanTarget[]) => void;
}

type MetricFormat = 'money' | 'moneyPerShare' | 'ratio';

const scaleFor = (format: MetricFormat): number =>
  format === 'money' ? 1e9 : format === 'moneyPerShare' ? 0.01 : 0.01;

const unitFor = (format: MetricFormat): string =>
  format === 'money' ? '£bn' : format === 'moneyPerShare' ? 'p' : '%';

const displayValue = (value: number, format: MetricFormat): string => {
  const scaled = value / scaleFor(format);
  return format === 'money' ? scaled.toFixed(2) : scaled.toFixed(1);
};

const parseDisplayValue = (raw: string, format: MetricFormat): number | undefined => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed * scaleFor(format);
};

export default function ThreeYearPlanEditor({ state, onChange }: Props) {
  const plan = state.threeYearPlan;
  if (!plan?.enabled) return null;
  const totalWeight = plan.targets.reduce((sum, target) => sum + Math.max(0, target.weight), 0);

  const updateWeight = (metricId: string, raw: string) => {
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight < 0) return;
    const targets = plan.targets.map(target => target.metricId === metricId ? { ...target, weight } : target);
    if (targets.reduce((sum, target) => sum + Math.max(0, target.weight), 0) <= 0) return;
    onChange(targets);
  };

  const updateMilestone = (metricId: string, month: 12 | 24 | 36, raw: string) => {
    const definition = bankThreeYearPlanMetricRegistry.get(metricId);
    const lower = parseDisplayValue(raw, definition.format);
    if (lower === undefined) return;
    onChange(plan.targets.map(target => target.metricId === metricId
      ? {
          ...target,
          milestones: target.milestones.map(milestone => milestone.month === month
            ? { ...milestone, lower }
            : milestone),
        }
      : target));
  };

  return <details className="policy-disclosure" open>
    <summary>Set opening board plan</summary>
    <p className="muted">Optional plan mode is still a management choice. These targets are locked after the first month. Board Confidence will be judged only against the plan you set here.</p>
    <table className="data-table">
      <thead><tr><th>Measure</th><th className="numeric">Weight</th><th className="numeric">FY1</th><th className="numeric">FY2</th><th className="numeric">FY3</th></tr></thead>
      <tbody>{plan.targets.map(target => {
        const definition = bankThreeYearPlanMetricRegistry.get(target.metricId);
        return <tr key={target.metricId}>
          <td>{definition.label}<div className="muted">{unitFor(definition.format)}</div></td>
          <td className="numeric"><input aria-label={`${definition.label} weight`} inputMode="decimal" type="number" min="0" step="0.5" value={target.weight} onChange={event => updateWeight(target.metricId, event.target.value)} /></td>
          {target.milestones.map(milestone => <td className="numeric" key={milestone.month}><input aria-label={`${definition.label} FY${milestone.month / 12} target`} inputMode="decimal" type="number" step="any" value={displayValue(milestone.lower, definition.format)} onChange={event => updateMilestone(target.metricId, milestone.month, event.target.value)} /></td>)}
        </tr>;
      })}</tbody>
    </table>
    <div className={Math.abs(totalWeight - 100) < 1e-6 ? 'muted' : 'alert warning'}>Weight total {totalWeight.toFixed(1)}%. Scores are normalised by total weight, but 100% is easiest to interpret.</div>
  </details>;
}
