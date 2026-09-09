import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { RiskMetrics } from '../domain/risks';
import { calculateRiskMetrics } from './metrics';
import {
  advancePillar2AAssessmentAtClose,
  initializeOpeningPillar2AAssessment,
} from './pillar2A';
import {
  advanceOsiiAssessmentAtClose,
  initializeOpeningOsiiAssessment,
} from './capitalBuffers';
import {
  advanceLeverageFrameworkAssessmentAtClose,
  initializeOpeningLeverageFrameworkAssessment,
} from './leverageFramework';

/**
 * Scenario and calibration builders clone the fully assessed base bank before
 * applying opening-state overrides. Frozen supervisory assessments from that
 * base bank are no longer valid once the opening portfolio or configuration is
 * changed, so clear them before rebuilding opening assessments.
 */
export const resetOpeningSupervisoryAssessments = (state: BankState): void => {
  state.risk.pillar2A = undefined;
  state.risk.osii = undefined;
  state.risk.leverageFramework = undefined;
};

/** Establish supervisory state after all opening-state overrides have been applied. */
export const initializeOpeningSupervisoryAssessments = (
  state: BankState,
  config: SimulationConfig
): void => {
  initializeOpeningOsiiAssessment(state, config);
  initializeOpeningLeverageFrameworkAssessment(state);
  const preview = calculateRiskMetrics({ state, config });
  initializeOpeningPillar2AAssessment({
    state,
    config,
    rwa: preview.rwa,
    eveSensitivity100bp: preview.eveSensitivity100bp,
  });
};

/** The only normal simulation path that advances supervisory assessment history. */
export const advanceSupervisoryAssessmentsAtClose = (
  state: BankState,
  config: SimulationConfig,
  closingMetrics?: RiskMetrics
): void => {
  const metrics = closingMetrics ?? calculateRiskMetrics({ state, config });
  advancePillar2AAssessmentAtClose({
    state,
    config,
    rwa: metrics.rwa,
    eveSensitivity100bp: metrics.eveSensitivity100bp,
  });
  advanceOsiiAssessmentAtClose(state, config);
  advanceLeverageFrameworkAssessmentAtClose(state);
};
