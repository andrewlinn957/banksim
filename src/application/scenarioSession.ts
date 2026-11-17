import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { ActionFormState } from './playerControls';
import { baseConfig } from '../config/baseConfig';
import { applyScenarioConfig, findScenarioDefinition, getScenarioInitialState, scenarios, type Scenario } from '../config/scenarios';
import { calculateRiskMetrics, evaluateCompliance } from '../engine/metrics';
import { createActionFormState } from './actionFormState';
import { SEED_SCHEME_VERSION, validateSimulationSeed } from '../engine/seedScheme';

export interface PreparedScenarioSession {
  config: SimulationConfig;
  state: BankState;
  actionForm: ActionFormState;
  seed: number;
  seedSchemeVersion: string;
  scenarioDefinition: Scenario | null;
}

export interface ScenarioSessionOptions {
  seed?: number;
  startDate?: Date | string;
}

export const prepareScenarioSession = (
  scenarioId: string | null,
  options: ScenarioSessionOptions = {},
  definitions: readonly Scenario[] = scenarios,
): PreparedScenarioSession => {
  const scenarioDefinition = findScenarioDefinition(scenarioId, definitions);
  const config = applyScenarioConfig(baseConfig, scenarioId, definitions);
  const seed = validateSimulationSeed(options.seed ?? config.global.initialPortfolioSeed ?? 123456789);
  const state = getScenarioInitialState(scenarioId, config, { seed, startDate: options.startDate }, definitions);
  const metrics = calculateRiskMetrics({ state, config });
  state.risk.riskMetrics = metrics;
  state.risk.compliance = evaluateCompliance(metrics, config.riskLimits);
  return {
    config,
    state,
    actionForm: createActionFormState(state, config),
    seed,
    seedSchemeVersion: SEED_SCHEME_VERSION,
    scenarioDefinition: scenarioDefinition ? structuredClone(scenarioDefinition) : null,
  };
};
