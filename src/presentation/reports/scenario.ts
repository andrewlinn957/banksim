import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import type { Scenario } from '../../config/scenarios';
import type { StepAttribution } from '../../domain/attribution';
import type { ScenarioMetricKey, ScenarioScore } from '../../domain/scoring';
import { evaluateScenarioGoals } from '../../engine/scoring';
import { buildScenarioBriefing } from '../../game/scenarioBriefing';
import { buildScenarioDebrief } from '../../game/scenarioDebrief';
import { formatCurrency, formatPct } from '../../utils/formatters';

export const formatScenarioMetric = (value: number, metric: ScenarioMetricKey): string => {
  if (metric === 'cet1Ratio' || metric === 'leverageRatio' || metric === 'lcr' || metric === 'nsfr' || metric === 'roe' || metric === 'nim') {
    return formatPct(value);
  }
  return formatCurrency(value);
};

export interface ScenarioProgressReport {
  scenario: { id: string; name: string; description: string };
  briefing: ReturnType<typeof buildScenarioBriefing>;
  month: number;
  score: ScenarioScore | null;
  objectiveRows: Array<{ label: string; current: string; target: string; progress: string }>;
  debrief: ReturnType<typeof buildScenarioDebrief>;
}

/** Player-visible scenario briefing, progress, score and completed-run debrief. */
export const buildScenarioProgressReport = (args: {
  scenario: Scenario | null;
  state: BankState;
  openingStep: number;
  config: SimulationConfig;
  attribution: StepAttribution | null;
  recommendationTitles: readonly string[];
}): ScenarioProgressReport | null => {
  const { scenario, state, openingStep, config, attribution, recommendationTitles } = args;
  if (!scenario) return null;

  const score = scenario.goals
    ? evaluateScenarioGoals(state, scenario.goals, { horizonRiskPenaltyWeight: config.behaviour.horizonRiskPenaltyWeight })
    : null;
  const objectiveRows = score?.details.map((detail) => ({
    label: detail.label,
    current: formatScenarioMetric(detail.current, detail.metric),
    target: formatScenarioMetric(detail.target, detail.metric),
    progress: `${(detail.completion * 100).toFixed(0)}%`,
  })) ?? [];

  return {
    scenario: { id: scenario.id, name: scenario.name, description: scenario.description },
    briefing: buildScenarioBriefing(scenario),
    month: Math.max(0, state.time.step - openingStep),
    score,
    objectiveRows,
    debrief: buildScenarioDebrief({
      scenario,
      state,
      score,
      attribution,
      recommendations: [...recommendationTitles],
    }),
  };
};
