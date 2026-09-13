import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { FundingConfidenceState, RiskMetrics } from '../domain/risks';
import { classifyFundingConfidenceState } from './metrics';
import { createSimulationEvent, SimulationEvent } from './simulationEvents';

const CONFIDENCE_STATE_ORDER: FundingConfidenceState[] = ['strong', 'stable', 'watch', 'stressed'];

export const confidenceStateRank = (state: FundingConfidenceState): number => {
  const idx = CONFIDENCE_STATE_ORDER.indexOf(state);
  return idx >= 0 ? idx : 1;
};

export const getFundingConfidenceState = (state: BankState): FundingConfidenceState =>
  state.behaviour.fundingConfidenceState ?? 'stable';

export interface ConfidenceStateImpactSet {
  state: FundingConfidenceState;
  spreadPenaltyBps: number;
  accessMultiplier: number;
  equityIssuanceMultiplier: number;
  equityIssuanceFeeRate: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const getConfidenceStateImpact = (
  state: BankState,
  config: SimulationConfig
): ConfidenceStateImpactSet => {
  const confidenceState = getFundingConfidenceState(state);
  const impactMap = config.behaviour.confidenceStateMachine?.impacts;
  const perState = impactMap?.[confidenceState] ?? impactMap?.stable;
  return {
    state: confidenceState,
    spreadPenaltyBps: perState?.spreadPenaltyBps ?? 0,
    accessMultiplier: clamp(perState?.accessMultiplier ?? 1, 0.1, 1),
    equityIssuanceMultiplier: clamp(perState?.equityIssuanceMultiplier ?? 1, 0, 1),
    equityIssuanceFeeRate: clamp(perState?.equityIssuanceFeeRate ?? 0, 0, 0.5),
  };
};

export const stepFundingConfidenceState = (
  state: BankState,
  config: SimulationConfig,
  metrics: RiskMetrics,
  events: SimulationEvent[]
): void => {
  if (!config.behaviour.confidenceStateMachine) return;

  const current = getFundingConfidenceState(state);
  const target = classifyFundingConfidenceState({
    fundingConfidenceScore: metrics.fundingConfidenceScore,
    lcr: metrics.lcr,
    nsfr: metrics.nsfr,
    cet1Headroom: metrics.cet1Headroom,
    config,
  });
  const currentRank = confidenceStateRank(current);
  const targetRank = confidenceStateRank(target);
  const requiredUpgradeMonths = Math.max(
    1,
    Math.round(config.behaviour.confidenceStateMachine?.upgradeSustainMonths ?? 3)
  );
  const progress = Math.max(0, Math.round(state.behaviour.confidenceUpgradeProgressMonths ?? 0));

  let nextState = current;
  let nextProgress = progress;

  if (targetRank > currentRank) {
    nextState = CONFIDENCE_STATE_ORDER[Math.min(currentRank + 1, targetRank)];
    nextProgress = 0;
  } else if (targetRank < currentRank) {
    nextProgress = progress + 1;
    if (nextProgress >= requiredUpgradeMonths) {
      nextState = CONFIDENCE_STATE_ORDER[Math.max(currentRank - 1, targetRank)];
      nextProgress = 0;
    }
  } else {
    nextProgress = 0;
  }

  state.behaviour.fundingConfidenceState = nextState;
  state.behaviour.confidenceUpgradeProgressMonths = nextProgress;
  const notchMap: Record<FundingConfidenceState, number> = {
    strong: -1,
    stable: 0,
    watch: 1,
    stressed: 2,
  };
  state.behaviour.ratingNotchOffset = notchMap[nextState];

  if (nextState !== current) {
    const severity = confidenceStateRank(nextState) > confidenceStateRank(current) ? 'warning' : 'info';
    events.push(
      createSimulationEvent(
        severity,
        `Market confidence state moved ${current} -> ${nextState} (score ${(metrics.fundingConfidenceScore * 100).toFixed(
          0
        )}%, LCR ${(metrics.lcr * 100).toFixed(0)}%, NSFR ${(metrics.nsfr * 100).toFixed(0)}%)`,
        ['funding', 'capital']
      )
    );
  }
};
