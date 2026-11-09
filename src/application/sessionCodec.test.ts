import { describe, expect, it } from 'vitest';
import { prepareScenarioSession } from './scenarioSession';
import { createPlayerSessionState } from './playerSession';
import { SimulationController } from './simulationController';
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
});
