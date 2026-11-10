import type { ActionTimelineEntry } from '../src/domain/runHistory';
import type { BankState } from '../src/domain/bankState';
import type { SimulationController } from '../src/application/simulationController';
import { cloneBankState } from '../src/engine/clone';
import { hashBankState, hashJson } from './store';

export interface ReplayCheckpoint {
  step: number;
  stateHash: string;
}

export interface ReplayAuditRecord {
  sequence?: number;
  kind: string;
  payload?: unknown;
}

export interface RecordedReplayResult {
  replayed: boolean;
  matchedSteps: number;
  firstDivergence: { step: number; expected: string | null; actual: string; reason: string } | null;
  finalStateHash: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const comparableHash = (value: unknown): string => hashJson(value === undefined ? { auditUndefinedValue: true } : value);

const findMonthAuditRecords = (records: ReplayAuditRecord[]) => records.filter(
  (record) => record.kind === 'month_closed' && isRecord(record.payload),
);

/**
 * Replays the accepted decision timeline and checks it against both monthly audit records and
 * the checkpoint series. This is shared by the online admin replay route and offline bundle
 * verification so the two paths cannot silently accept different traces.
 */
export const verifyRecordedReplay = (args: {
  runId: string;
  openingState: BankState;
  finalState: BankState;
  timeline: ActionTimelineEntry[];
  checkpoints: ReplayCheckpoint[];
  serverAudit: ReplayAuditRecord[];
  controller: SimulationController;
}): RecordedReplayResult => {
  let state = cloneBankState(args.openingState);
  let matchedSteps = 0;
  let firstDivergence: RecordedReplayResult['firstDivergence'] = null;
  const openingStep = state.time.step;
  const openingHash = hashBankState(state);
  const checkpointByStep = new Map<number, string>();

  const sequenceIssues = auditSequenceIssues(args.serverAudit);
  if (sequenceIssues.length > 0) {
    firstDivergence = { step: openingStep, expected: 'contiguous audit sequence', actual: sequenceIssues[0]!, reason: 'server audit sequence is incomplete or out of order' };
  }

  for (const checkpoint of args.checkpoints) {
    if (firstDivergence) break;
    if (checkpointByStep.has(checkpoint.step)) {
      firstDivergence = { step: checkpoint.step, expected: 'unique checkpoint', actual: 'duplicate checkpoint', reason: 'duplicate monthly checkpoint step' };
      break;
    }
    checkpointByStep.set(checkpoint.step, checkpoint.stateHash);
  }

  if (!firstDivergence) {
    for (let index = 0; index < args.checkpoints.length; index += 1) {
      const expectedStep = openingStep + index;
      if (args.checkpoints[index]?.step !== expectedStep) {
        firstDivergence = {
          step: expectedStep,
          expected: String(expectedStep),
          actual: args.checkpoints[index] ? String(args.checkpoints[index].step) : 'missing',
          reason: 'checkpoint steps are not contiguous from the opening state',
        };
        break;
      }
    }
  }

  const openingCheckpoint = checkpointByStep.get(openingStep) ?? null;
  if (!firstDivergence && openingHash !== openingCheckpoint) {
    firstDivergence = { step: openingStep, expected: openingCheckpoint, actual: openingHash, reason: 'opening checkpoint mismatch' };
  } else if (!firstDivergence) {
    matchedSteps += 1;
  }

  const monthAudit = findMonthAuditRecords(args.serverAudit);
  if (!firstDivergence && monthAudit.length !== args.timeline.length) {
    const step = openingStep + Math.min(monthAudit.length, args.timeline.length) + 1;
    firstDivergence = {
      step,
      expected: `${args.timeline.length} monthly close records`,
      actual: `${monthAudit.length} monthly close records`,
      reason: 'timeline and monthly audit record counts differ',
    };
  }
  if (!firstDivergence && args.checkpoints.length !== args.timeline.length + 1) {
    firstDivergence = {
      step: openingStep + args.timeline.length,
      expected: `${args.timeline.length + 1} checkpoints`,
      actual: `${args.checkpoints.length} checkpoints`,
      reason: 'timeline and checkpoint counts differ',
    };
  }

  for (const [index, entry] of args.timeline.entries()) {
    if (firstDivergence) break;
    const expectedStep = openingStep + index + 1;
    if (entry.step !== expectedStep) {
      firstDivergence = { step: expectedStep, expected: String(expectedStep), actual: String(entry.step), reason: 'timeline steps are not contiguous' };
      break;
    }
    const record = monthAudit[index];
    const payload = record && isRecord(record.payload) ? record.payload : undefined;
    if (!payload) {
      firstDivergence = { step: entry.step, expected: 'monthly audit record', actual: 'missing', reason: 'monthly close has no matching server audit record' };
      break;
    }
    if (record?.sequence !== undefined && index > 0 && record.sequence <= (monthAudit[index - 1]?.sequence ?? -1)) {
      firstDivergence = { step: entry.step, expected: 'increasing audit sequence', actual: String(record.sequence), reason: 'monthly audit records are out of order' };
      break;
    }
    if (comparableHash(payload.acceptedActions) !== comparableHash(entry.actions)) {
      firstDivergence = { step: entry.step, expected: comparableHash(payload.acceptedActions), actual: comparableHash(entry.actions), reason: 'recorded accepted actions differ from monthly audit' };
      break;
    }
    if (comparableHash(payload.shocks) !== comparableHash(entry.shocks)) {
      firstDivergence = { step: entry.step, expected: comparableHash(payload.shocks), actual: comparableHash(entry.shocks), reason: 'recorded shocks differ from monthly audit' };
      break;
    }

    state = cloneBankState(args.controller.step(state, entry.actions, entry.shocks, args.runId).nextState);
    const actual = hashBankState(state);
    const expected = checkpointByStep.get(entry.step) ?? null;
    if (actual !== expected) {
      firstDivergence = { step: entry.step, expected, actual, reason: 'replayed BankState differs from monthly checkpoint' };
      break;
    }
    if (payload.stateHash !== actual) {
      firstDivergence = { step: entry.step, expected: typeof payload.stateHash === 'string' ? payload.stateHash : 'missing', actual, reason: 'monthly audit state hash differs from replayed state' };
      break;
    }
    matchedSteps += 1;
  }

  if (!firstDivergence && hashBankState(state) !== hashBankState(args.finalState)) {
    firstDivergence = { step: args.finalState.time.step, expected: hashBankState(args.finalState), actual: hashBankState(state), reason: 'replayed final state differs from current session' };
  }

  return { replayed: firstDivergence === null, matchedSteps, firstDivergence, finalStateHash: hashBankState(state) };
};

/** Audit rows use a per-run monotonic sequence; check it before trusting a replay trace. */
export const auditSequenceIssues = (records: ReplayAuditRecord[]): string[] => {
  const issues: string[] = [];
  records.forEach((record, index) => {
    const expected = index + 1;
    if (record.sequence !== expected) issues.push(`Server audit sequence ${expected} is missing or out of order`);
  });
  return issues;
};
