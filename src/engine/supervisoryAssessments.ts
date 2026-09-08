import { BankState } from '../domain/bankState';

/**
 * Scenario and calibration builders clone the fully assessed base bank before
 * applying opening-state overrides. Frozen supervisory assessments from that
 * base bank are no longer valid once the opening portfolio or configuration is
 * changed, so clear them immediately before opening risk metrics are rebuilt.
 */
export const resetOpeningSupervisoryAssessments = (state: BankState): void => {
  state.risk.pillar2A = undefined;
  state.risk.osii = undefined;
};
