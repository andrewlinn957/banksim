import type { Shock } from '../domain/shocks';
import type { Scenario } from '../config/scenarios';

export interface ScenarioBeat {
  stepNumber: number;
  scheduled: string[];
  conditional: string[];
}

export interface ScenarioBriefingView {
  openingPressure: string;
  firstDecision: string;
  timeline: ScenarioBeat[];
}

const shockLabels: Record<Shock['type'], string> = {
  depositCompetition: 'Deposit repricing',
  marketSpreadShock: 'Spread shock',
  idiosyncraticRun: 'Deposit outflows',
  macroDownturn: 'Credit downturn',
  counterpartyDefault: 'Counterparty loss',
  rolloverStress: 'Refinancing pressure',
};

const titleFromId = (id: string): string =>
  id.split('-').map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');

export const buildScenarioBriefing = (scenario: Scenario | null): ScenarioBriefingView | null => {
  if (!scenario) return null;

  const beats = new Map<number, ScenarioBeat>();
  const getBeat = (stepNumber: number): ScenarioBeat => {
    const existing = beats.get(stepNumber);
    if (existing) return existing;
    const beat = { stepNumber, scheduled: [], conditional: [] };
    beats.set(stepNumber, beat);
    return beat;
  };

  scenario.scheduledShocks.forEach(({ stepNumber, shock }) => {
    const labels = getBeat(stepNumber).scheduled;
    const label = shockLabels[shock.type];
    if (!labels.includes(label)) labels.push(label);
  });

  scenario.arcStages?.forEach((stage) => {
    const response = stage.shocks.map((shock) => shockLabels[shock.type]);
    const label = `${titleFromId(stage.id)} · ${Array.from(new Set(response)).join(' + ')}`;
    const conditional = getBeat(stage.stepNumber).conditional;
    if (!conditional.includes(label)) conditional.push(label);
  });

  return {
    openingPressure: scenario.briefing?.openingPressure ?? scenario.description,
    firstDecision: scenario.briefing?.firstDecision ?? 'Protect headroom before pursuing growth.',
    timeline: Array.from(beats.values()).sort((a, b) => a.stepNumber - b.stepNumber),
  };
};
