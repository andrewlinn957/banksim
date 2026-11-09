import { describe, expect, it } from 'vitest';
import { prepareScenarioSession } from './scenarioSession';
import { SimulationController } from './simulationController';
import { closePlayerSessionMonth, createPlayerSessionState, updatePlayerSessionRiskAppetite, updatePlayerSessionSafetyPause } from './playerSession';

const makeSession = () => {
  const prepared = prepareScenarioSession(null);
  const controller = new SimulationController(prepared.config);
  const session = createPlayerSessionState({ runId: 'test-run', scenarioId: null, prepared, controller });
  return { session, controller };
};

describe('shared player session month close', () => {
  it('settles one-off drafts once, preserves policies, and records the exact accepted decision', () => {
    const { session, controller } = makeSession();
    session.actionForm = {
      ...session.actionForm,
      retailCurrentAccountRate: '2.25%',
      capitalMarketsInstrument: 'cet1',
      capitalMarketsTargetAmount: '100m',
    };

    const result = closePlayerSessionMonth(session, controller);
    expect(result.accepted).toBe(true);
    if (result.accepted !== true) return;

    expect(result.session.bankState.time.step).toBe(session.bankState.time.step + 1);
    expect(result.session.revision).toBe(session.revision + 1);
    expect(result.session.actionForm.retailCurrentAccountRate).toBe('2.25%');
    expect(result.session.actionForm.capitalMarketsInstrument).toBe('none');
    expect(result.session.actionForm.capitalMarketsTargetAmount).toBe('');
    expect(result.session.timeline).toHaveLength(1);
    expect(result.session.timeline[0].actions).toEqual(result.actions);
    expect(result.session.snapshots).toHaveLength(2);
  });

  it('rejects invalid form input without advancing time or changing the revision', () => {
    const { session, controller } = makeSession();
    session.actionForm = { ...session.actionForm, corporateLoanRate: '101%' };
    const result = closePlayerSessionMonth(session, controller);

    expect(result.accepted).toBe(false);
    if (result.accepted !== false) return;
    expect(result.reason).toBe('invalid');
    expect(result.issues.some((issue) => issue.field === 'corporateLoanRate')).toBe(true);
    expect(result.session.bankState.time.step).toBe(session.bankState.time.step);
    expect(result.session.revision).toBe(session.revision);
    expect(result.session.timeline).toHaveLength(0);
  });

  it('keeps capital-market tickets within the GUI area that created the draft', () => {
    const { session, controller } = makeSession();
    const treasuryTicketOnCapitalDesk = {
      ...session,
      capitalMarketsDraftArea: 'Capital' as const,
      actionForm: { ...session.actionForm, capitalMarketsInstrument: 'senior' as const, capitalMarketsTargetAmount: '100m' },
    };
    const result = closePlayerSessionMonth(treasuryTicketOnCapitalDesk, controller);

    expect(result.accepted).toBe(false);
    if (result.accepted !== false) return;
    expect(result.issues.some((issue) => issue.field === 'capitalMarketsInstrument')).toBe(true);
    expect(result.session.bankState.time.step).toBe(session.bankState.time.step);
    expect(result.session.timeline).toHaveLength(0);
  });

  it('applies the same confirmation requirement to in-run safety setting changes', () => {
    const { session } = makeSession();
    const first = updatePlayerSessionSafetyPause(session, false);
    expect(first.session.safetyPause).toBe(true);
    expect(first.session.safetyPauseDisableArmed).toBe(true);
    expect(first.session.revision).toBe(session.revision + 1);
    const confirmed = updatePlayerSessionSafetyPause(first.session, false);
    expect(confirmed.session.safetyPause).toBe(false);
    expect(confirmed.session.safetyPauseDisableArmed).toBe(false);
    expect(confirmed.session.revision).toBe(first.session.revision + 1);
  });

  it('validates queued risk appetite targets against current displayed floors', () => {
    const { session, controller } = makeSession();
    const rejected = updatePlayerSessionRiskAppetite(session, {
      cet1: session.config.riskLimits.minCet1Ratio / 2,
      leverage: session.config.riskLimits.minLeverageRatio,
      lcr: session.config.riskLimits.minLcr,
      nsfr: session.config.riskLimits.minNsfr,
      irrbbEveLimit: 100e6,
    });
    expect(rejected.accepted).toBe(false);
    if (rejected.accepted) return;
    expect(rejected.session).toBe(session);
    expect(rejected.issues.some((issue) => issue.field === 'cet1')).toBe(true);

    const queued = updatePlayerSessionRiskAppetite(session, {
      cet1: Math.max(session.config.riskLimits.minCet1Ratio, session.bankState.risk.riskMetrics.cet1Requirement),
      leverage: session.config.riskLimits.minLeverageRatio,
      lcr: session.config.riskLimits.minLcr,
      nsfr: session.config.riskLimits.minNsfr,
      irrbbEveLimit: 100e6,
    });
    expect(queued.accepted).toBe(true);
    if (!queued.accepted) return;
    const closed = closePlayerSessionMonth(queued.session, controller);
    expect(closed.accepted).toBe(true);
    if (closed.accepted) expect(closed.session.pendingRiskAppetite).toBeUndefined();
  });

  it('does not change a session when the close is requested after the finite horizon', () => {
    const { session, controller } = makeSession();
    const atHorizon = { ...session, horizonMonths: 0 };
    const result = closePlayerSessionMonth(atHorizon, controller);

    expect(result.accepted).toBe(false);
    if (result.accepted !== false) return;
    expect(result.reason).toBe('terminal');
    expect(result.session.revision).toBe(0);
  });
});
