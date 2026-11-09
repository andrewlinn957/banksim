import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';

const repository = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'banksim-client-smoke-'));
const workDirectory = join(temporary, 'clean-work');
const adminToken = 'local-clean-smoke-admin-token-23456789-abcdefgh';

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};

const allowedPorts = () => {
  try {
    const args = readFileSync('/proc/1/cmdline', 'utf8').split('\0');
    const index = args.indexOf('--managed-network');
    if (index < 0) return [];
    return JSON.parse(args[index + 1]).loopbackPorts ?? [];
  } catch {
    return [];
  }
};

const startServer = async (port) => {
  const databasePath = join(temporary, 'server.sqlite3');
  const child = spawn(process.execPath, [resolve(repository, 'dist-server/server.js')], {
    cwd: repository,
    env: {
      ...process.env,
      BANKSIM_ADMIN_TOKEN: adminToken,
      BANKSIM_ENGINE_VERSION: 'clean-client-smoke-v1',
      BANKSIM_DATABASE_PATH: databasePath,
      BANKSIM_HOST: '127.0.0.1',
      BANKSIM_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  try {
    const actualPort = port || await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server did not announce its ephemeral port: ${output}`)), 10_000);
      const findPort = () => {
        const match = output.match(/Server listening at http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolvePort(Number(match[1])); }
        else if (child.exitCode !== null) { clearTimeout(timer); reject(new Error(`Server exited before listening: ${output}`)); }
      };
      child.stdout.on('data', findPort);
      child.stderr.on('data', findPort);
      findPort();
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited during startup: ${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${actualPort}/health`);
        if (response.ok) { ready = true; break; }
      } catch {}
      await delay(100);
    }
    if (!ready) throw new Error(`Server readiness timed out: ${output}`);
    return { child, port: actualPort, output: () => output };
  } catch (error) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolveExit) => child.once('exit', resolveExit));
    }
    throw error;
  }
};

let server;
try {
  const ports = allowedPorts();
  server = await startServer(ports[0] ?? 0);
  runCommand('npm', ['pack', './evaluation-client', '--pack-destination', temporary], { cwd: repository });
  const producedTarball = join(temporary, 'banksim-evaluation-client-0.1.0.tgz');
  const archiveList = runCommand('tar', ['-tzf', producedTarball], { cwd: repository });
  if (/src\/engine|src\/config\/scenarios|server\/|private-scenario|audit-export/i.test(archiveList)) {
    throw new Error(`Clean client tarball contains a forbidden path:\n${archiveList}`);
  }
  runCommand('npm', ['install', '--prefix', workDirectory, producedTarball, '--omit=dev', '--no-audit', '--no-fund'], { cwd: temporary });

  const baseUrl = `http://127.0.0.1:${server.port}`;
  const adminHeaders = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
  const createdResponse = await fetch(`${baseUrl}/admin/v1/runs`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({
      engineVersion: 'clean-client-smoke-v1', scenarioId: null, seed: 20261108,
      horizonMonths: 1, limits: { maxModelTurns: 10, maxToolCalls: 20 },
    }),
  });
  const created = await createdResponse.json();
  if (!createdResponse.ok) throw new Error(`Run creation failed (${createdResponse.status}): ${JSON.stringify(created)}`);
  const tokenResponse = await fetch(`${baseUrl}/admin/v1/runs/${encodeURIComponent(created.runId)}/credentials`, {
    method: 'POST', headers: adminHeaders, body: '{}',
  });
  const credential = await tokenResponse.json();
  if (!tokenResponse.ok) throw new Error(`Player token issuance failed (${tokenResponse.status}): ${JSON.stringify(credential)}`);

  const promptDirectory = join(workDirectory, 'prompts');
  const outputDirectory = join(workDirectory, 'results');
  const installedPackage = resolve(workDirectory, 'node_modules/banksim-evaluation-client');
  const cli = resolve(workDirectory, 'node_modules/.bin/banksim-eval');
  if (!runCommand(cli, ['--help'], { cwd: workDirectory }).includes('banksim-eval run')) throw new Error('Installed client bin is not executable or does not expose its CLI.');
  const configPath = join(workDirectory, 'config.json');
  const promptPath = join(promptDirectory, 'task.md');
  mkdirSync(promptDirectory, { recursive: true });
  writeFileSync(promptPath, 'Review the bank condition, make a prudent decision, and close one month.');
  writeFileSync(configPath, JSON.stringify({
    serverUrl: baseUrl,
    runId: created.runId,
    playerTokenEnv: 'BANKSIM_PLAYER_TOKEN',
    provider: { adapter: 'mock', model: 'banksim-mock-v1' },
    promptFile: './prompts/task.md',
    limits: { maxModelTurns: 10, maxToolCalls: 20, maxNoProgressTurns: 4 },
    outputDirectory: './results',
  }, null, 2));
  const client = await new Promise((resolveClient, reject) => {
    const child = spawn(cli, ['run', configPath], {
      cwd: workDirectory,
      env: { ...process.env, BANKSIM_PLAYER_TOKEN: credential.token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolveClient({ code, stdout, stderr }));
  });
  if (client.code !== 0) throw new Error(`Clean-installed client failed (${client.code}):\n${client.stdout}\n${client.stderr}\nServer:\n${server.output()}`);

  const runDirectory = join(outputDirectory, created.runId);
  const summary = JSON.parse(readFileSync(join(runDirectory, 'client-run.json'), 'utf8'));
  const transcript = readFileSync(join(runDirectory, 'transcript.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const playerExport = JSON.parse(readFileSync(join(runDirectory, 'player-export.json'), 'utf8'));
  const start = transcript.find((event) => event.type === 'client_run_started');
  const toolNames = start.toolDefinitions.map((tool) => tool.function.name);
  if (summary.terminalReason !== 'horizon_reached' || summary.simulationStep !== 1) throw new Error(`Unexpected client result: ${JSON.stringify(summary)}`);
  if (summary.assignedLimits?.maxModelTurns !== 10 || summary.assignedLimits?.maxToolCalls !== 20) throw new Error('Client did not retain the administrator-assigned budgets.');
  if (!playerExport || !toolNames.includes('advance_time') || toolNames.some((name) => /admin/i.test(name))) throw new Error('Player export or player-only tool assertion failed.');
  if (!transcript.some((event) => event.type === 'model_request') || !transcript.some((event) => event.type === 'model_response')) throw new Error('Model inputs and response were not both recorded.');
  if (JSON.stringify(transcript).includes(credential.token) || JSON.stringify(transcript).includes(adminToken)) throw new Error('A credential appeared in the client transcript.');
  const joinedBundlePath = join(temporary, `${created.runId}.joined.json`);
  runCommand(process.execPath, ['--import', 'tsx', 'scripts/collect-audit.ts', baseUrl, created.runId, runDirectory, joinedBundlePath], {
    cwd: repository, env: { ...process.env, BANKSIM_ADMIN_TOKEN: adminToken },
  });
  const replayVerification = JSON.parse(runCommand(process.execPath, ['--import', 'tsx', 'scripts/verify-audit.ts', joinedBundlePath], { cwd: repository }));
  if (!replayVerification.verified || !replayVerification.replay.replayed || replayVerification.client.recordCount !== transcript.length) {
    throw new Error(`Joined audit bundle did not pass integrity/replay verification: ${JSON.stringify(replayVerification)}`);
  }
  const sampleBundlePath = process.env.BANKSIM_SAMPLE_BUNDLE_PATH;
  if (sampleBundlePath) {
    const resolvedSamplePath = resolve(sampleBundlePath);
    mkdirSync(dirname(resolvedSamplePath), { recursive: true });
    writeFileSync(resolvedSamplePath, gzipSync(readFileSync(joinedBundlePath)), { mode: 0o644 });
  }

  const cappedRunResponse = await fetch(`${baseUrl}/admin/v1/runs`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({
      engineVersion: 'clean-client-smoke-v1', scenarioId: null, seed: 20261109,
      horizonMonths: 1, limits: { maxModelTurns: 1, maxToolCalls: 1 },
    }),
  });
  const cappedRun = await cappedRunResponse.json();
  if (!cappedRunResponse.ok) throw new Error(`Capped run creation failed (${cappedRunResponse.status}): ${JSON.stringify(cappedRun)}`);
  const cappedTokenResponse = await fetch(`${baseUrl}/admin/v1/runs/${encodeURIComponent(cappedRun.runId)}/credentials`, {
    method: 'POST', headers: adminHeaders, body: '{}',
  });
  const cappedCredential = await cappedTokenResponse.json();
  if (!cappedTokenResponse.ok) throw new Error(`Capped run token issuance failed (${cappedTokenResponse.status}): ${JSON.stringify(cappedCredential)}`);
  const cappedDirectory = join(temporary, 'budget-case');
  const cappedPromptDirectory = join(cappedDirectory, 'prompts');
  mkdirSync(cappedPromptDirectory, { recursive: true });
  writeFileSync(join(cappedPromptDirectory, 'task.md'), 'Try a short task.');
  const cappedConfig = join(cappedDirectory, 'config.json');
  writeFileSync(cappedConfig, JSON.stringify({
    serverUrl: baseUrl, runId: cappedRun.runId, playerTokenEnv: 'BANKSIM_PLAYER_TOKEN',
    provider: { adapter: 'mock', model: 'banksim-mock-v1' }, promptFile: './prompts/task.md',
    limits: { maxModelTurns: 2, maxToolCalls: 2, maxNoProgressTurns: 2 }, outputDirectory: './results',
  }));
  const overBudget = await new Promise((resolveClient, reject) => {
    const child = spawn(cli, ['run', cappedConfig], {
      cwd: cappedDirectory,
      env: { ...process.env, BANKSIM_PLAYER_TOKEN: cappedCredential.token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolveClient({ code, stdout, stderr }));
  });
  if (overBudget.code === 0 || !overBudget.stderr.includes('Local limits exceed the run')) {
    throw new Error(`Client did not refuse a local budget above the assigned limit: ${JSON.stringify(overBudget)}`);
  }

  const recoveryRunResponse = await fetch(`${baseUrl}/admin/v1/runs`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({
      engineVersion: 'clean-client-smoke-v1', scenarioId: null, seed: 20261110,
      horizonMonths: 1, limits: { maxModelTurns: 10, maxToolCalls: 20 },
    }),
  });
  const recoveryRun = await recoveryRunResponse.json();
  if (!recoveryRunResponse.ok) throw new Error(`Recovery run creation failed (${recoveryRunResponse.status}): ${JSON.stringify(recoveryRun)}`);
  const recoveryTokenResponse = await fetch(`${baseUrl}/admin/v1/runs/${encodeURIComponent(recoveryRun.runId)}/credentials`, {
    method: 'POST', headers: adminHeaders, body: '{}',
  });
  const recoveryCredential = await recoveryTokenResponse.json();
  if (!recoveryTokenResponse.ok) throw new Error(`Recovery player token issuance failed (${recoveryTokenResponse.status}): ${JSON.stringify(recoveryCredential)}`);
  const recoveryDirectory = join(temporary, 'recovery-case');
  const recoveryPromptDirectory = join(recoveryDirectory, 'prompts');
  mkdirSync(recoveryPromptDirectory, { recursive: true });
  writeFileSync(join(recoveryPromptDirectory, 'task.md'), 'Make a decision and close one month.');
  const recoveryConfig = join(recoveryDirectory, 'config.json');
  writeFileSync(recoveryConfig, JSON.stringify({
    serverUrl: baseUrl, runId: recoveryRun.runId, playerTokenEnv: 'BANKSIM_PLAYER_TOKEN',
    provider: { adapter: 'mock', model: 'banksim-mock-v1' }, promptFile: './prompts/task.md',
    limits: { maxModelTurns: 10, maxToolCalls: 20, maxNoProgressTurns: 4 }, outputDirectory: './results',
  }));
  const dropResponseModule = join(temporary, 'drop-response.mjs');
  writeFileSync(dropResponseModule, `
const originalFetch = globalThis.fetch;
let dropped = false;
globalThis.fetch = async (input, init = {}) => {
  const response = await originalFetch(input, init);
  if (!dropped && init.method === 'POST' && String(input).includes('/api/v1/runs/') && String(input).endsWith('/commands')) {
    dropped = true;
    await response.arrayBuffer();
    throw new TypeError('Injected lost response after server commit');
  }
  return response;
};
`);
  const invokeRecoveryClient = (action, injectDrop) => new Promise((resolveClient, reject) => {
    const child = spawn(cli, [action, recoveryConfig], {
      cwd: recoveryDirectory,
      env: {
        ...process.env,
        BANKSIM_PLAYER_TOKEN: recoveryCredential.token,
        ...(injectDrop ? { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${dropResponseModule}`.trim() } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolveClient({ code, stdout, stderr }));
  });
  const interrupted = await invokeRecoveryClient('run', true);
  if (interrupted.code !== 2) throw new Error(`Lost-response attempt should stop as interrupted, got ${JSON.stringify(interrupted)}`);
  const recoveryDirectoryForRun = join(recoveryDirectory, 'results', recoveryRun.runId);
  const interruptedState = JSON.parse(readFileSync(join(recoveryDirectoryForRun, 'client-state.json'), 'utf8'));
  const uncertainCommandId = interruptedState.outstandingCommand?.commandId;
  if (!uncertainCommandId) throw new Error('Lost response did not leave a reconcilable command ID.');
  const resumed = await invokeRecoveryClient('resume', false);
  if (resumed.code !== 0) throw new Error(`Resume failed after a committed command response was lost: ${JSON.stringify(resumed)}`);
  const resumedSummary = JSON.parse(readFileSync(join(recoveryDirectoryForRun, 'client-run.json'), 'utf8'));
  const auditResponse = await fetch(`${baseUrl}/admin/v1/runs/${encodeURIComponent(recoveryRun.runId)}/export`, { headers: adminHeaders });
  const audit = await auditResponse.json();
  const commandRows = audit.commands.filter((command) => command.commandId === uncertainCommandId);
  if (!auditResponse.ok || commandRows.length !== 1 || resumedSummary.terminalReason !== 'horizon_reached') {
    throw new Error(`Command response reconciliation was not exactly-once: ${JSON.stringify({ status: auditResponse.status, commandRows: commandRows.length, resumedSummary })}`);
  }
  process.stdout.write(JSON.stringify({
    packageFiles: archiveList.trim().split('\n').length,
    terminalReason: summary.terminalReason,
    simulationStep: summary.simulationStep,
    modelTurns: summary.modelTurns,
    toolCalls: summary.toolCalls,
    transcriptEvents: transcript.length,
    transcriptGaps: summary.transcriptGaps.length,
    playerExportSaved: true,
    joinedAuditVerified: true,
    replayMatchedSteps: replayVerification.replay.matchedSteps,
    ...(sampleBundlePath ? { sampleBundle: resolve(sampleBundlePath) } : {}),
    assignedLimits: summary.assignedLimits,
    assignedBudgetCapRejected: true,
    lostCommandResponseRecoveredExactlyOnce: true,
    cleanDirectory: true,
  }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  if (server) process.stderr.write(`Server output:\n${server.output()}\n`);
  process.exitCode = 1;
} finally {
  if (server?.child && server.child.exitCode === null) {
    server.child.kill('SIGTERM');
    await new Promise((resolveExit) => server.child.once('exit', resolveExit));
  }
  rmSync(temporary, { recursive: true, force: true });
}
