import { describe, expect, it } from 'vitest';
import { prepareScenarioSession } from '../src/application/scenarioSession';
import { SimulationController } from '../src/application/simulationController';
import { cloneBankState } from '../src/engine/clone';
import { hashBankState } from './store';
import { verifyRecordedReplay } from './replayVerifier';

const makeReplayFixture = () => {
  const prepared = prepareScenarioSession(null, { seed: 455021, startDate: new Date('2025-12-31T00:00:00.000Z') });
  const controller = new SimulationController(prepared.config);
  const runId = 'replay-fixture-run';
  const openingState = cloneBankState(prepared.state);
  const actions = [
    { type: 'adjustRate', productType: 'CorporateOperatingDeposits', newRate: 0.035 },
    { type: 'adjustRate', productType: 'CorporateNonOperatingDeposits', newRate: 0.035 },
  ] as const;
  const shocks = [{ type: 'depositCompetition', retailRateIncrease: 0.002, corporateRateIncrease: 0.003 }] as const;
  const nextState = cloneBankState(controller.step(openingState, [...actions], [...shocks], runId).nextState);
  const stateHash = hashBankState(nextState);
  return {
    runId,
    openingState,
    finalState: nextState,
    timeline: [{ step: nextState.time.step, actions: [...actions], shocks: [...shocks] }],
    checkpoints: [
      { step: openingState.time.step, stateHash: hashBankState(openingState) },
      { step: nextState.time.step, stateHash },
    ],
    serverAudit: [
      { sequence: 1, kind: 'run_created', payload: { openingStep: openingState.time.step } },
      { sequence: 2, kind: 'month_closed', payload: { acceptedActions: [...actions], shocks: [...shocks], stateHash } },
    ],
    controller,
  };
};

describe('recorded replay verification', () => {
  it('matches every accepted action, shock and monthly checkpoint', () => {
    const fixture = makeReplayFixture();
    expect(verifyRecordedReplay(fixture)).toMatchObject({
      replayed: true,
      matchedSteps: 2,
      firstDivergence: null,
      finalStateHash: hashBankState(fixture.finalState),
    });
  });

  it('reports the first changed shock before replaying a divergent month', () => {
    const fixture = makeReplayFixture();
    const corrupted = { ...fixture, serverAudit: structuredClone(fixture.serverAudit) };
    (corrupted.serverAudit[1]!.payload as { shocks: Array<{ corporateRateIncrease: number }> }).shocks[0]!.corporateRateIncrease = 0.004;
    expect(verifyRecordedReplay(corrupted)).toMatchObject({
      replayed: false,
      matchedSteps: 1,
      firstDivergence: expect.objectContaining({ step: 1, reason: 'recorded shocks differ from monthly audit' }),
    });
  });

  it('rejects a missing checkpoint even when the final session is otherwise unchanged', () => {
    const fixture = makeReplayFixture();
    const corrupted = { ...fixture, checkpoints: fixture.checkpoints.slice(0, 1) };
    expect(verifyRecordedReplay(corrupted)).toMatchObject({
      replayed: false,
      firstDivergence: expect.objectContaining({ step: 1, reason: 'timeline and checkpoint counts differ' }),
    });
  });
});
