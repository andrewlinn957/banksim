import { describe, expect, it } from 'vitest';
import { prepareScenarioSession } from './scenarioSession';
import { SimulationController } from './simulationController';
import { closePlayerSessionMonth, createPlayerSessionState } from './playerSession';
import { cancelPlayerSessionTransaction, queuePlayerSessionTransaction, updatePlayerSessionDecisions } from './playerSessionCommands';

const makeSession = () => {
  const prepared = prepareScenarioSession(null, { seed: 444 });
  const controller = new SimulationController(prepared.config);
  return { session: createPlayerSessionState({ runId: 'command-test', scenarioId: null, prepared, controller }), controller };
};

describe('shared player session commands', () => {
  it('rejects hidden raw engine controls and preserves GUI corporate deposit grouping', () => {
    const { session, controller } = makeSession();
    const rejected = updatePlayerSessionDecisions(session, { 'deposit.corporateOperatingRate': 0.025 });
    expect(rejected.accepted).toBe(false);
    if (rejected.accepted) return;
    expect(rejected.session).toBe(session);

    const updated = updatePlayerSessionDecisions(session, { 'policy.deposit.corporate_rate': 0.025 });
    expect(updated.accepted).toBe(true);
    if (!updated.accepted) return;
    expect(updated.session.bankState).toBe(session.bankState);
    expect(updated.session.timeline).toHaveLength(0);
    const closed = closePlayerSessionMonth(updated.session, controller);
    expect(closed.accepted).toBe(true);
    if (closed.accepted) {
      const rates = closed.actions.filter((action) => action.type === 'adjustRate' &&
        ['CorporateOperatingDeposits', 'CorporateNonOperatingDeposits'].includes(action.productType));
      expect(rates).toHaveLength(2);
      expect(rates.every((action) => action.type === 'adjustRate' && action.newRate === 0.025)).toBe(true);
    }
  });

  it('matches the GUI exact selectivity input rather than enforcing its slider step', () => {
    const { session } = makeSession();
    const result = updatePlayerSessionDecisions(session, { 'policy.loan.consumer_selectivity': 0.123 });
    expect(result.accepted).toBe(true);
  });

  it('keeps transaction drafts unsettled until close and cancellation preserves standing policy', () => {
    const { session, controller } = makeSession();
    const policy = updatePlayerSessionDecisions(session, { 'policy.deposit.retail_current': 0.03 });
    expect(policy.accepted).toBe(true);
    if (!policy.accepted) return;

    const first = queuePlayerSessionTransaction(policy.session, { kind: 'gilt', direction: 'buy', amountGbp: 50e6, tenorMonths: 60 });
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    expect(first.session.bankState).toBe(session.bankState);
    expect(first.session.timeline).toHaveLength(0);
    const replaced = queuePlayerSessionTransaction(first.session, { kind: 'gilt', direction: 'buy', amountGbp: 75e6, tenorMonths: 120 });
    expect(replaced.accepted).toBe(true);
    if (!replaced.accepted) return;
    const cancelled = cancelPlayerSessionTransaction(replaced.session, 'gilt');
    expect(cancelled.accepted).toBe(true);
    if (!cancelled.accepted) return;
    expect(cancelled.session.actionForm.retailCurrentAccountRate).toBe('0.03');
    expect(cancelled.session.actionForm.giltTradeDirection).toBe('none');
    expect(cancelled.session.timeline).toHaveLength(0);
  });
});
