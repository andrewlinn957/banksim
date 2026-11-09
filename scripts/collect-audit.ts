import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  createJoinedAuditBundle,
  parseClientTranscript,
  verifyJoinedAuditBundle,
  type ClientAuditSource,
  type ServerAuditExport,
} from '../server/auditBundle';

const usage = 'Usage: npm run audit:collect -- <server-url> <run-id> <client-run-directory|-> <output.json>';
const [, , serverUrlArg, runId, clientDirectoryArg, outputArg] = process.argv;
if (!serverUrlArg || !runId || !clientDirectoryArg || !outputArg) throw new Error(usage);

const adminToken = process.env.BANKSIM_ADMIN_TOKEN?.trim();
if (!adminToken || adminToken.length < 32) throw new Error('BANKSIM_ADMIN_TOKEN must contain the owner administration token (at least 32 characters)');

const baseUrl = new URL(serverUrlArg);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
if (!['https:', ...(localHosts.has(baseUrl.hostname) ? ['http:'] : [])].includes(baseUrl.protocol)) {
  throw new Error('Audit collection requires HTTPS except for a local loopback server');
}
if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error('Server URL must not contain credentials, a query or a fragment');
const exportUrl = new URL(`/admin/v1/runs/${encodeURIComponent(runId)}/export`, baseUrl);
const response = await fetch(exportUrl, {
  headers: { authorization: `Bearer ${adminToken}`, accept: 'application/json' },
  redirect: 'error', signal: AbortSignal.timeout(120_000),
});
const responseText = await response.text();
if (!response.ok) throw new Error(`Administrator export failed with HTTP ${response.status}: ${responseText.slice(0, 1000)}`);
let server: ServerAuditExport;
try { server = JSON.parse(responseText) as ServerAuditExport; }
catch { throw new Error('Administrator export returned invalid JSON'); }
if (server.bundleVersion !== 2 || (server.run as { runId?: string } | undefined)?.runId !== runId) {
  throw new Error('Administrator export is for a different run or unsupported bundle version');
}

const optionalJson = (path: string): unknown | undefined => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as unknown : undefined;
const client: ClientAuditSource = { rawTranscript: null, records: [], note: 'No client run directory was supplied.' };
if (clientDirectoryArg !== '-') {
  const directory = resolve(clientDirectoryArg);
  const transcriptPath = resolve(directory, 'transcript.jsonl');
  const statePath = resolve(directory, 'client-state.json');
  const summaryPath = resolve(directory, 'client-run.json');
  const playerExportPath = resolve(directory, 'player-export.json');
  if (existsSync(transcriptPath)) {
    client.rawTranscript = readFileSync(transcriptPath, 'utf8');
    const parsed = parseClientTranscript(client.rawTranscript);
    client.records = parsed.records;
    client.transcriptParseErrors = parsed.errors;
  }
  client.runState = optionalJson(statePath);
  client.runSummary = optionalJson(summaryPath);
  client.playerExport = optionalJson(playerExportPath);
  client.note = client.rawTranscript === null
    ? 'Client run directory was supplied, but its transcript.jsonl is missing.'
    : 'Client-side model/provider records are harness provenance; the raw JSONL is preserved byte-for-byte.';
}

const bundle = createJoinedAuditBundle({ server, client });
bundle.verification = verifyJoinedAuditBundle(bundle);
const outputPath = resolve(outputArg);
mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
renameSync(temporaryPath, outputPath);
process.stdout.write(`${JSON.stringify({
  outputPath,
  runId,
  clientTranscriptCompleteness: bundle.client.completeness,
  clientTranscriptRecords: bundle.client.records.length,
  replayed: bundle.verification.replay.replayed,
  matchedSteps: bundle.verification.replay.matchedSteps,
  firstDivergence: bundle.verification.replay.firstDivergence,
  integrityIssues: bundle.verification.integrityIssues,
}, null, 2)}\n`);
if (!bundle.verification.replay.replayed || bundle.verification.integrityIssues.length > 0) process.exitCode = 2;
