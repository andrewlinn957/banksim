import type { BankState } from '../domain/bankState';
import type { Scenario } from '../config/scenarios';
import type { ScenarioScore } from '../domain/scoring';
import type { StepAttribution } from '../domain/attribution';

export interface ScenarioDebriefView {
  severity: 'danger' | 'warning' | 'info';
  title: string;
  summary: string;
  topDrivers: string[];
  recommendedLevers: string[];
}

/** Shared wording for the existing GUI scenario debrief and player report. */
export const buildScenarioDebrief = (args: {
  scenario: Scenario | null;
  state: BankState;
  score: ScenarioScore | null;
  attribution: StepAttribution | null;
  recommendations: readonly string[];
}): ScenarioDebriefView | null => {
  const { scenario, state, score, attribution, recommendations } = args;
  if (!scenario) return null;

  const failed = state.status.hasFailed;
  const reachedHorizon = score ? state.time.step >= score.horizonMonths : false;
  if (!failed && !reachedHorizon) return null;

  const topDrivers = attribution
    ? (['cet1Ratio', 'lcr', 'nsfr'] as const)
        .map((metricKey) => {
          const metric = attribution.metrics[metricKey];
          const driverId = metric.topNegativeDriverId;
          if (!driverId) return null;
          const line = metric.lines.find((item) => item.id === driverId);
          if (!line) return null;
          return `${metric.label}: ${line.label}`;
        })
        .filter((item): item is string => Boolean(item))
        .slice(0, 3)
    : [];

  const recommendedLevers = recommendations.slice(0, 3);
  if (failed) {
    return {
      severity: 'danger',
      title: 'Scenario debrief: hard constraint breached',
      summary: 'A regulatory hard limit was breached. Stabilize funding/capital buffers first before re-accelerating growth levers.',
      topDrivers,
      recommendedLevers,
    };
  }

  return {
    severity: score?.passed ? 'info' : 'warning',
    title: score?.passed
      ? 'Scenario debrief: horizon completed'
      : 'Scenario debrief: horizon reached but objectives at risk',
    summary: score
      ? `Completion ${(score.completionPct * 100).toFixed(1)}%, forward-risk penalty ${(score.qualityPenalty * 100).toFixed(1)}%.`
      : 'Horizon reached; review resilience and objective outcomes before next run.',
    topDrivers,
    recommendedLevers,
  };
};
