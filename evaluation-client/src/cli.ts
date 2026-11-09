#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { loadClientConfig, parseClientConfig } from './config.js';
import { createProvider } from './providers.js';
import { EvaluationRunner, CLIENT_VERSION } from './runner.js';
import { openRunFiles, readRunState } from './state.js';

const usage = `BankSim evaluation client ${CLIENT_VERSION}

Usage:
  banksim-eval run <config.json>
  banksim-eval resume <config.json>
  banksim-eval inspect <config.json>
  banksim-eval collect <config.json>
  banksim-eval batch <config.json>...

run creates a new local attempt for an owner-created run.
resume reconciles saved command IDs and continues an interrupted attempt.
inspect reads the local result and does not need API credentials.
collect downloads the player export for an existing attempt.
batch runs owner-created configs sequentially and retains each result.
`;

const exitStatus = (reason: string | null): number => {
  if (reason === 'model_finished' || reason === 'horizon_reached' || reason === 'bank_failure' || reason === 'owner_stopped') return 0;
  return reason ? 2 : 0;
};

const printSummary = (state: ReturnType<EvaluationRunner['getState']>): void => {
  process.stdout.write(`${JSON.stringify({
    runId: state.runId,
    terminalReason: state.terminalReason,
    serverStatus: state.serverStatus,
    simulationStep: state.simulationStep,
    revision: state.revision,
    modelTurns: state.modelTurns,
    toolCalls: state.toolCalls,
    transcriptGaps: state.transcriptGaps.length,
    outputDirectory: state.config.outputDirectory,
  }, null, 2)}\n`);
};

const readLocalState = (configPath: string) => {
  const absolutePath = resolve(configPath);
  const source = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  const config = parseClientConfig(source);
  const outputPath = isAbsolute(config.outputDirectory)
    ? config.outputDirectory
    : resolve(dirname(absolutePath), config.outputDirectory);
  const files = openRunFiles(outputPath, config.runId, true);
  return { files, state: readRunState(files) };
};

const execute = async (command: string, configPath: string): Promise<number> => {
  if (command === 'inspect') {
    const { state } = readLocalState(configPath);
    printSummary(state);
    return exitStatus(state.terminalReason);
  }

  const loaded = loadClientConfig(configPath, process.env, { requireModelApiKey: command !== 'collect' });
  if (command === 'collect') {
    const runner = EvaluationRunner.attach(loaded, {
      adapter: 'offline-export-collector',
      complete: async () => { throw new Error('Provider must not be called for export collection'); },
    }, { verifyPrompt: false });
    await runner.collectPlayerExport();
    process.stdout.write(`Saved player export to ${runner.files.exportFile}\n`);
    return 0;
  }
  const provider = createProvider({
    adapter: loaded.config.provider.adapter,
    ...(loaded.config.provider.baseUrl ? { baseUrl: loaded.config.provider.baseUrl } : {}),
    ...(loaded.modelApiKey ? { apiKey: loaded.modelApiKey } : {}),
  });

  const runner = command === 'resume'
    ? await EvaluationRunner.resume(loaded, provider)
    : await EvaluationRunner.start(loaded, provider);
  const onInterrupt = () => runner.requestStop();
  process.on('SIGINT', onInterrupt);
  try {
    const state = await runner.run();
    try {
      await runner.collectPlayerExport();
    } catch (error) {
      process.stderr.write(`Player export collection failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    }
    printSummary(state);
    return exitStatus(state.terminalReason);
  } finally {
    process.off('SIGINT', onInterrupt);
  }
};

const main = async (): Promise<void> => {
  const [, , command, configPath] = process.argv;
  if (command === '--help' || command === '-h' || command === undefined) {
    process.stdout.write(usage);
    return;
  }
  if (command === 'batch') {
    const configs = process.argv.slice(3);
    if (configs.length === 0 || configs.some((path) => path.startsWith('-'))) {
      process.stderr.write(usage);
      process.exitCode = 64;
      return;
    }
    let failure = false;
    for (const path of configs) {
      process.stdout.write(`Starting configured run from ${path}\n`);
      try {
        if (await execute('run', path) !== 0) failure = true;
      } catch (error) {
        failure = true;
        process.stderr.write(`${path}: ${error instanceof Error ? error.message : 'BankSim evaluation client failed'}\n`);
      }
    }
    process.exitCode = failure ? 2 : 0;
    return;
  }
  if (!['run', 'resume', 'inspect', 'collect'].includes(command) || !configPath || configPath.startsWith('-')) {
    process.stderr.write(usage);
    process.exitCode = 64;
    return;
  }
  try {
    process.exitCode = await execute(command, configPath);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'BankSim evaluation client failed'}\n`);
    process.exitCode = 1;
  }
};

await main();
