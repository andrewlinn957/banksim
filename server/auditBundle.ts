import { createHash } from 'node:crypto';
import { cloneBankState } from '../src/engine/clone';
import { decodePlayerSessionState } from '../src/application/sessionCodec';
import { SimulationController } from '../src/application/simulationController';
import { hashBankState, hashJson } from './store';

type JsonRecord = Record<string, unknown>;

export interface ServerAuditExport {
  requestId?: string;
  bundleVersion: number;
  manifest: unknown;
  run: unknown;
  openingSession: unknown;
  openingSessionCodec: string;
  currentSession: unknown;
  currentSessionCodec: string;
  checkpoints: Array<{
    step: number;
    revision: number;
    stateHash: string;
    sessionHash: string;
    sessionCodec: string;
    createdAt: string;
  }>;
  commands: unknown[];
  serverAudit: unknown[];
  integrity: JsonRecord;
}

export interface ClientAuditSource {
  rawTranscript: string | null;
  records: unknown[];
  transcriptParseErrors?: string[];
  runSummary?: unknown;
  runState?: unknown;
  playerExport?: unknown;
  note?: string;
}

export interface JoinedAuditBundle {
  format: 'banksim-joined-audit';
  formatVersion: 1;
  collectedAt: string;
  server: ServerAuditExport;
  client: {
    completeness: 'complete' | 'partial-with-gaps' | 'incomplete' | 'missing-client-transcript';
    records: unknown[];
    rawTranscript: string | null;
    transcriptParseErrors: string[];
    runSummary: unknown | null;
    runState: unknown | null;
    playerExport: unknown | null;
    note: string;
    integrity: JsonRecord;
  };
  joinIntegrity: JsonRecord;
  verification?: AuditBundleVerification;
}

export interface AuditBundleVerification {
  verified: boolean;
  integrityIssues: string[];
  replay: {
    replayed: boolean;
    matchedSteps: number;
    firstDivergence: { step: number; expected: string | null; actual: string; reason: string } | null;
    finalStateHash: string | null;
  };
  client: { transcriptPresent: boolean; transcriptHashValid: boolean; recordCount: number; completeness: string };
}

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const jsonSafe = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const hashJsonSafe = (value: unknown): string => hashJson(value === undefined ? { auditUndefinedValue: true } : jsonSafe(value));

const checkpointIndex = (checkpoints: ServerAuditExport['checkpoints']) => checkpoints.map((checkpoint) => ({
  step: checkpoint.step,
  revision: checkpoint.revision,
  stateHash: checkpoint.stateHash,
  sessionHash: checkpoint.sessionHash,
  createdAt: checkpoint.createdAt,
}));

export const createServerAuditIntegrity = (args: {
  manifest: unknown;
  run: unknown;
  openingSession: unknown;
  currentSession: unknown;
  checkpoints: ServerAuditExport['checkpoints'];
  commands: unknown[];
  serverAudit: unknown[];
  finalStateHash: string;
}) => ({
  algorithm: 'sha256',
  checkpointCount: args.checkpoints.length,
  manifestHash: hashJsonSafe(args.manifest),
  runHash: hashJsonSafe(args.run),
  openingSessionHash: hashJsonSafe(args.openingSession),
  currentSessionHash: hashJsonSafe(args.currentSession),
  checkpointsHash: hashJsonSafe(checkpointIndex(args.checkpoints)),
  commandsHash: hashJsonSafe(args.commands),
  serverAuditHash: hashJsonSafe(args.serverAudit),
  finalStateHash: args.finalStateHash,
  schemaVersions: { bundle: 2, session: 1, command: 1, audit: 1, checkpoint: 1 },
});

export const parseClientTranscript = (raw: string | null): { records: unknown[]; errors: string[] } => {
  if (raw === null) return { records: [], errors: [] };
  const records: unknown[] = [];
  const errors: string[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (line.length === 0) continue;
    let record: unknown;
    try { record = JSON.parse(line) as unknown; }
    catch { errors.push(`Line ${index + 1} is not valid JSON`); continue; }
    if (!isRecord(record) || typeof record.type !== 'string' || typeof record.eventId !== 'string') {
      errors.push(`Line ${index + 1} is missing its event type or ID`);
      continue;
    }
    records.push(record);
  }
  return { records, errors };
};

export const createJoinedAuditBundle = (args: {
  server: ServerAuditExport;
  client: ClientAuditSource;
  collectedAt?: string;
}): JoinedAuditBundle => {
  if (args.server.bundleVersion !== 2) throw new Error('Unsupported server audit bundle version');
  const parsedTranscript = args.client.rawTranscript !== null && args.client.records.length === 0
    ? parseClientTranscript(args.client.rawTranscript)
    : { records: args.client.records, errors: args.client.transcriptParseErrors ?? [] };
  const records = parsedTranscript.records;
  const transcriptParseErrors = parsedTranscript.errors;
  const state = isRecord(args.client.runState) ? args.client.runState : undefined;
  const summary = isRecord(args.client.runSummary) ? args.client.runSummary : undefined;
  const runId = (args.server.run as JsonRecord | undefined)?.runId;
  if (state && state.runId !== runId) throw new Error('Client state run ID does not match server audit run ID');
  if (summary && summary.runId !== runId) throw new Error('Client summary run ID does not match server audit run ID');
  const transcriptPresent = args.client.rawTranscript !== null;
  const gaps = Array.isArray(state?.transcriptGaps) ? state.transcriptGaps : [];
  const terminal = state?.terminalReason;
  const completeness = !transcriptPresent
    ? 'missing-client-transcript'
    : gaps.length > 0 || transcriptParseErrors.length > 0
      ? 'partial-with-gaps'
      : typeof terminal === 'string' && terminal.length > 0
        ? 'complete'
        : 'incomplete';
  const clientIntegrity = {
    algorithm: 'sha256',
    rawTranscriptHash: args.client.rawTranscript === null ? null : sha256(args.client.rawTranscript),
    recordCount: records.length,
    recordsHash: hashJsonSafe(records),
    runSummaryHash: summary ? hashJsonSafe(summary) : null,
    runStateHash: state ? hashJsonSafe(state) : null,
    playerExportHash: args.client.playerExport === undefined ? null : hashJsonSafe(args.client.playerExport),
  };
  const client = {
    completeness,
    records,
    rawTranscript: args.client.rawTranscript,
    transcriptParseErrors,
    runSummary: args.client.runSummary ?? null,
    runState: args.client.runState ?? null,
    playerExport: args.client.playerExport ?? null,
    note: args.client.note ?? (transcriptPresent ? 'Client-side model/provider records are harness provenance.' : 'No client transcript was supplied; the missing segment is explicit.'),
    integrity: clientIntegrity,
  } as JoinedAuditBundle['client'];
  const joinIntegrity = {
    algorithm: 'sha256',
    serverBundleHash: hashJsonSafe(args.server),
    clientHash: hashJsonSafe(client),
  };
  return {
    format: 'banksim-joined-audit',
    formatVersion: 1,
    collectedAt: args.collectedAt ?? new Date().toISOString(),
    server: args.server,
    client,
    joinIntegrity,
  };
};

const addIntegrityIssue = (issues: string[], label: string, expected: unknown, actual: unknown): void => {
  if (expected !== actual) issues.push(`${label} hash mismatch`);
};

const decodeSession = (encoded: unknown, label: string, issues: string[]) => {
  if (typeof encoded !== 'string') {
    issues.push(`${label} session codec is missing`);
    return undefined;
  }
  try { return decodePlayerSessionState(encoded); }
  catch (error) {
    issues.push(`${label} session codec is invalid: ${error instanceof Error ? error.message : 'decode failed'}`);
    return undefined;
  }
};

const verifyServerIntegrity = (server: ServerAuditExport, issues: string[]) => {
  const integrity = server.integrity;
  if (server.bundleVersion !== 2 || integrity.algorithm !== 'sha256') issues.push('Unsupported server audit bundle or integrity version');
  addIntegrityIssue(issues, 'manifest', integrity.manifestHash, hashJsonSafe(server.manifest));
  addIntegrityIssue(issues, 'run', integrity.runHash, hashJsonSafe(server.run));
  addIntegrityIssue(issues, 'opening session', integrity.openingSessionHash, hashJsonSafe(server.openingSession));
  addIntegrityIssue(issues, 'current session', integrity.currentSessionHash, hashJsonSafe(server.currentSession));
  addIntegrityIssue(issues, 'checkpoints', integrity.checkpointsHash, hashJsonSafe(checkpointIndex(server.checkpoints)));
  addIntegrityIssue(issues, 'commands', integrity.commandsHash, hashJsonSafe(server.commands));
  addIntegrityIssue(issues, 'server audit', integrity.serverAuditHash, hashJsonSafe(server.serverAudit));
  if (integrity.checkpointCount !== server.checkpoints.length) issues.push('Checkpoint count mismatch');

  const opening = decodeSession(server.openingSessionCodec, 'Opening', issues);
  const current = decodeSession(server.currentSessionCodec, 'Current', issues);
  if (opening) {
    addIntegrityIssue(issues, 'opening session codec', hashJsonSafe(server.openingSession), hashJsonSafe(opening));
  }
  if (current) {
    addIntegrityIssue(issues, 'current session codec', hashJsonSafe(server.currentSession), hashJsonSafe(current));
    addIntegrityIssue(issues, 'final state', integrity.finalStateHash, hashBankState(current.bankState));
  }
  for (const checkpoint of server.checkpoints) {
    const decoded = decodeSession(checkpoint.sessionCodec, `Checkpoint ${checkpoint.step}`, issues);
    if (decoded) {
      addIntegrityIssue(issues, `checkpoint ${checkpoint.step} session`, checkpoint.sessionHash, hashJsonSafe(decoded));
      if (decoded.bankState.time.step !== checkpoint.step) issues.push(`Checkpoint ${checkpoint.step} session step mismatch`);
      addIntegrityIssue(issues, `checkpoint ${checkpoint.step} state`, checkpoint.stateHash, hashBankState(decoded.bankState));
    }
  }
  return { opening, current };
};

const verifyReplay = (
  server: ServerAuditExport,
  decoded: { opening?: ReturnType<typeof decodePlayerSessionState>; current?: ReturnType<typeof decodePlayerSessionState> },
) => {
  const empty = { replayed: false, matchedSteps: 0, firstDivergence: null, finalStateHash: null } as AuditBundleVerification['replay'];
  const opening = decoded.opening;
  const current = decoded.current;
  if (!opening || !current) return empty;
  const expectedByStep = new Map(server.checkpoints.map((checkpoint) => [checkpoint.step, checkpoint.stateHash]));
  const controller = new SimulationController(opening.config);
  let state = cloneBankState(opening.openingState);
  let matchedSteps = 0;
  let firstDivergence: AuditBundleVerification['replay']['firstDivergence'] = null;
  const openingHash = hashBankState(state);
  const expectedOpening = expectedByStep.get(state.time.step) ?? null;
  if (openingHash !== expectedOpening) firstDivergence = { step: state.time.step, expected: expectedOpening, actual: openingHash, reason: 'opening checkpoint mismatch' };
  else matchedSteps += 1;

  const monthlyAudit = server.serverAudit.filter((record): record is JsonRecord => isRecord(record) && record.kind === 'month_closed' && isRecord(record.payload));
  for (const [index, entry] of current.timeline.entries()) {
    if (firstDivergence) break;
    const auditPayload = isRecord(monthlyAudit[index]?.payload) ? monthlyAudit[index]!.payload as JsonRecord : undefined;
    if (auditPayload && hashJsonSafe(auditPayload.acceptedActions) !== hashJsonSafe(entry.actions)) {
      firstDivergence = { step: entry.step, expected: hashJsonSafe(auditPayload.acceptedActions), actual: hashJsonSafe(entry.actions), reason: 'recorded accepted actions differ from monthly audit' };
      break;
    }
    if (!auditPayload) {
      firstDivergence = { step: entry.step, expected: 'monthly audit record', actual: 'missing', reason: 'monthly close has no matching server audit record' };
      break;
    }
    state = cloneBankState(controller.step(state, entry.actions, entry.shocks, current.runId).nextState);
    const actual = hashBankState(state);
    const expected = expectedByStep.get(entry.step) ?? null;
    if (actual !== expected) firstDivergence = { step: entry.step, expected, actual, reason: 'replayed BankState differs from monthly checkpoint' };
    else matchedSteps += 1;
  }
  if (!firstDivergence && current.timeline.length !== server.checkpoints.length - 1) {
    firstDivergence = { step: state.time.step, expected: null, actual: hashBankState(state), reason: 'timeline and checkpoint counts differ' };
  }
  if (!firstDivergence && hashBankState(state) !== hashBankState(current.bankState)) {
    firstDivergence = { step: current.bankState.time.step, expected: hashBankState(current.bankState), actual: hashBankState(state), reason: 'replayed final state differs from current session' };
  }
  return { replayed: firstDivergence === null, matchedSteps, firstDivergence, finalStateHash: hashBankState(state) };
};

export const verifyJoinedAuditBundle = (bundle: JoinedAuditBundle): AuditBundleVerification => {
  const integrityIssues: string[] = [];
  if (bundle.format !== 'banksim-joined-audit' || bundle.formatVersion !== 1) integrityIssues.push('Unsupported joined audit bundle version');
  const decoded = verifyServerIntegrity(bundle.server, integrityIssues);
  addIntegrityIssue(integrityIssues, 'server bundle', bundle.joinIntegrity.serverBundleHash, hashJsonSafe(bundle.server));
  addIntegrityIssue(integrityIssues, 'joined client payload', bundle.joinIntegrity.clientHash, hashJsonSafe(bundle.client));
  addIntegrityIssue(integrityIssues, 'client records', bundle.client.integrity.recordsHash, hashJsonSafe(bundle.client.records));
  addIntegrityIssue(integrityIssues, 'client record count', bundle.client.integrity.recordCount, bundle.client.records.length);
  if (bundle.client.rawTranscript === null) {
    if (bundle.client.completeness !== 'missing-client-transcript') integrityIssues.push('Missing client transcript is not marked explicitly');
  } else {
    addIntegrityIssue(integrityIssues, 'client transcript', bundle.client.integrity.rawTranscriptHash, sha256(bundle.client.rawTranscript));
    try {
      const parsed = parseClientTranscript(bundle.client.rawTranscript);
      addIntegrityIssue(integrityIssues, 'client transcript records', bundle.client.integrity.recordsHash, hashJsonSafe(bundle.client.records));
      addIntegrityIssue(integrityIssues, 'client transcript record count', bundle.client.integrity.recordCount, bundle.client.records.length);
      if (hashJsonSafe(parsed.errors) !== hashJsonSafe(bundle.client.transcriptParseErrors)) integrityIssues.push('Client transcript parse-error inventory mismatch');
      if (parsed.errors.length > 0) integrityIssues.push('Client transcript contains incomplete or malformed records');
    } catch (error) {
      integrityIssues.push(error instanceof Error ? error.message : 'Client transcript parse failed');
    }
  }
  if (bundle.client.runState !== null) {
    addIntegrityIssue(integrityIssues, 'client run state', bundle.client.integrity.runStateHash, hashJsonSafe(bundle.client.runState));
    const clientRunId = isRecord(bundle.client.runState) ? bundle.client.runState.runId : undefined;
    const serverRunId = isRecord(bundle.server.run) ? bundle.server.run.runId : undefined;
    if (clientRunId !== serverRunId) integrityIssues.push('Client state run ID differs from server run ID');
    const prompt = isRecord(bundle.client.runState) && isRecord(bundle.client.runState.prompt) ? bundle.client.runState.prompt : undefined;
    if (prompt && typeof prompt.bytesBase64 === 'string' && typeof prompt.sha256 === 'string') {
      const promptHash = sha256(Buffer.from(prompt.bytesBase64, 'base64'));
      if (promptHash !== prompt.sha256) integrityIssues.push('Saved client prompt hash does not match its original bytes');
    }
  }
  if (bundle.client.runSummary !== null) addIntegrityIssue(integrityIssues, 'client summary', bundle.client.integrity.runSummaryHash, hashJsonSafe(bundle.client.runSummary));
  if (bundle.client.playerExport !== null) addIntegrityIssue(integrityIssues, 'player export', bundle.client.integrity.playerExportHash, hashJsonSafe(bundle.client.playerExport));
  const replay = verifyReplay(bundle.server, decoded);
  const transcriptPresent = bundle.client.rawTranscript !== null;
  const client = {
    transcriptPresent,
    transcriptHashValid: transcriptPresent && !integrityIssues.some((issue) => issue.startsWith('client transcript')),
    recordCount: bundle.client.records.length,
    completeness: bundle.client.completeness,
  };
  return { verified: integrityIssues.length === 0 && replay.replayed, integrityIssues, replay, client };
};
