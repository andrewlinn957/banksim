import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { PlayerSessionState } from '../src/application/playerSession';
import { canonicalBankStateJson, decodePlayerSessionState, encodePlayerSessionState } from '../src/application/sessionCodec';

export interface RunManifest {
  schemaVersion: number;
  engineVersion: string;
  buildDigest: string;
  dependencyLockHash: string;
  nodeVersion: string;
  scenarioId: string | null;
  scenarioVersion: string;
  configSnapshot: unknown;
  configHash: string;
  seed: number;
  seedSchemeVersion: string;
  startDate: string;
  horizonMonths: number;
  featureFlags: Record<string, boolean | undefined>;
  mode: { threeYearPlan: boolean };
  scoreVersion: string;
  controlContractVersion: string;
  reportContractVersion: string;
  evaluationLimits: { maxModelTurns: number; maxToolCalls: number };
}

export interface StoredRun {
  runId: string;
  status: string;
  revision: number;
  engineVersion: string;
  sessionJson: string;
  manifest: RunManifest;
  createdAt: string;
  updatedAt: string;
  stopReason: string | null;
}

export interface StoredCommand {
  runId: string;
  commandId: string;
  bodyHash: string;
  requestJson: string;
  requestId: string;
  status: 'running' | 'completed' | 'rejected' | 'failed';
  responseStatus: number;
  completedMonths: number;
  totalMonths: number;
  responseJson: string | null;
}

const nowIso = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
};

export const hashJson = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const hashBankState = (state: PlayerSessionState['bankState']): string => createHash('sha256').update(canonicalBankStateJson(state)).digest('hex');

export class EvaluationStore {
  readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        engine_version TEXT NOT NULL,
        session_json TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        stop_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS player_credentials (
        credential_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        token_hash TEXT NOT NULL UNIQUE,
        scopes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS player_credentials_by_run ON player_credentials(run_id, revoked_at);
      CREATE TABLE IF NOT EXISTS commands (
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        command_id TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        request_json TEXT NOT NULL,
        request_id TEXT NOT NULL,
        status TEXT NOT NULL,
        completed_months INTEGER NOT NULL DEFAULT 0,
        total_months INTEGER NOT NULL DEFAULT 0,
        response_json TEXT,
        response_status INTEGER NOT NULL DEFAULT 200,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        step INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        state_hash TEXT NOT NULL,
        session_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(run_id, step)
      );
      CREATE TABLE IF NOT EXISTS audit_records (
        record_id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS audit_records_by_run ON audit_records(run_id, sequence);
      CREATE TRIGGER IF NOT EXISTS audit_records_no_update BEFORE UPDATE ON audit_records
        BEGIN SELECT RAISE(ABORT, 'audit records are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_records_no_delete BEFORE DELETE ON audit_records
        BEGIN SELECT RAISE(ABORT, 'audit records are append-only'); END;
    `);
    const commandColumns = this.db.prepare('PRAGMA table_info(commands)').all() as Array<{ name: string }>;
    if (!commandColumns.some((column) => column.name === 'response_status')) {
      this.db.exec('ALTER TABLE commands ADD COLUMN response_status INTEGER NOT NULL DEFAULT 200');
    }
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)').run(nowIso());
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)').run(nowIso());
  }

  createRun(runId: string, session: PlayerSessionState, manifest: RunManifest) {
    const timestamp = nowIso();
    const sessionJson = encodePlayerSessionState(session);
    const insert = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO runs(run_id,status,revision,engine_version,session_json,manifest_json,created_at,updated_at,stop_reason)
        VALUES(?,?,?,?,?,?,?,?,NULL)`).run(runId, session.status, session.revision, manifest.engineVersion, sessionJson, json(manifest), timestamp, timestamp);
      this.db.prepare(`INSERT INTO checkpoints(run_id,step,revision,state_hash,session_json,created_at) VALUES(?,?,?,?,?,?)`)
        .run(runId, session.bankState.time.step, session.revision, hashBankState(session.bankState), sessionJson, timestamp);
      this.appendAuditRecord(runId, 'run_created', { manifest, openingStep: session.bankState.time.step }, timestamp);
    });
    insert();
  }

  getRun(runId: string): StoredRun | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      runId: String(row.run_id),
      status: String(row.status),
      revision: Number(row.revision),
      engineVersion: String(row.engine_version),
      sessionJson: String(row.session_json),
      manifest: JSON.parse(String(row.manifest_json)) as RunManifest,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      stopReason: row.stop_reason === null ? null : String(row.stop_reason),
    };
  }

  getSession(runId: string): PlayerSessionState | undefined {
    const run = this.getRun(runId);
    return run ? decodePlayerSessionState(run.sessionJson) : undefined;
  }

  createCredential(credentialId: string, runId: string, tokenHash: string, scopes: string[]) {
    const timestamp = nowIso();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO player_credentials(credential_id,run_id,token_hash,scopes_json,created_at) VALUES(?,?,?,?,?)')
        .run(credentialId, runId, tokenHash, json(scopes), timestamp);
      this.appendAuditRecord(runId, 'player_credential_issued', { credentialId, scopes }, timestamp);
    })();
  }

  resolveCredential(tokenHash: string): { credentialId: string; runId: string; scopes: string[] } | undefined {
    const row = this.db.prepare('SELECT credential_id,run_id,scopes_json FROM player_credentials WHERE token_hash = ? AND revoked_at IS NULL').get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return { credentialId: String(row.credential_id), runId: String(row.run_id), scopes: JSON.parse(String(row.scopes_json)) as string[] };
  }

  revokeCredential(runId: string, credentialId: string): boolean {
    const timestamp = nowIso();
    return this.db.transaction(() => {
      const result = this.db.prepare('UPDATE player_credentials SET revoked_at = ? WHERE run_id = ? AND credential_id = ? AND revoked_at IS NULL')
        .run(timestamp, runId, credentialId);
      if (result.changes > 0) this.appendAuditRecord(runId, 'player_credential_revoked', { credentialId }, timestamp);
      return result.changes > 0;
    })();
  }

  listCredentials(runId: string) {
    return this.db.prepare('SELECT credential_id, scopes_json, created_at, revoked_at FROM player_credentials WHERE run_id = ? ORDER BY created_at')
      .all(runId).map((raw) => {
        const row = raw as Record<string, unknown>;
        return { credentialId: String(row.credential_id), scopes: JSON.parse(String(row.scopes_json)) as string[], createdAt: String(row.created_at), revokedAt: row.revoked_at === null ? null : String(row.revoked_at) };
      });
  }

  hasActiveRunsOnOtherBuild(engineVersion: string, buildDigest: string, dependencyLockHash: string, nodeVersion = process.version): boolean {
    const active = this.db.prepare("SELECT engine_version,manifest_json FROM runs WHERE status = 'active'").all() as Array<Record<string, unknown>>;
    return active.some((row) => {
      const manifest = JSON.parse(String(row.manifest_json)) as Partial<RunManifest>;
      return String(row.engine_version) !== engineVersion || manifest.buildDigest !== buildDigest ||
        manifest.dependencyLockHash !== dependencyLockHash || manifest.nodeVersion !== nodeVersion;
    });
  }

  getCommand(runId: string, commandId: string): StoredCommand | undefined {
    const raw = this.db.prepare('SELECT * FROM commands WHERE run_id = ? AND command_id = ?').get(runId, commandId) as Record<string, unknown> | undefined;
    if (!raw) return undefined;
    return {
      runId: String(raw.run_id), commandId: String(raw.command_id), bodyHash: String(raw.body_hash),
      requestJson: String(raw.request_json), requestId: String(raw.request_id), status: String(raw.status) as StoredCommand['status'],
      responseStatus: Number(raw.response_status ?? 200),
      completedMonths: Number(raw.completed_months), totalMonths: Number(raw.total_months),
      responseJson: raw.response_json === null ? null : String(raw.response_json),
    };
  }

  startCommand(args: { runId: string; commandId: string; bodyHash: string; requestJson: string; requestId: string; totalMonths: number }) {
    const timestamp = nowIso();
    const insert = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO commands(run_id,command_id,body_hash,request_json,request_id,status,completed_months,total_months,response_json,created_at,updated_at)
        VALUES(?,?,?,?,?,'running',0,?,NULL,?,?)`).run(args.runId, args.commandId, args.bodyHash, args.requestJson, args.requestId, args.totalMonths, timestamp, timestamp);
      this.appendAuditRecord(args.runId, 'command_started', { commandId: args.commandId, requestId: args.requestId, request: JSON.parse(args.requestJson) }, timestamp);
    });
    insert();
  }

  commitNewMutation(args: { runId: string; session?: PlayerSessionState; commandId: string; bodyHash: string; requestJson: string; requestId: string; response: unknown; responseStatus?: number; commandStatus: 'completed' | 'rejected'; request: unknown }) {
    const timestamp = nowIso();
    const responseJson = json(args.response);
    const sessionJson = args.session ? encodePlayerSessionState(args.session) : undefined;
    const commit = this.db.transaction(() => {
      if (args.session && sessionJson) {
        this.db.prepare('UPDATE runs SET status=?,revision=?,session_json=?,updated_at=?,stop_reason=? WHERE run_id=?')
          .run(args.session.status, args.session.revision, sessionJson, timestamp, args.session.stopReason ?? null, args.runId);
      }
      this.db.prepare(`INSERT INTO commands(run_id,command_id,body_hash,request_json,request_id,status,completed_months,total_months,response_json,response_status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,0,0,?,?,?,?)`)
        .run(args.runId, args.commandId, args.bodyHash, args.requestJson, args.requestId, args.commandStatus, responseJson, args.responseStatus ?? 200, timestamp, timestamp);
      this.appendAuditRecord(args.runId, 'command_completed', { commandId: args.commandId, request: args.request, response: args.response }, timestamp);
    });
    commit();
  }

  commitMonth(args: { runId: string; session: PlayerSessionState; commandId: string; completedMonths: number; audit: unknown }) {
    const timestamp = nowIso();
    const sessionJson = encodePlayerSessionState(args.session);
    const commit = this.db.transaction(() => {
      this.db.prepare('UPDATE runs SET status=?,revision=?,session_json=?,updated_at=?,stop_reason=? WHERE run_id=?')
        .run(args.session.status, args.session.revision, sessionJson, timestamp, args.session.stopReason ?? null, args.runId);
      this.db.prepare(`INSERT INTO checkpoints(run_id,step,revision,state_hash,session_json,created_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(run_id,step) DO UPDATE SET revision=excluded.revision,state_hash=excluded.state_hash,session_json=excluded.session_json,created_at=excluded.created_at`)
        .run(args.runId, args.session.bankState.time.step, args.session.revision, hashBankState(args.session.bankState), sessionJson, timestamp);
      this.db.prepare('UPDATE commands SET completed_months=?,updated_at=? WHERE run_id=? AND command_id=?')
        .run(args.completedMonths, timestamp, args.runId, args.commandId);
      this.appendAuditRecord(args.runId, 'month_closed', args.audit, timestamp);
    });
    commit();
  }

  finishAdvanceCommand(args: { runId: string; commandId: string; response: unknown; commandStatus: 'completed' | 'rejected'; responseStatus?: number; audit?: unknown }) {
    const timestamp = nowIso();
    const commit = this.db.transaction(() => {
      this.db.prepare('UPDATE commands SET status=?,response_json=?,response_status=?,updated_at=? WHERE run_id=? AND command_id=?')
        .run(args.commandStatus, json(args.response), args.responseStatus ?? 200, timestamp, args.runId, args.commandId);
      this.appendAuditRecord(args.runId, 'command_completed', args.audit ?? args.response, timestamp);
    });
    commit();
  }

  failAdvanceCommand(runId: string, commandId: string, session: PlayerSessionState, response: unknown) {
    const timestamp = nowIso();
    const sessionJson = encodePlayerSessionState(session);
    const commit = this.db.transaction(() => {
      this.db.prepare("UPDATE commands SET status='failed',response_json=?,response_status=500,updated_at=? WHERE run_id=? AND command_id=?")
        .run(json(response), timestamp, runId, commandId);
      this.db.prepare('UPDATE runs SET status=?,revision=?,session_json=?,stop_reason=?,updated_at=? WHERE run_id=?')
        .run(session.status, session.revision, sessionJson, session.stopReason ?? null, timestamp, runId);
      this.appendAuditRecord(runId, 'command_failed', { commandId, response }, timestamp);
    });
    commit();
  }

  markOwnerStopped(runId: string, session: PlayerSessionState, reason: string) {
    const timestamp = nowIso();
    const sessionJson = encodePlayerSessionState(session);
    const commit = this.db.transaction(() => {
      this.db.prepare('UPDATE runs SET status=?,revision=?,session_json=?,updated_at=?,stop_reason=? WHERE run_id=?')
        .run(session.status, session.revision, sessionJson, timestamp, session.stopReason ?? null, runId);
      this.appendAuditRecord(runId, 'owner_stopped', { reason }, timestamp);
    });
    commit();
  }

  appendReadAudit(runId: string, request: unknown, response: unknown) {
    this.appendAuditRecord(runId, 'player_read', { request, response });
  }

  recordAudit(runId: string, kind: string, payload: unknown) {
    this.appendAuditRecord(runId, kind, payload);
  }

  private appendAuditRecord(runId: string, kind: string, payload: unknown, timestamp = nowIso()) {
    const next = this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM audit_records WHERE run_id=?').get(runId) as { next: number };
    this.db.prepare('INSERT INTO audit_records(run_id,sequence,kind,payload_json,created_at) VALUES(?,?,?,?,?)')
      .run(runId, next.next, kind, json(payload), timestamp);
  }

  pendingAdvanceCommands(): StoredCommand[] {
    return (this.db.prepare("SELECT * FROM commands WHERE status='running' ORDER BY created_at").all() as Record<string, unknown>[]).map((raw) => ({
      runId: String(raw.run_id), commandId: String(raw.command_id), bodyHash: String(raw.body_hash),
      requestJson: String(raw.request_json), requestId: String(raw.request_id), status: 'running',
      responseStatus: 200,
      completedMonths: Number(raw.completed_months), totalMonths: Number(raw.total_months), responseJson: null,
    }));
  }

  listCheckpoints(runId: string) {
    return this.db.prepare('SELECT step,revision,state_hash,session_json,created_at FROM checkpoints WHERE run_id=? ORDER BY step').all(runId) as Array<Record<string, unknown>>;
  }

  listAuditRecords(runId: string) {
    return this.db.prepare('SELECT sequence,kind,payload_json,created_at FROM audit_records WHERE run_id=? ORDER BY sequence').all(runId).map((raw) => {
      const row = raw as Record<string, unknown>;
      return { sequence: Number(row.sequence), kind: String(row.kind), payload: JSON.parse(String(row.payload_json)) as unknown, createdAt: String(row.created_at) };
    });
  }

  listCommands(runId: string) {
    return this.db.prepare('SELECT command_id,body_hash,request_json,request_id,status,completed_months,total_months,response_json,response_status,created_at,updated_at FROM commands WHERE run_id=? ORDER BY created_at,command_id').all(runId).map((raw) => {
      const row = raw as Record<string, unknown>;
      return { commandId: String(row.command_id), bodyHash: String(row.body_hash), request: JSON.parse(String(row.request_json)) as unknown,
        requestId: String(row.request_id), status: String(row.status), responseStatus: Number(row.response_status ?? 200), completedMonths: Number(row.completed_months), totalMonths: Number(row.total_months),
        response: row.response_json === null ? null : JSON.parse(String(row.response_json)) as unknown, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
    });
  }

  close() {
    this.db.close();
  }
}
