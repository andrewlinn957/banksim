import { describe, expect, it } from 'vitest';
import { baseConfig } from '../../config/baseConfig';
import { initialState } from '../../config/initialState';
import { scenarios } from '../../config/scenarios';
import { cloneBankState } from '../../engine/clone';
import { buildScenarioProgressReport } from './scenario';

describe('scenario progress presentation', () => {
  it('returns the same briefing, objective values and debrief data used by the GUI without private setup', () => {
    const scenario = scenarios.find((item) => item.goals);
    if (!scenario?.goals) throw new Error('Expected a scored scenario fixture');
    const state = cloneBankState(initialState);
    state.time.step = scenario.goals.horizonMonths;

    const report = buildScenarioProgressReport({
      scenario,
      state,
      openingStep: 0,
      config: baseConfig,
      attribution: null,
      recommendationTitles: ['Protect liquidity'],
    });

    expect(report).not.toBeNull();
    expect(report?.month).toBe(scenario.goals.horizonMonths);
    expect(report?.briefing?.timeline.length).toBeGreaterThan(0);
    expect(report?.objectiveRows).toHaveLength(scenario.goals.objectives.length);
    expect(report?.objectiveRows[0]).toMatchObject({ label: scenario.goals.objectives[0].label });
    expect(report?.debrief?.recommendedLevers).toEqual(['Protect liquidity']);
    expect(report?.scenario).toEqual({ id: scenario.id, name: scenario.name, description: scenario.description });
    expect(report?.scenario).not.toHaveProperty('configOverrides');
    expect(report?.scenario).not.toHaveProperty('scheduledShocks');
  });
});
