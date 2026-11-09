import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { ActionFormState } from './playerControls';
import { baseConfig } from '../config/baseConfig';
import { applyScenarioConfig, getScenarioInitialState } from '../config/scenarios';
import { calculateRiskMetrics, evaluateCompliance } from '../engine/metrics';
import { createActionFormState } from './actionFormState';
import { SEED_SCHEME_VERSION, validateSimulationSeed } from '../engine/seedScheme';

export interface PreparedScenarioSession {
  config: SimulationConfig;
  state: BankState;
  actionForm: ActionFormState;
  seed: number;
  seedSchemeVersion: string;
}

export interface ScenarioSessionOptions {
  seed?: number;
  startDate?: Date | string;
}

export const prepareScenarioSession = (
  scenarioId: string | null,
  options: ScenarioSessionOptions = {},
): PreparedScenarioSession => {
  const config = applyScenarioConfig(baseConfig, scenarioId);
  const seed = validateSimulationSeed(options.seed ?? config.global.initialPortfolioSeed ?? 123456789);
  const state = getScenarioInitialState(scenarioId, config, { seed, startDate: options.startDate });
  const metrics = calculateRiskMetrics({ state, config });
  state.risk.riskMetrics = metrics;
  state.risk.compliance = evaluateCompliance(metrics, config.riskLimits);
  return {
    config,
    state,
    actionForm: createActionFormState(state, config),
    seed,
    seedSchemeVersion: SEED_SCHEME_VERSION,
  };
};
