import type { ThreeYearPlanTarget } from '../domain/threeYearPlan';
import { bankThreeYearPlanMetricRegistry } from '../engine/threeYearPlanMetrics';

interface Props {
  targets: readonly ThreeYearPlanTarget[];
  onChange: (targets: readonly ThreeYearPlanTarget[]) => void;
  title?: string;
  detail?: string;
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

export default function ThreeYearPlanEditor({
  targets,
  onChange,
  title = 'Set opening board plan',
  detail = 'These targets are locked after the next month starts. Board Confidence will be judged only against the plan you set here.',
}: Props) {
  const totalWeight = targets.reduce((sum, target) => sum + Math.max(0, target.weight), 0);

  const updateWeight = (metricId: string, raw: string) => {
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight < 0) return;
    const nextTargets = targets.map(target => target.metricId === metricId ? { ...target, weight } : target);
    if (nextTargets.reduce((sum, target) => sum + Math.max(0, target.weight), 0) <= 0) return;
    onChange(nextTargets);
  };

  const updateMilestone = (metricId: string, month: 12 | 24 | 36, raw: string) => {
    const definition = bankThreeYearPlanMetricRegistry.get(metricId);
    const lower = parseDisplayValue(raw, definition.format);
    if (lower === undefined) return;
    onChange(targets.map(target => target.metricId === metricId
      ? {
          ...target,
          milestones: target.milestones.map(milestone => milestone.month === month
            ? { ...milestone, lower }
            : milestone),
        }
      : target));
  };

  return <details className="policy-disclosure" open>
    <summary>{title}</summary>
    <p className="muted">{detail}</p>
    <table className="data-table">
      <thead><tr><th>Measure</th><th className="numeric">Weight</th><th className="numeric">FY1</th><th className="numeric">FY2</th><th className="numeric">FY3</th></tr></thead>
      <tbody>{targets.map(target => {
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
