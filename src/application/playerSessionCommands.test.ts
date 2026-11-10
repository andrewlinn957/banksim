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

  it('keeps drafts separate from queued actions, enforces one ticket per kind, and removes queued items by ID', () => {
    const { session, controller } = makeSession();
    const policy = updatePlayerSessionDecisions(session, { 'policy.deposit.retail_current': 0.03 });
    expect(policy.accepted).toBe(true);
    if (!policy.accepted) return;

    const draft = updatePlayerSessionDecisions(policy.session, {}, {
      gilt: { direction: 'buy', amountGbp: 50e6, tenorMonths: 60 },
    });
    expect(draft.accepted).toBe(true);
    if (!draft.accepted) return;
    expect(draft.session.actionForm.giltTradeDirection).toBe('buy');
    expect(draft.session.queuedTransactions).toHaveLength(0);
    const closeBeforeQueue = closePlayerSessionMonth(draft.session, controller);
    expect(closeBeforeQueue.accepted).toBe(true);
    if (closeBeforeQueue.accepted) expect(closeBeforeQueue.actions.some((action) => action.type === 'buySellAsset')).toBe(false);

    const queued = queuePlayerSessionTransaction(draft.session, 'giltTrade');
    expect(queued.accepted).toBe(true);
    if (!queued.accepted) return;
    expect(queued.session.bankState).toBe(session.bankState);
    expect(queued.session.timeline).toHaveLength(0);
    expect(queued.session.actionForm.giltTradeDirection).toBe('none');
    expect(queued.session.queuedTransactions).toHaveLength(1);
    expect(queued.session.queuedTransactions[0].id).toBe(1);
    const duplicate = queuePlayerSessionTransaction(queued.session, 'giltTrade');
    expect(duplicate.accepted).toBe(false);
    const cancelled = cancelPlayerSessionTransaction(queued.session, queued.session.queuedTransactions[0].id);
    expect(cancelled.accepted).toBe(true);
    if (!cancelled.accepted) return;
    expect(cancelled.session.actionForm.retailCurrentAccountRate).toBe('0.03');
    expect(cancelled.session.queuedTransactions).toHaveLength(0);
    expect(cancelled.session.timeline).toHaveLength(0);

    const closedQueued = closePlayerSessionMonth(queued.session, controller);
    expect(closedQueued.accepted).toBe(true);
    if (closedQueued.accepted) expect(closedQueued.actions.some((action) => action.type === 'buySellAsset')).toBe(true);
  });

  it('applies the same dependent-field effects as the GUI selectors', () => {
    const { session } = makeSession();
    const tier2 = updatePlayerSessionDecisions(session, {}, {
      capitalMarkets: { area: 'Capital', instrument: 'tier2', targetAmountGbp: '10m', tenorMonths: 84 },
    });
    expect(tier2.accepted).toBe(true);
    if (!tier2.accepted) return;

    const cleared = updatePlayerSessionDecisions(tier2.session, {}, { capitalMarkets: { instrument: 'none' } });
    expect(cleared.accepted).toBe(true);
    if (!cleared.accepted) return;
    expect(cleared.session.actionForm.capitalMarketsTargetAmount).toBe('');
    expect(cleared.session.capitalMarketsDraftArea).toBeNull();

    const senior = updatePlayerSessionDecisions(cleared.session, {}, {
      capitalMarkets: { area: 'Treasury', instrument: 'senior' },
    });
    expect(senior.accepted).toBe(true);
    if (!senior.accepted) return;
    expect(senior.session.actionForm.capitalMarketsTenorMonths).toBe('36');

    const drafts = updatePlayerSessionDecisions(senior.session, {}, {
      gilt: { direction: 'buy', amountGbp: '10m' },
      boeFunding: { facility: 'STR', amountGbp: '10m' },
      hedge: { direction: 'payFixedReceiveFloat', notionalGbp: '10m' },
    });
    expect(drafts.accepted).toBe(true);
    if (!drafts.accepted) return;
    const discarded = updatePlayerSessionDecisions(drafts.session, {}, {
      gilt: { direction: 'none' },
      boeFunding: { facility: 'none' },
      hedge: { direction: 'none' },
    });
    expect(discarded.accepted).toBe(true);
    if (!discarded.accepted) return;
    expect(discarded.session.actionForm.giltTradeAmount).toBe('');
    expect(discarded.session.actionForm.boeFundingAmount).toBe('');
    expect(discarded.session.actionForm.hedgeNotional).toBe('');
    expect(discarded.session.actionForm.hedgeFixedRate).toBe('');
  });
});
