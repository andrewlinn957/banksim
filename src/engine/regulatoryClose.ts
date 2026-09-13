import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { calculateRiskMetrics, evaluateCompliance } from './metrics';
import { stepFundingConfidenceState } from './fundingConfidence';
import { createSimulationEvent, SimulationEvent } from './simulationEvents';

/**
 * Recomputes prudential metrics and compliance at the regulatory-close boundary.
 * Funding confidence can transition before a final recomputation because the transition itself
 * affects market-access assumptions embedded in the metrics.
 */
export const computeMetrics = (
  state: BankState,
  config: SimulationConfig,
  lcrOutflowMultiplier: number,
  events: SimulationEvent[],
  advanceConfidenceState = true,
  emitRegulatoryEvents = true
): void => {
  let metrics = calculateRiskMetrics({ state, config, lcrOutflowMultiplier });
  if (config.behaviour.confidenceStateMachine && advanceConfidenceState) {
    stepFundingConfidenceState(state, config, metrics, events);
    metrics = calculateRiskMetrics({ state, config, lcrOutflowMultiplier });
  }

  state.risk.riskMetrics = metrics;
  state.risk.compliance = evaluateCompliance(metrics, config.riskLimits);
  state.behaviour.fundingConfidenceScore = metrics.fundingConfidenceScore;
  state.behaviour.fundingConfidenceState = metrics.fundingConfidenceState;

  state.status.hasFailed =
    state.status.hasFailed ||
    state.risk.compliance.cet1Breached ||
    Boolean(state.risk.compliance.ownFundsBreached) ||
    state.risk.compliance.leverageBreached;

  if (!emitRegulatoryEvents) return;

  if (state.risk.compliance.mdaTriggered) {
    events.push(createSimulationEvent('warning', 'CET1 has entered the combined buffer stack (MDA restrictions active)'));
  }
  if (metrics.praBufferBreached) {
    events.push(
      createSimulationEvent(
        'warning',
        'PRA buffer in use: prepare a capital recovery plan. This supervisory target is separate from automatic combined-buffer distribution restrictions.',
        ['capital']
      )
    );
  }
  if (metrics.payoutBlockedByInternalTarget) {
    events.push(
      createSimulationEvent(
        'warning',
        `Internal capital target active: payout cap ${(metrics.maxPayoutRatio * 100).toFixed(0)}%`,
        ['capital']
      )
    );
  }
  if (state.risk.compliance.concentrationBreached) {
    events.push(
      createSimulationEvent(
        'warning',
        `Concentration limit breached (sector ${(metrics.sectorConcentration * 100).toFixed(1)}%, geography ${(metrics.geographyConcentration * 100).toFixed(1)}%)`
      )
    );
  }
  if (state.risk.compliance.lcrBreached || state.risk.compliance.nsfrBreached) {
    events.push(
      createSimulationEvent(
        'warning',
        'Liquidity recovery required: restore the buffer and protect funding access. A ratio breach alone does not end the game.'
      )
    );
  }
  if (state.status.hasFailed) {
    events.push(
      createSimulationEvent(
        'error',
        'Mandate ended: a capital minimum or cash obligation was breached. This is a game rule, not a legal resolution determination.'
      )
    );
  }
};
