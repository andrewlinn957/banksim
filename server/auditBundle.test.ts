import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodePlayerSessionState, encodePlayerSessionState } from '../src/application/sessionCodec';
import { createJoinedAuditBundle, parseClientTranscript, verifyJoinedAuditBundle, type ServerAuditExport } from './auditBundle';
import { createBankSimServer } from './app';
import { EvaluationStore, hashJson } from './store';

const ADMIN_TOKEN = 'audit-bundle-test-admin-token-0123456789-abcdefghijkl';
const ENGINE_VERSION = 'audit-bundle-test-v1';
const directories: string[] = [];
const fixtures: Array<{ app: Awaited<ReturnType<typeof createBankSimServer>>; store: EvaluationStore }> = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.app.close();
    fixture.store.close();
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const createFixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), 'banksim-audit-bundle-'));
  directories.push(directory);
  const store = new EvaluationStore(join(directory, 'audit.sqlite3'));
  const app = await createBankSimServer({ store, adminToken: ADMIN_TOKEN, engineVersion: ENGINE_VERSION, logger: false });
  fixtures.push({ app, store });
  const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' };
  const createdResponse = await app.inject({
    method: 'POST', url: '/admin/v1/runs', headers: adminHeaders,
    payload: { engineVersion: ENGINE_VERSION, scenarioId: null, seed: 112233, horizonMonths: 1 },
  });
  expect(createdResponse.statusCode).toBe(201);
  const runId = (createdResponse.json() as { runId: string }).runId;
  const credentialResponse = await app.inject({ method: 'POST', url: `/admin/v1/runs/${runId}/credentials`, headers: adminHeaders, payload: {} });
  const token = (credentialResponse.json() as { token: string }).token;
  const playerHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const decision = await app.inject({
    method: 'POST', url: `/api/v1/runs/${runId}/commands`, headers: playerHeaders,
    payload: { commandId: 'audit-policy', expectedRevision: 0, type: 'update_decisions', payload: { controls: { 'policy.deposit.corporate_rate': 0.25 } } },
  });
  expect(decision.json().accepted).toBe(true);
  const close = await app.inject({
    method: 'POST', url: `/api/v1/runs/${runId}/commands`, headers: playerHeaders,
    payload: { commandId: 'audit-close', expectedRevision: 1, type: 'advance_time', payload: { months: 1 } },
  });
  expect(close.json().status).toBe('horizon_reached');
  const exportResponse = await app.inject({ method: 'GET', url: `/admin/v1/runs/${runId}/export`, headers: adminHeaders });
  expect(exportResponse.statusCode).toBe(200);
  return {
    runId,
    server: exportResponse.json() as ServerAuditExport,
    app,
    store,
    token,
    playerHeaders,
    adminHeaders,
  };
};

const sampleTranscript = (runId: string) => `${JSON.stringify({ schemaVersion: 1, eventId: 'event-request', type: 'model_request', runId })}\n${JSON.stringify({ schemaVersion: 1, eventId: 'event-response', type: 'model_response', runId })}\n`;

describe('joined owner audit bundle', () => {
  it('verifies server checkpoints, exact client transcript bytes and model-free replay', async () => {
    const { runId, server } = await createFixture();
    expect(server.bundleVersion).toBe(2);
    expect(server.integrity.schemaVersions).toMatchObject({ bundle: 2, session: 1, command: 1, audit: 1, checkpoint: 1 });
    const rawTranscript = sampleTranscript(runId);
    const parsed = parseClientTranscript(rawTranscript);
    const prompt = Buffer.from('owner task\n', 'utf8');
    const runState = {
      runId, terminalReason: 'horizon_reached', transcriptGaps: [],
      prompt: { text: 'owner task\n', bytesBase64: prompt.toString('base64'), sha256: createHash('sha256').update(prompt).digest('hex') },
    };
    const bundle = createJoinedAuditBundle({
      server,
      client: { rawTranscript, records: parsed.records, transcriptParseErrors: parsed.errors, runState, runSummary: { runId, terminalReason: 'horizon_reached' } },
      collectedAt: '2026-11-08T00:00:00.000Z',
    });
    const verification = verifyJoinedAuditBundle(bundle);
    expect(bundle.client.completeness).toBe('complete');
    expect(verification).toMatchObject({ verified: true, client: { transcriptPresent: true, transcriptHashValid: true, recordCount: 2 } });
    expect(verification.replay).toMatchObject({ replayed: true, matchedSteps: 2, firstDivergence: null });

    const missing = createJoinedAuditBundle({ server, client: { rawTranscript: null, records: [] } });
    expect(missing.client.completeness).toBe('missing-client-transcript');
    expect(verifyJoinedAuditBundle(missing).client.transcriptPresent).toBe(false);
  });

  it('finds a corrupted recorded decision and reports the first divergent month', async () => {
    const { server } = await createFixture();
    const bundle = createJoinedAuditBundle({ server, client: { rawTranscript: null, records: [] } });
    const corrupted = structuredClone(bundle);
    const session = decodePlayerSessionState(corrupted.server.currentSessionCodec);
    const rateAction = session.timeline[0]?.actions.find((action) => action.type === 'adjustRate');
    expect(rateAction?.type).toBe('adjustRate');
    if (rateAction?.type === 'adjustRate') rateAction.newRate += 0.02;
    corrupted.server.currentSessionCodec = encodePlayerSessionState(session);

    const verification = verifyJoinedAuditBundle(corrupted);
    expect(verification.integrityIssues).toEqual(expect.arrayContaining([expect.stringContaining('current session codec hash mismatch')]));
    expect(verification.replay).toMatchObject({
      replayed: false,
      matchedSteps: 1,
      firstDivergence: expect.objectContaining({ step: 1, reason: 'recorded accepted actions differ from monthly audit' }),
    });
  });

  it('checks shock records and contiguous checkpoints during joined replay', async () => {
    const { server } = await createFixture();
    const bundle = createJoinedAuditBundle({ server, client: { rawTranscript: null, records: [] } });
    const corrupted = structuredClone(bundle);
    const monthlyClose = corrupted.server.serverAudit.find((record) => isRecordForAudit(record) && record.kind === 'month_closed');
    expect(monthlyClose && isRecordForAudit(monthlyClose)).toBe(true);
    if (monthlyClose && isRecordForAudit(monthlyClose)) {
      const payload = monthlyClose.payload as Record<string, unknown>;
      payload.shocks = [{ type: 'macroDownturn', pdMultiplier: 2, lgdMultiplier: 2 }];
    }

    const verification = verifyJoinedAuditBundle(corrupted);
    expect(verification.replay).toMatchObject({
      replayed: false,
      firstDivergence: expect.objectContaining({ step: 1, reason: 'recorded shocks differ from monthly audit' }),
    });

    const missingCheckpoint = structuredClone(bundle);
    missingCheckpoint.server.checkpoints.pop();
    missingCheckpoint.server.integrity.checkpointCount = Number(missingCheckpoint.server.integrity.checkpointCount) - 1;
    missingCheckpoint.server.integrity.checkpointsHash = hashJson(missingCheckpoint.server.checkpoints.map(({ step, revision, stateHash, sessionHash, createdAt }) => ({ step, revision, stateHash, sessionHash, createdAt })));
    const checkpointVerification = verifyJoinedAuditBundle(missingCheckpoint);
    expect(checkpointVerification.replay.firstDivergence).toMatchObject({ reason: 'timeline and checkpoint counts differ' });
  });

  it('records the exact request body for permitted player previews', async () => {
    const fixture = await createFixture();
    const response = await fixture.app.inject({
      method: 'POST', url: `/api/v1/runs/${fixture.runId}/preview`, headers: fixture.playerHeaders,
      payload: { department: 'Treasury' },
    });
    expect(response.statusCode).toBe(200);
    const read = fixture.store.listAuditRecords(fixture.runId).filter((record) => record.kind === 'player_read').at(-1);
    expect(read?.payload).toMatchObject({ request: { method: 'POST', body: { department: 'Treasury' } }, response: response.json() });
  });

  it('retains rejected preview requests and their exact validation response', async () => {
    const fixture = await createFixture();
    const session = fixture.store.getSession(fixture.runId)!;
    session.actionForm.mortgageRate = 'not-a-rate';
    fixture.store.db.prepare('UPDATE runs SET session_json = ? WHERE run_id = ?')
      .run(encodePlayerSessionState(session), fixture.runId);
    const response = await fixture.app.inject({
      method: 'POST', url: `/api/v1/runs/${fixture.runId}/preview`, headers: fixture.playerHeaders,
      payload: { department: 'Lending' },
    });
    expect(response.statusCode).toBe(422);
    const read = fixture.store.listAuditRecords(fixture.runId).filter((record) => record.kind === 'player_read').at(-1);
    expect(read?.payload).toMatchObject({
      request: { method: 'POST', body: { department: 'Lending' } },
      response: response.json(),
    });
  });

  it('uses the same replay verifier on the admin route and refuses a changed audit decision', async () => {
    const fixture = await createFixture();
    const monthlyClose = fixture.store.listAuditRecords(fixture.runId).find((record) => record.kind === 'month_closed');
    expect(monthlyClose).toBeDefined();
    fixture.store.db.exec('DROP TRIGGER audit_records_no_update');
    const changed = structuredClone(monthlyClose!);
    (changed.payload as Record<string, unknown>).acceptedActions = [];
    fixture.store.db.prepare('UPDATE audit_records SET payload_json = ? WHERE run_id = ? AND sequence = ?')
      .run(JSON.stringify(changed.payload), fixture.runId, changed.sequence);

    const response = await fixture.app.inject({ method: 'POST', url: '/admin/v1/replays', headers: fixture.adminHeaders, payload: { runId: fixture.runId } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      replayed: false,
      firstDivergence: expect.objectContaining({ step: 1, reason: 'recorded accepted actions differ from monthly audit' }),
    });
  });

  it('pins active runs to their creating Node runtime on restart and access', async () => {
    const fixture = await createFixture();
    fixture.store.db.prepare("UPDATE runs SET status = 'active' WHERE run_id = ?").run(fixture.runId);
    const run = fixture.store.getRun(fixture.runId)!;
    fixture.store.db.prepare('UPDATE runs SET manifest_json = ? WHERE run_id = ?')
      .run(JSON.stringify({ ...run.manifest, nodeVersion: 'v0.0.0-test' }), fixture.runId);

    await expect(createBankSimServer({ store: fixture.store, adminToken: ADMIN_TOKEN, engineVersion: ENGINE_VERSION, logger: false }))
      .rejects.toThrow(/another engine release, build digest, dependency lock, or Node runtime/);
    const player = await fixture.app.inject({ method: 'GET', url: `/api/v1/runs/${fixture.runId}/overview`, headers: fixture.playerHeaders });
    expect(player.statusCode).toBe(409);
    const replay = await fixture.app.inject({ method: 'POST', url: '/admin/v1/replays', headers: fixture.adminHeaders, payload: { runId: fixture.runId } });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({ error: { code: 'INCOMPATIBLE_ENGINE' } });
  });

  it('preserves a malformed final transcript fragment as an explicit partial record', async () => {
    const { runId, server } = await createFixture();
    const rawTranscript = `${sampleTranscript(runId)}{"eventId":"truncated"`;
    const parsed = parseClientTranscript(rawTranscript);
    const bundle = createJoinedAuditBundle({
      server,
      client: { rawTranscript, records: parsed.records, transcriptParseErrors: parsed.errors, runState: { runId, terminalReason: null, transcriptGaps: [] } },
    });
    expect(bundle.client.completeness).toBe('partial-with-gaps');
    expect(bundle.client.transcriptParseErrors).toHaveLength(1);
    const verification = verifyJoinedAuditBundle(bundle);
    expect(verification.integrityIssues).toContain('Client transcript contains incomplete or malformed records');
    expect(bundle.client.rawTranscript).toContain('truncated');
  });
});

const isRecordForAudit = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
