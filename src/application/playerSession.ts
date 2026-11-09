import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import type { PlayerAction } from '../domain/actions';
import type { Shock } from '../domain/shocks';
import type { ActionTimelineEntry, RunSnapshot } from '../domain/runHistory';
import type { StepAttribution } from '../domain/attribution';
import type { SimulationEvent } from '../engine/simulation';
import type { StepExecutionResult } from '../domain/execution';
import { cloneBankState } from '../engine/clone';
import { getScenarioStepPayload } from '../config/scenarios';
import { attentionReason } from '../game/management';
import { clearOneOffTransactions } from './actionFormState';
import { applySafetyPauseToggle } from './playerTime';
import {
  buildActionsFromParsed,
  parseActionFormInputs,
  riskAppetiteFloorsFor,
  validateRiskAppetiteTargets,
  type ActionFormState,
  type PlayerControlIssue,
  type PlayerRiskAppetite,
} from './playerControls';
import type { SimulationController } from './simulationController';
import type { PreparedScenarioSession } from './scenarioSession';
import { SEED_SCHEME_VERSION } from '../engine/seedScheme';

export type PlayerRunStatus = 'active' | 'bank_failure' | 'horizon_reached' | 'owner_stopped' | 'server_error' | 'interrupted';

/** Complete player session state, excluding operational request/provider audit metadata. */
export interface PlayerSessionState {
  runId: string;
  revision: number;
  seed: number;
  seedSchemeVersion: string;
  scenarioId: string | null;
  config: SimulationConfig;
  openingState: BankState;
  bankState: BankState;
  stateHistory: BankState[];
  eventLog: SimulationEvent[];
  lastAttribution: StepAttribution | null;
  actionForm: ActionFormState;
  capitalMarketsDraftArea?: 'Capital' | 'Treasury' | null;
  pendingRiskAppetite?: NonNullable<BankState['behaviour']['riskAppetite']> | null;
  timeline: ActionTimelineEntry[];
  snapshots: RunSnapshot[];
  safetyPause: boolean;
  safetyPauseDisableArmed?: boolean;
  horizonMonths?: number;
  status: PlayerRunStatus;
  stopReason?: string;
}

export interface PlayerSessionIssue {
  field: string;
  message: string;
}

export type ClosePlayerMonthResult =
  | { accepted: false; session: PlayerSessionState; issues: PlayerSessionIssue[]; reason: 'invalid' | 'terminal' }
  | {
      accepted: true;
      session: PlayerSessionState;
      actions: PlayerAction[];
      shocks: Shock[];
      events: SimulationEvent[];
      executions: StepExecutionResult;
      attribution: StepAttribution;
      pausedForAttention: boolean;
    };

export const createPlayerSessionState = (args: {
  runId: string;
  scenarioId: string | null;
  prepared: PreparedScenarioSession;
  controller: SimulationController;
  safetyPause?: boolean;
  horizonMonths?: number;
}): PlayerSessionState => {
  const openingState = cloneBankState(args.prepared.state);
  return {
    runId: args.runId,
    revision: 0,
    seed: args.prepared.seed,
    seedSchemeVersion: args.prepared.seedSchemeVersion ?? SEED_SCHEME_VERSION,
    scenarioId: args.scenarioId,
    config: args.prepared.config,
    openingState,
    bankState: cloneBankState(openingState),
    stateHistory: [cloneBankState(openingState)],
    eventLog: [],
    lastAttribution: null,
    actionForm: { ...args.prepared.actionForm },
    capitalMarketsDraftArea: null,
    timeline: [],
    snapshots: [args.controller.createSnapshot(openingState)],
    safetyPause: args.safetyPause ?? true,
    safetyPauseDisableArmed: false,
    horizonMonths: args.horizonMonths,
    status: 'active',
  };
};

export interface PlayerSafetyPauseUpdate {
  session: PlayerSessionState;
  stopAutomaticRun: boolean;
  message: string;
}

export type PlayerRiskAppetiteUpdate =
  | { accepted: true; session: PlayerSessionState }
  | { accepted: false; session: PlayerSessionState; issues: PlayerControlIssue[] };

/** Queue validated board risk targets for the next close using the GUI's current floors. */
export const updatePlayerSessionRiskAppetite = (
  current: PlayerSessionState,
  targets: PlayerRiskAppetite | null,
): PlayerRiskAppetiteUpdate => {
  if (current.status !== 'active' || current.bankState.status.hasFailed) {
    return { accepted: false, session: current, issues: [{ field: 'status', message: 'Run is not active' }] };
  }
  const issues = targets === null ? [] : validateRiskAppetiteTargets(targets, riskAppetiteFloorsFor(current.bankState, current.config));
  if (issues.length > 0) return { accepted: false, session: current, issues };
  return {
    accepted: true,
    session: { ...current, revision: current.revision + 1, pendingRiskAppetite: targets },
  };
};

export const updatePlayerSessionSafetyPause = (
  current: PlayerSessionState,
  requestedEnabled: boolean,
): PlayerSafetyPauseUpdate => {
  const result = applySafetyPauseToggle({
    enabled: current.safetyPause,
    disableArmed: current.safetyPauseDisableArmed ?? false,
    automaticRunActive: false,
  }, requestedEnabled);
  return {
    session: {
      ...current,
      revision: current.revision + 1,
      safetyPause: result.enabled,
      safetyPauseDisableArmed: result.disableArmed,
    },
    stopAutomaticRun: result.stopAutomaticRun,
    message: result.message,
  };
};

/**
 * Apply the same form validation, grouped action construction, scenario trigger and one-month
 * controller step used by the GUI. This is the only application-layer month-close path.
 */
export const closePlayerSessionMonth = (
  current: PlayerSessionState,
  controller: SimulationController
): ClosePlayerMonthResult => {
  if (current.status !== 'active' || current.bankState.status.hasFailed ||
      (current.horizonMonths !== undefined && current.bankState.time.step - current.openingState.time.step >= current.horizonMonths)) {
    return { accepted: false, session: current, issues: [], reason: 'terminal' };
  }

  const parsed = parseActionFormInputs(current.actionForm, {
    capitalMarketsArea: current.capitalMarketsDraftArea ?? undefined,
  });
  const riskAppetiteIssues = current.pendingRiskAppetite && current.pendingRiskAppetite !== null
    ? validateRiskAppetiteTargets(current.pendingRiskAppetite, riskAppetiteFloorsFor(current.bankState, current.config))
    : [];
  if (parsed.hasErrors || riskAppetiteIssues.length > 0) {
    return {
      accepted: false,
      session: current,
      issues: [
        ...Object.entries(parsed.errors).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([field, message]) => ({ field, message })),
        ...riskAppetiteIssues,
      ],
      reason: 'invalid',
    };
  }

  const actions = buildActionsFromParsed(parsed, current.actionForm, current.bankState);
  if (current.pendingRiskAppetite !== undefined) {
    actions.push({ type: 'setRiskAppetite', targets: current.pendingRiskAppetite });
  }
  const scenarioStep = getScenarioStepPayload({
    scenarioId: current.scenarioId,
    stepNumber: current.bankState.time.step,
    state: current.bankState,
    actions,
  });
  const stepped = controller.step(current.bankState, actions, scenarioStep.shocks, current.runId);
  const nextState = cloneBankState(stepped.nextState);
  const milestoneEvents: SimulationEvent[] = scenarioStep.milestones.map((milestone) => ({
    id: `${current.runId}-step-${stepped.nextState.time.step}-milestone-${milestone.id}`,
    severity: milestone.severity,
    message: milestone.message,
    timestamp: stepped.nextState.time.date.getTime(),
  }));
  const events = [...stepped.events, ...milestoneEvents];
  const nextHistory = [...current.stateHistory, nextState];
  const nextTimeline: ActionTimelineEntry[] = [
    ...current.timeline,
    { step: nextState.time.step, actions: actions.map((action) => ({ ...action })), shocks: scenarioStep.shocks.map((shock) => ({ ...shock })) },
  ];
  const status: PlayerRunStatus = nextState.status.hasFailed
    ? 'bank_failure'
    : current.horizonMonths !== undefined && nextState.time.step - current.openingState.time.step >= current.horizonMonths
      ? 'horizon_reached'
      : 'active';
  const pausedForAttention = status === 'active' && current.safetyPause && Boolean(attentionReason(nextState, current.config));
  const session: PlayerSessionState = {
    ...current,
    revision: current.revision + 1,
    bankState: nextState,
    stateHistory: nextHistory,
    eventLog: [...current.eventLog, ...events],
    lastAttribution: stepped.diagnostics.attribution,
    actionForm: clearOneOffTransactions(current.actionForm),
    capitalMarketsDraftArea: null,
    pendingRiskAppetite: undefined,
    timeline: nextTimeline,
    snapshots: [...current.snapshots, controller.createSnapshot(nextState)],
    status,
    stopReason: status === 'bank_failure' ? 'bank_failure' : status === 'horizon_reached' ? 'horizon_reached' : pausedForAttention ? 'safety_pause' : undefined,
  };

  return {
    accepted: true,
    session,
    actions,
    shocks: scenarioStep.shocks,
    events,
    executions: stepped.executions,
    attribution: stepped.diagnostics.attribution,
    pausedForAttention,
  };
};
