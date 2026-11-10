import { describe, expect, it } from 'vitest';
import { prepareScenarioSession } from './scenarioSession';
import { createPlayerSessionState } from './playerSession';
import { SimulationController } from './simulationController';
import { closePlayerSessionMonth } from './playerSession';
import { queuePlayerSessionTransaction, updatePlayerSessionDecisions } from './playerSessionCommands';
import {
  canonicalBankStateHash,
  decodePlayerSessionState,
  encodePlayerSessionState,
  PLAYER_SESSION_CODEC_VERSION,
} from './sessionCodec';

const makeSession = () => {
  const prepared = prepareScenarioSession('wholesale-funding-reliance', { seed: 909090 });
  const controller = new SimulationController(prepared.config);
  return createPlayerSessionState({ runId: 'codec-test', scenarioId: 'wholesale-funding-reliance', prepared, controller });
};

describe('player session persistence codec', () => {
  it('round trips complete session data and restores independent Date and state objects', async () => {
    const original = makeSession();
    const restored = decodePlayerSessionState(encodePlayerSessionState(original));

    expect(restored).toEqual(original);
    expect(restored.bankState.time.date).toBeInstanceOf(Date);
    expect(restored.bankState).not.toBe(original.bankState);
    expect(restored.bankState.market).not.toBe(original.bankState.market);
    expect(await canonicalBankStateHash(restored.bankState)).toBe(await canonicalBankStateHash(original.bankState));

    restored.bankState.market.baseRate += 0.01;
    expect(restored.bankState.market.baseRate).not.toBe(original.bankState.market.baseRate);
  });

  it('rejects non-finite values and unsupported codec versions', () => {
    const session = makeSession();
    session.bankState.market.baseRate = Number.NaN;
    expect(() => encodePlayerSessionState(session)).toThrow(/non-finite/);

    const encoded = encodePlayerSessionState(makeSession());
    const envelope = JSON.parse(encoded) as Record<string, unknown>;
    envelope.version = PLAYER_SESSION_CODEC_VERSION + 1;
    expect(() => decodePlayerSessionState(JSON.stringify(envelope))).toThrow(/version/);
  });

  it('rejects malformed forms and inconsistent close histories', () => {
    const malformedForm = makeSession();
    malformedForm.actionForm.hedgeDirection = 'execute-arbitrary-action' as never;
    expect(() => encodePlayerSessionState(malformedForm)).toThrow(/action form/);

    const malformedHistory = makeSession();
    malformedHistory.timeline.push({ step: 1, actions: [], shocks: [] });
    expect(() => encodePlayerSessionState(malformedHistory)).toThrow(/inconsistent/);
  });

  it('resumes queued transactions and pending drafts without executing the draft', () => {
    const original = makeSession();
    const draft = updatePlayerSessionDecisions(original, {}, {
      gilt: { direction: 'buy', amountGbp: '25m', tenorMonths: 60 },
    });
    expect(draft.accepted).toBe(true);
    if (!draft.accepted) return;
    const queued = queuePlayerSessionTransaction(draft.session, 'giltTrade');
    expect(queued.accepted).toBe(true);
    if (!queued.accepted) return;
    const malformedQueue = structuredClone(queued.session);
    const malformedGilt = malformedQueue.queuedTransactions[0].action;
    if (malformedGilt.type !== 'buySellAsset') throw new Error('Expected a queued gilt action');
    malformedGilt.amountDelta = Number.NaN;
    expect(() => encodePlayerSessionState(malformedQueue)).toThrow(/queued gilt transaction/);
    const withPendingDraft = updatePlayerSessionDecisions(queued.session, {}, {
      hedge: { direction: 'payFixedReceiveFloat', notionalGbp: '5m', maturityMonths: 24 },
    });
    expect(withPendingDraft.accepted).toBe(true);
    if (!withPendingDraft.accepted) return;

    const restored = decodePlayerSessionState(encodePlayerSessionState(withPendingDraft.session));
    expect(restored.queuedTransactions).toEqual(withPendingDraft.session.queuedTransactions);
    expect(restored.nextTransactionId).toBe(2);
    expect(restored.actionForm.hedgeDirection).toBe('payFixedReceiveFloat');

    const originalClose = closePlayerSessionMonth(withPendingDraft.session, new SimulationController(withPendingDraft.session.config));
    const resumedClose = closePlayerSessionMonth(restored, new SimulationController(restored.config));
    expect(originalClose.accepted).toBe(true);
    expect(resumedClose.accepted).toBe(true);
    if (!originalClose.accepted || !resumedClose.accepted) return;
    expect(resumedClose.actions).toContainEqual(expect.objectContaining({ type: 'buySellAsset', productType: 'Gilts' }));
    expect(resumedClose.actions.some((action) => action.type === 'enterHedge')).toBe(false);
    expect(resumedClose.session.timeline).toEqual(originalClose.session.timeline);
    expect(resumedClose.session.bankState).toEqual(originalClose.session.bankState);
  });
});
