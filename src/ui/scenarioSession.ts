import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { ActionFormState } from '../components/ActionsPanel';
import { baseConfig } from '../config/baseConfig';
import { applyScenarioConfig, getScenarioInitialState } from '../config/scenarios';
import { calculateRiskMetrics, evaluateCompliance } from '../engine/metrics';
import { createActionFormState } from './actionFormState';

export interface PreparedScenarioSession {
  config: SimulationConfig;
  state: BankState;
  actionForm: ActionFormState;
}

export const prepareScenarioSession = (scenarioId: string | null): PreparedScenarioSession => {
  const config = applyScenarioConfig(baseConfig, scenarioId);
  const state = getScenarioInitialState(scenarioId, config);
  const metrics = calculateRiskMetrics({ state, config });
  state.risk.riskMetrics = metrics;
  state.risk.compliance = evaluateCompliance(metrics, config.riskLimits);
  return {
    config,
    state,
    actionForm: createActionFormState(state, config),
  };
};
