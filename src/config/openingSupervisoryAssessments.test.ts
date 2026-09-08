import { describe, expect, it } from 'vitest';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { cloneBankState } from '../engine/clone';
import { assessPillar2A } from '../engine/pillar2A';
import { baseConfig } from './baseConfig';
import { calibrationPacks } from './calibration';
import { applyScenarioConfig, getScenarioInitialState, scenarios } from './scenarios';

const componentKeys = [
  'creditRisk',
  'singleNameConcentration',
  'sectorConcentration',
  'geographicConcentration',
  'irrbb',
] as const;

const expectFreshOpeningPillar2A = (
  state: BankState,
  config: SimulationConfig,
  label: string
): void => {
  const actual = state.risk.pillar2A;
  expect(actual, `${label}: missing opening Pillar 2A assessment`).toBeDefined();

  const expected = assessPillar2A({
    state: cloneBankState(state),
    config,
    rwa: state.risk.riskMetrics.rwa,
    eveSensitivity100bp: state.risk.riskMetrics.eveSensitivity100bp,
    assessmentStep: state.time.step,
  });

  expect(actual!.assessmentStep, `${label}: assessment step`).toBe(state.time.step);
  expect(actual!.assessmentRwa, `${label}: assessment RWA`).toBeCloseTo(state.risk.riskMetrics.rwa, 6);
  expect(actual!.assessmentRwa, `${label}: fresh assessment RWA`).toBeCloseTo(expected.assessmentRwa, 6);
  expect(actual!.grossRate, `${label}: gross rate`).toBeCloseTo(expected.grossRate, 12);
  expect(actual!.assessedRate, `${label}: assessed rate`).toBeCloseTo(expected.assessedRate, 12);

  componentKeys.forEach((key) => {
    expect(actual!.components[key], `${label}: ${key}`).toBeCloseTo(expected.components[key], 6);
  });
};

describe('opening supervisory assessments', () => {
  it('assesses every scenario against its own opening balance sheet', () => {
    scenarios.forEach((scenario) => {
      const config = applyScenarioConfig(baseConfig, scenario.id);
      const state = getScenarioInitialState(scenario.id, config);
      expectFreshOpeningPillar2A(state, config, `scenario ${scenario.id}`);
    });
  });

  it('assesses every calibration pack against its own opening balance sheet', () => {
    calibrationPacks.forEach((pack) => {
      expectFreshOpeningPillar2A(pack.initialState, pack.config, `calibration ${pack.id}`);
    });
  });
});
