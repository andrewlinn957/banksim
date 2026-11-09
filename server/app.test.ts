import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodePlayerSessionState } from '../src/application/sessionCodec';
import { hashBankState } from './store';
import { createBankSimServer, SimulatedProcessInterruption } from './app';
import { EvaluationStore } from './store';
import { prepareScenarioSession } from '../src/application/scenarioSession';
import { createPlayerSessionState, closePlayerSessionMonth } from '../src/application/playerSession';
import { cancelPlayerSessionTransaction, queuePlayerSessionTransaction, updatePlayerSessionDecisions } from '../src/application/playerSessionCommands';
import { SimulationController } from '../src/application/simulationController';

const ADMIN_TOKEN = 'test-admin-token-0123456789-abcdefghijklmnopqrstuvwxyz';
const ENGINE_VERSION = 'test-engine-v1';

interface Fixture {
  dir: string;
  dbPath: string;
  store: EvaluationStore;
  app: Awaited<ReturnType<typeof createBankSimServer>>;
  close: (preserveDirectory?: boolean) => Promise<void>;
}

const fixtures: Fixture[] = [];

const fixture = async (options: { afterAdvanceMonthCommit?: (runId: string, completedMonths: number) => void; dbPath?: string } = {}): Promise<Fixture> => {
  const dir = options.dbPath ? dirname(options.dbPath) : mkdtempSync(join(tmpdir(), 'banksim-api-'));
  const dbPath = options.dbPath ?? join(dir, 'evaluation.sqlite3');
  const store = new EvaluationStore(dbPath);
  const app = await createBankSimServer({
    store,
    adminToken: ADMIN_TOKEN,
    engineVersion: ENGINE_VERSION,
    logger: false,
    testHooks: options.afterAdvanceMonthCommit ? { afterAdvanceMonthCommit: options.afterAdvanceMonthCommit } : undefined,
  });
  let closed = false;
  const value: Fixture = {
    dir,
    dbPath,
    store,
    app,
    close: async (preserveDirectory = false) => {
      if (!closed) {
        closed = true;
        await app.close();
        store.close();
      }
      if (!preserveDirectory && dir) rmSync(dir, { recursive: true, force: true });
    },
  };
  fixtures.push(value);
  return value;
};

afterEach(async () => {
  for (const current of fixtures.splice(0)) await current.close();
});

const auth = (token = ADMIN_TOKEN) => ({ authorization: `Bearer ${token}` });

const createRun = async (app: Fixture['app'], options: { seed?: number; horizonMonths?: number } = {}) => {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/v1/runs',
    headers: auth(),
    payload: { engineVersion: ENGINE_VERSION, scenarioId: null, seed: options.seed ?? 20261108, horizonMonths: options.horizonMonths ?? 12 },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { runId: string; revision: number; simulationStep: number };
};

const issuePlayerToken = async (app: Fixture['app'], runId: string) => {
  const response = await app.inject({ method: 'POST', url: `/admin/v1/runs/${runId}/credentials`, headers: auth(), payload: {} });
  expect(response.statusCode).toBe(201);
  return (response.json() as { token: string }).token;
};

const command = (runId: string, token: string, body: Record<string, unknown>) =>
  fixtures.at(-1)!.app.inject({ method: 'POST', url: `/api/v1/runs/${runId}/commands`, headers: auth(token), payload: body });

describe('persistent BankSim API service', () => {
  it('isolates credentials and shares the grouped GUI controls and transaction close pipeline', async () => {
    const f = await fixture();
    const health = await f.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    expect(JSON.stringify(health.json())).not.toContain('seed');

    const run = await createRun(f.app, { horizonMonths: 4 });
    const token = await issuePlayerToken(f.app, run.runId);
    const otherRun = await createRun(f.app);
    const otherToken = await issuePlayerToken(f.app, otherRun.runId);

    expect((await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/overview` })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'GET', url: `/api/v1/runs/${otherRun.runId}/overview`, headers: auth(token) })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'GET', url: `/admin/v1/runs/${run.runId}`, headers: auth(token) })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'GET', url: `/api/v1/runs/${otherRun.runId}/overview`, headers: auth(otherToken) })).statusCode).toBe(200);

    const overview = await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/overview`, headers: auth(token) });
    expect(overview.json().evaluationLimits).toEqual({ maxModelTurns: 1000, maxToolCalls: 5000 });

    const beforePreview = f.store.getSession(run.runId)!;
    const preview = await f.app.inject({ method: 'POST', url: `/api/v1/runs/${run.runId}/preview`, headers: auth(token), payload: { department: 'Customers' } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview).toBeDefined();
    expect(preview.body).not.toContain('macroModel');
    expect(hashBankState(f.store.getSession(run.runId)!.bankState)).toBe(hashBankState(beforePreview.bankState));
    expect(f.store.getSession(run.runId)?.revision).toBe(beforePreview.revision);

    const controls = await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/controls`, headers: auth(token) });
    expect(controls.statusCode).toBe(200);
    expect(controls.json().controls).toContainEqual(expect.objectContaining({ id: 'policy.deposit.corporate_rate', persistent: true }));

    const policyBody = { commandId: 'policy-1', expectedRevision: 0, type: 'update_decisions', payload: { controls: { 'policy.deposit.corporate_rate': 0.04 } } };
    const policy = await command(run.runId, token, policyBody);
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({ accepted: true, revision: 1 });
    const duplicatePolicy = await command(run.runId, token, policyBody);
    expect(duplicatePolicy.statusCode).toBe(200);
    expect(duplicatePolicy.json()).toEqual(policy.json());
    expect((await command(run.runId, token, { ...policyBody, payload: { controls: { 'policy.deposit.corporate_rate': 0.05 } } })).statusCode).toBe(409);

    const stale = await command(run.runId, token, { commandId: 'stale-1', expectedRevision: 0, type: 'set_safety_pause', payload: { enabled: true } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ accepted: false, errorCode: 'STALE_REVISION', revision: 1 });
    const staleRetry = await command(run.runId, token, { commandId: 'stale-1', expectedRevision: 0, type: 'set_safety_pause', payload: { enabled: true } });
    expect(staleRetry.statusCode).toBe(409);
    expect(staleRetry.json()).toEqual(stale.json());

    const openingHash = hashBankState(f.store.getSession(run.runId)!.bankState);
    const queued = await command(run.runId, token, {
      commandId: 'queue-gilt-1', expectedRevision: 1, type: 'queue_transaction',
      payload: { kind: 'gilt', direction: 'buy', amountGbp: 1_000_000, tenorMonths: 60 },
    });
    expect(queued.statusCode).toBe(200);
    expect(queued.json()).toMatchObject({ accepted: true, revision: 2 });
    const queuedSession = f.store.getSession(run.runId)!;
    expect(hashBankState(queuedSession.bankState)).toBe(openingHash);
    expect(queuedSession.actionForm.giltTradeAmount).toBe('1000000');

    const cancelled = await command(run.runId, token, { commandId: 'cancel-gilt-1', expectedRevision: 2, type: 'cancel_transaction', payload: { kind: 'gilt' } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ accepted: true, revision: 3 });
    expect(f.store.getSession(run.runId)?.actionForm.giltTradeDirection).toBe('none');
    expect(f.store.getSession(run.runId)?.actionForm.corporateDepositRate).toBe(queuedSession.actionForm.corporateDepositRate);
    const requeued = await command(run.runId, token, {
      commandId: 'queue-gilt-2', expectedRevision: 3, type: 'queue_transaction',
      payload: { kind: 'gilt', direction: 'buy', amountGbp: 1_000_000, tenorMonths: 60 },
    });
    expect(requeued.json()).toMatchObject({ accepted: true, revision: 4 });

    const rawAction = await command(run.runId, token, {
      commandId: 'hidden-action-1', expectedRevision: 4, type: 'update_decisions', payload: { controls: { 'engine.setCapitalLedger': 1 } },
    });
    expect(rawAction.statusCode).toBe(422);
    expect(rawAction.json()).toMatchObject({ accepted: false, errorCode: 'INVALID_COMMAND', revision: 4 });
    const rawActionRetry = await command(run.runId, token, {
      commandId: 'hidden-action-1', expectedRevision: 4, type: 'update_decisions', payload: { controls: { 'engine.setCapitalLedger': 1 } },
    });
    expect(rawActionRetry.statusCode).toBe(422);
    expect(rawActionRetry.json()).toEqual(rawAction.json());
    const rawFields = await command(run.runId, token, {
      commandId: 'raw-deposit-fields-1', expectedRevision: 4, type: 'update_decisions', payload: { controls: { corporateOperatingDepositRate: 0.01, corporateNonOperatingDepositRate: 0.03 } },
    });
    expect(rawFields.statusCode).toBe(422);

    const close = await command(run.runId, token, { commandId: 'close-1', expectedRevision: 4, type: 'advance_time', payload: { months: 1 } });
    expect(close.statusCode).toBe(200);
    expect(close.json()).toMatchObject({ accepted: true, monthsClosed: 1, revision: 5 });
    const closedSession = f.store.getSession(run.runId)!;
    expect(closedSession.bankState.time.step).toBe(run.simulationStep + 1);
    expect(closedSession.actionForm.giltTradeDirection).toBe('none');
    expect(closedSession.timeline[0].actions).toContainEqual(expect.objectContaining({ type: 'buySellAsset', productType: 'Gilts' }));
    expect(closedSession.timeline[0].actions).toContainEqual(expect.objectContaining({ type: 'adjustRate', productType: 'CorporateOperatingDeposits', newRate: 0.04 }));
    expect(closedSession.timeline[0].actions).toContainEqual(expect.objectContaining({ type: 'adjustRate', productType: 'CorporateNonOperatingDeposits', newRate: 0.04 }));

    const pastGames = await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/reports/report.past_games`, headers: auth(token) });
    expect(pastGames.statusCode).toBe(200);
    expect(pastGames.json().data.rows).toHaveLength(1);
    const openapi = await f.app.inject({ method: 'GET', url: '/openapi.json' });
    expect(openapi.statusCode).toBe(200);
    expect(openapi.json().paths['/api/v1/runs/{runId}/commands']).toBeDefined();
  });

  it('keeps hidden state out of the player API and exposes it only to the admin export', async () => {
    const f = await fixture();
    const run = await createRun(f.app);
    const token = await issuePlayerToken(f.app, run.runId);
    const session = f.store.getSession(run.runId)!;
    (session.config as typeof session.config & { privateAuditMarker: string }).privateAuditMarker = 'BANKSIM-PRIVATE-MARKER-98e1';
    f.store.db.prepare('UPDATE runs SET session_json = ? WHERE run_id = ?').run(encodePlayerSessionState(session), run.runId);

    const fixedResponses = await Promise.all([
      f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/overview`, headers: auth(token) }),
      f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/controls`, headers: auth(token) }),
      f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/export`, headers: auth(token) }),
    ]);
    const reports = await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/reports`, headers: auth(token) });
    expect(reports.statusCode).toBe(200);
    const availableReports = (reports.json() as { reports: Array<{ id: string; available: boolean }> }).reports.filter((report) => report.available);
    const reportResponses = await Promise.all(availableReports.map((report) =>
      f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/reports/${report.id}`, headers: auth(token) }),
    ));
    const help = await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/reports/report.help`, headers: auth(token) });
    const firstTopicId = (help.json() as { data: { topics: Array<{ id: string }> } }).data.topics[0].id;
    const helpTopic = await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/help/${firstTopicId}`, headers: auth(token) });
    const preview = await f.app.inject({ method: 'POST', url: `/api/v1/runs/${run.runId}/preview`, headers: auth(token), payload: {} });
    const playerResponses = [...fixedResponses, ...reportResponses, helpTopic, preview];
    for (const response of playerResponses) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('BANKSIM-PRIVATE-MARKER-98e1');
      expect(response.body).not.toContain('"privateAuditMarker":');
      expect(response.body).not.toContain('"seed":');
      expect(response.body).not.toContain('"rngSeed":');
      expect(response.body).not.toContain('"configSnapshot":');
    }
    const adminExport = await f.app.inject({ method: 'GET', url: `/admin/v1/runs/${run.runId}/export`, headers: auth() });
    expect(adminExport.statusCode).toBe(200);
    expect(adminExport.body).toContain('BANKSIM-PRIVATE-MARKER-98e1');
  });

  it('matches the GUI session opening and monthly close for the same seed and accepted decisions', async () => {
    const f = await fixture();
    const run = await createRun(f.app, { seed: 998877, horizonMonths: 6 });
    const token = await issuePlayerToken(f.app, run.runId);
    const prepared = prepareScenarioSession(null, { seed: 998877 });
    const controller = new SimulationController(prepared.config);
    let guiSession = createPlayerSessionState({ runId: run.runId, scenarioId: null, prepared, controller, horizonMonths: 6 });
    expect(hashBankState(guiSession.bankState)).toBe(hashBankState(f.store.getSession(run.runId)!.bankState));

    const policy = updatePlayerSessionDecisions(guiSession, { 'policy.deposit.corporate_rate': 0.04 });
    expect(policy.accepted).toBe(true);
    if (policy.accepted) guiSession = policy.session;
    const queued = queuePlayerSessionTransaction(guiSession, { kind: 'gilt', direction: 'buy', amountGbp: 1_000_000, tenorMonths: 60 });
    expect(queued.accepted).toBe(true);
    if (queued.accepted) guiSession = queued.session;
    const cancelled = cancelPlayerSessionTransaction(guiSession, 'gilt');
    expect(cancelled.accepted).toBe(true);
    if (cancelled.accepted) guiSession = cancelled.session;
    const requeued = queuePlayerSessionTransaction(guiSession, { kind: 'gilt', direction: 'buy', amountGbp: 1_000_000, tenorMonths: 60 });
    expect(requeued.accepted).toBe(true);
    if (requeued.accepted) guiSession = requeued.session;

    for (const [commandId, type, payload] of [
      ['parity-policy', 'update_decisions', { controls: { 'policy.deposit.corporate_rate': 0.04 } }],
      ['parity-queue', 'queue_transaction', { kind: 'gilt', direction: 'buy', amountGbp: 1_000_000, tenorMonths: 60 }],
      ['parity-cancel', 'cancel_transaction', { kind: 'gilt' }],
      ['parity-requeue', 'queue_transaction', { kind: 'gilt', direction: 'buy', amountGbp: 1_000_000, tenorMonths: 60 }],
    ] as const) {
      const expectedRevision = f.store.getSession(run.runId)!.revision;
      const response = await command(run.runId, token, { commandId, expectedRevision, type, payload });
      expect(response.json().accepted).toBe(true);
    }
    const close = await command(run.runId, token, { commandId: 'parity-close', expectedRevision: 4, type: 'advance_time', payload: { months: 1 } });
    expect(close.json().accepted).toBe(true);
    const guiClose = closePlayerSessionMonth(guiSession, controller);
    expect(guiClose.accepted).toBe(true);
    if (guiClose.accepted) guiSession = guiClose.session;
    const apiSession = f.store.getSession(run.runId)!;
    expect(hashBankState(apiSession.bankState)).toBe(hashBankState(guiSession.bankState));
    expect(apiSession.timeline).toEqual(guiSession.timeline);
    expect(apiSession.eventLog).toEqual(guiSession.eventLog);
    expect(apiSession.actionForm.giltTradeDirection).toBe(guiSession.actionForm.giltTradeDirection);
  });

  it('accepts typed intermediate underwriting values while reporting the GUI slider step', async () => {
    const f = await fixture();
    const run = await createRun(f.app);
    const token = await issuePlayerToken(f.app, run.runId);

    const controls = await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/controls`, headers: auth(token) });
    expect(controls.json().controls).toContainEqual(expect.objectContaining({
      id: 'policy.loan.mortgage_selectivity', sliderStep: 0.05, exactInputAllowsIntermediateValues: true,
    }));

    const update = await command(run.runId, token, {
      commandId: 'typed-selectivity-1', expectedRevision: 0, type: 'update_decisions',
      payload: { controls: { 'policy.loan.mortgage_selectivity': 0.425 } },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({ accepted: true, revision: 1 });

    const close = await command(run.runId, token, {
      commandId: 'typed-selectivity-close', expectedRevision: 1, type: 'advance_time', payload: { months: 1 },
    });
    expect(close.statusCode).toBe(200);
    expect(f.store.getSession(run.runId)?.timeline[0].actions).toContainEqual({
      type: 'setUnderwriting', productType: 'Mortgages', tightness: 0.425,
    });
  });

  it('rejects transaction fields and area/instrument pairs that the GUI cannot submit', async () => {
    const f = await fixture();
    const run = await createRun(f.app);
    const token = await issuePlayerToken(f.app, run.runId);
    const controls = await f.app.inject({ method: 'GET', url: `/api/v1/runs/${run.runId}/controls`, headers: auth(token) });
    expect(controls.json().transactionOptions.capitalMarketsByArea).toMatchObject({
      Capital: [expect.objectContaining({ instrument: 'cet1', pricingKind: 'discount' }), expect.objectContaining({ instrument: 'at1' }), expect.objectContaining({ instrument: 'tier2' })],
      Treasury: [expect.objectContaining({ instrument: 'senior', pricingKind: 'spread' })],
    });

    const invalidBodies = [
      { commandId: 'bad-area-pair', expectedRevision: 0, type: 'queue_transaction', payload: { kind: 'capitalMarkets', area: 'Treasury', instrument: 'cet1', targetAmountGbp: 1_000_000 } },
      { commandId: 'bad-pricing-field', expectedRevision: 0, type: 'queue_transaction', payload: { kind: 'capitalMarkets', area: 'Capital', instrument: 'cet1', targetAmountGbp: 1_000_000, maxSpreadBps: 500 } },
      { commandId: 'bad-tenor', expectedRevision: 0, type: 'queue_transaction', payload: { kind: 'capitalMarkets', area: 'Treasury', instrument: 'senior', targetAmountGbp: 1_000_000, maxSpreadBps: 500, tenorMonths: 37 } },
      { commandId: 'bad-gilt-sell-tenor', expectedRevision: 0, type: 'queue_transaction', payload: { kind: 'gilt', direction: 'sell', amountGbp: 1_000, tenorMonths: 60 } },
      { commandId: 'bad-gilt-direction', expectedRevision: 0, type: 'queue_transaction', payload: { kind: 'gilt', direction: 'other', amountGbp: 1_000 } },
    ];
    for (const body of invalidBodies) {
      const response = await command(run.runId, token, body);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
      expect(f.store.getSession(run.runId)?.revision).toBe(0);
    }
  });

  it('serializes concurrent revisions and resumes a committed monthly checkpoint after restart', async () => {
    const first = await fixture();
    const run = await createRun(first.app, { horizonMonths: 3 });
    const token = await issuePlayerToken(first.app, run.runId);

    const [a, b] = await Promise.all([
      command(run.runId, token, { commandId: 'concurrent-a', expectedRevision: 0, type: 'set_safety_pause', payload: { enabled: true } }),
      command(run.runId, token, { commandId: 'concurrent-b', expectedRevision: 0, type: 'set_safety_pause', payload: { enabled: true } }),
    ]);
    expect([a.json().accepted, b.json().accepted].filter(Boolean)).toHaveLength(1);
    expect([a.json().errorCode, b.json().errorCode]).toContain('STALE_REVISION');
    expect(first.store.getRun(run.runId)?.revision).toBe(1);

    const queued = await command(run.runId, token, {
      commandId: 'persist-queued-gilt', expectedRevision: 1, type: 'queue_transaction',
      payload: { kind: 'gilt', direction: 'buy', amountGbp: 1_000_000, tenorMonths: 60 },
    });
    expect(queued.json()).toMatchObject({ accepted: true, revision: 2 });
    const databaseFile = first.dbPath;
    await first.close(true);

    const second = await fixture({ dbPath: databaseFile, afterAdvanceMonthCommit: (_runId, completedMonths) => {
      if (completedMonths === 1) throw new SimulatedProcessInterruption();
    } });
    expect(second.store.getSession(run.runId)?.actionForm.giltTradeAmount).toBe('1000000');
    const interrupted = await command(run.runId, token, { commandId: 'advance-restart', expectedRevision: 2, type: 'advance_time', payload: { months: 3 } });
    expect(interrupted.statusCode).toBe(500);
    expect(second.store.getCommand(run.runId, 'advance-restart')).toMatchObject({ status: 'running', completedMonths: 1 });
    expect(second.store.getSession(run.runId)?.bankState.time.step).toBe(run.simulationStep + 1);
    expect(second.store.getSession(run.runId)?.actionForm.giltTradeDirection).toBe('none');
    await second.close(true);

    const third = await fixture({ dbPath: databaseFile });
    await third.app.ready();
    const resumed = third.store.getCommand(run.runId, 'advance-restart');
    expect(resumed).toMatchObject({ status: 'completed', completedMonths: 3 });
    const finalSession = third.store.getSession(run.runId)!;
    expect(finalSession).toMatchObject({ status: 'horizon_reached', bankState: { time: { step: run.simulationStep + 3 } } });
    expect(finalSession.timeline.filter((entry) => entry.actions.some((action) => action.type === 'buySellAsset' && action.productType === 'Gilts'))).toHaveLength(1);
    const replay = await third.app.inject({ method: 'POST', url: '/admin/v1/replays', headers: auth(), payload: { runId: run.runId } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true, matchedSteps: 4, firstDivergence: null });
    const sameRetry = await command(run.runId, token, { commandId: 'advance-restart', expectedRevision: 2, type: 'advance_time', payload: { months: 3 } });
    expect(sameRetry.statusCode).toBe(200);
    expect(sameRetry.json()).toMatchObject({ accepted: true, monthsClosed: 3, status: 'horizon_reached' });
  });

  it('refuses to start against active runs pinned to a different engine release', async () => {
    const f = await fixture();
    await createRun(f.app);
    await expect(createBankSimServer({ store: f.store, adminToken: ADMIN_TOKEN, engineVersion: 'test-engine-v2' })).rejects.toThrow(/active runs pinned/);
    await expect(createBankSimServer({ store: f.store, adminToken: ADMIN_TOKEN, engineVersion: ENGINE_VERSION, buildDigest: 'different-build-digest' })).rejects.toThrow(/active runs pinned/);
  });
});
