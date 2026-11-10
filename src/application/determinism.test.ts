import { describe, expect, it } from 'vitest';
import { createSeededInitialState } from '../config/initialState';
import { prepareScenarioSession } from './scenarioSession';
import { SimulationController } from './simulationController';
import { closePlayerSessionMonth, createPlayerSessionState, type PlayerSessionState } from './playerSession';
import { buildActionsFromParsed, parseActionFormInputs } from './playerControls';
import { queuePlayerSessionTransaction, updatePlayerSessionDecisions } from './playerSessionCommands';
import { canonicalBankStateHash, canonicalBankStateJson, decodePlayerSessionState, encodePlayerSessionState } from './sessionCodec';

const newSession = (seed: number, runId = 'matched-run') => {
  const prepared = prepareScenarioSession(null, { seed, startDate: '2025-12-31T00:00:00.000Z' });
  const controller = new SimulationController(prepared.config);
  const session = createPlayerSessionState({ runId, scenarioId: null, prepared, controller });
  return { session, controller };
};

const close = (session: PlayerSessionState, controller: SimulationController): PlayerSessionState => {
  const result = closePlayerSessionMonth(session, controller);
  if (result.accepted === false) throw new Error(`Test close rejected: ${result.issues.map((issue) => issue.message).join('; ')}`);
  return result.session;
};

describe('seeded session determinism', () => {
  it('builds the same complete opening bank for a seed and different cohorts for another seed', () => {
    const first = createSeededInitialState({ seed: 987654, startDate: '2025-12-31T00:00:00.000Z' });
    const repeat = createSeededInitialState({ seed: 987654, startDate: '2025-12-31T00:00:00.000Z' });
    const other = createSeededInitialState({ seed: 987655, startDate: '2025-12-31T00:00:00.000Z' });

    expect(canonicalBankStateJson(first)).toBe(canonicalBankStateJson(repeat));
    expect(first.market.macroModel.rngSeed).toBe(repeat.market.macroModel.rngSeed);
    expect(first.market.macroModel.rngSeed).not.toBe(other.market.macroModel.rngSeed);
    expect(first.loanCohorts).toEqual(repeat.loanCohorts);
    expect(first.loanCohorts).not.toEqual(other.loanCohorts);
    expect(first.time.date.toISOString()).toBe('2025-12-31T00:00:00.000Z');
    expect(first.loanCohorts).not.toBe(repeat.loanCohorts);
  });

  it('produces the same close after preview calls and checkpoint encode/decode', async () => {
    const uninterrupted = newSession(24680);
    let checkpointed = newSession(24680);
    uninterrupted.session = close(uninterrupted.session, uninterrupted.controller);
    checkpointed.session = close(checkpointed.session, checkpointed.controller);

    const encodedCheckpoint = encodePlayerSessionState(checkpointed.session);
    const resumed = decodePlayerSessionState(encodedCheckpoint);
    const parsed = parseActionFormInputs(resumed.actionForm, {
      capitalMarketsArea: resumed.capitalMarketsDraftArea ?? undefined,
    });
    const actions = buildActionsFromParsed(parsed, resumed.actionForm, resumed.bankState);
    checkpointed.controller.preview(resumed.bankState, actions, []);
    checkpointed.controller.preview(resumed.bankState, actions, []);

    uninterrupted.session = close(uninterrupted.session, uninterrupted.controller);
    const resumedResult = close(resumed, checkpointed.controller);
    expect(resumedResult.bankState).toEqual(uninterrupted.session.bankState);
    expect(await canonicalBankStateHash(resumedResult.bankState)).toBe(await canonicalBankStateHash(uninterrupted.session.bankState));
    expect(resumedResult.eventLog).toEqual(uninterrupted.session.eventLog);
    expect(resumedResult.timeline).toEqual(uninterrupted.session.timeline);
  });

  it('replays the accepted action timeline to the same canonical closing state', async () => {
    const played = newSession(86420);
    played.session = close(played.session, played.controller);
    played.session.actionForm = {
      ...played.session.actionForm,
      retailCurrentAccountRate: '2.2',
      mortgageRate: '5.1',
      mortgageUnderwritingTightness: '0.55',
    };
    played.session = close(played.session, played.controller);

    const replayed = new SimulationController(played.session.config).replay(
      played.session.openingState,
      played.session.timeline,
      played.session.runId,
    );
    expect(await canonicalBankStateHash(replayed.finalState)).toBe(await canonicalBankStateHash(played.session.bankState));
  });

  it('keeps macro stream advancement independent of player transaction count', () => {
    const noTicket = newSession(13579);
    const withTicket = newSession(13579);
    const drafted = updatePlayerSessionDecisions(withTicket.session, {}, {
      gilt: { direction: 'buy', amountGbp: '100m', tenorMonths: 60 },
    });
    expect(drafted.accepted).toBe(true);
    if (!drafted.accepted) return;
    const queued = queuePlayerSessionTransaction(drafted.session, 'giltTrade');
    expect(queued.accepted).toBe(true);
    if (!queued.accepted) return;

    const noTicketClosed = close(noTicket.session, noTicket.controller).bankState.market.macroModel;
    const withTicketResult = close(queued.session, withTicket.controller);
    const withTicketClosed = withTicketResult.bankState.market.macroModel;
    expect(withTicketClosed).toEqual(noTicketClosed);
    expect(withTicketResult.timeline.at(-1)?.actions.some((action) => action.type === 'buySellAsset')).toBe(true);
  });

  it('assigns repeatable event IDs and logical timestamps scoped to a run close', () => {
    const first = newSession(112233);
    const second = newSession(112233);
    const firstResult = closePlayerSessionMonth(first.session, first.controller);
    const secondResult = closePlayerSessionMonth(second.session, second.controller);
    expect(firstResult.accepted).toBe(true);
    expect(secondResult.accepted).toBe(true);
    if (!firstResult.accepted || !secondResult.accepted) return;
    expect(firstResult.events).toEqual(secondResult.events);
    expect(firstResult.events.every((event) => event.timestamp === firstResult.session.bankState.time.date.getTime())).toBe(true);
    expect(firstResult.events.every((event) => event.id.startsWith('evt-matched-run-1-') || event.id.startsWith('matched-run-step-1-'))).toBe(true);
  });
});
