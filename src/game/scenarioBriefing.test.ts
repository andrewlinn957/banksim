import { describe, expect, it } from 'vitest';
import { scenarios } from '../config/scenarios';
import { buildScenarioBriefing } from './scenarioBriefing';

describe('scenario briefings', () => {
  it('turns scheduled and conditional shocks into a chronological pressure timeline', () => {
    const wholesale = scenarios.find((scenario) => scenario.id === 'wholesale-funding-reliance')!;
    const briefing = buildScenarioBriefing(wholesale)!;

    expect(briefing.openingPressure).toContain('£2.4bn');
    expect(briefing.timeline.map((beat) => beat.stepNumber)).toEqual([0, 2]);
    expect(briefing.timeline[0].scheduled).toEqual(['Spread shock', 'Deposit outflows']);
    expect(briefing.timeline[1].conditional).toEqual([
      'Funding Cliff · Refinancing pressure + Deposit outflows',
      'Funding Stabilises · Refinancing pressure',
    ]);
  });

  it('keeps scenario-authored priorities beside the correct scheduled events', () => {
    const creditBoom = scenarios.find((scenario) => scenario.id === 'corporate-credit-boom')!;
    const briefing = buildScenarioBriefing(creditBoom)!;

    expect(briefing.firstDecision).toContain('underwriting');
    expect(briefing.timeline[0]).toMatchObject({
      stepNumber: 3,
      scheduled: ['Credit downturn'],
    });
    expect(briefing.timeline[1].stepNumber).toBe(6);
    expect(briefing.timeline[1].conditional).toHaveLength(2);
  });

  it('handles a missing briefing without hiding the scenario description', () => {
    const fallbackScenario = { ...scenarios[0], briefing: undefined };
    const briefing = buildScenarioBriefing(fallbackScenario)!;

    expect(briefing.openingPressure).toBe(fallbackScenario.description);
    expect(briefing.firstDecision).toBeTruthy();
  });
});
