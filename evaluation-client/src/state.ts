import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ChatMessage, ClientOutcome, FunctionToolDefinition, JsonObject, ProviderRequest, ProviderResponse, ToolCall } from './types.js';

export interface TranscriptGap {
  code: string;
  detail: string;
  at: string;
}

export interface PendingProviderRequest {
  turnId: string;
  turnNumber: number;
  messages: ChatMessage[];
  tools: FunctionToolDefinition[];
  startedAt: string;
  inputHash: string;
}

export interface PendingToolTurn {
  turnId: string;
  assistantMessage: ChatMessage;
  calls: ToolCall[];
  nextToolIndex: number;
  toolResponses: ChatMessage[];
  countedCallIds: string[];
  simulationStepAtStart: number;
}

export interface PendingCommand {
  commandId: string;
  body: Record<string, unknown>;
  toolCallId: string;
  toolName: string;
  toolIndex: number;
  turnId: string;
  responseStatus?: number;
  responseBody?: unknown;
}

export interface ClientRunState {
  format: 'banksim-client-run';
  formatVersion: 1;
  clientVersion: string;
  toolContractVersion?: string;
  reportContractVersion?: string;
  runId: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  terminalReason: string | null;
  serverStatus: string;
  simulationStep: number;
  revision: number;
  monthsRemaining: number | null;
  assignedLimits?: { maxModelTurns: number; maxToolCalls: number };
  config: Record<string, unknown>;
  prompt: { text: string; bytesBase64: string; sha256: string };
  systemInstructionVersion: string;
  messages: ChatMessage[];
  modelTurns: number;
  toolCalls: number;
  noProgressTurns: number;
  transcriptGaps: TranscriptGap[];
  providerModels: string[];
  usageRecords: Array<Record<string, unknown>>;
  latestControls?: Record<string, unknown>;
  reportCatalog?: Array<{ id: string; title: string; available: boolean; queryFields?: string[]; querySchema?: JsonObject }>;
  lastOverview?: Record<string, unknown>;
  pendingProviderRequest?: PendingProviderRequest;
  pendingProviderResponse?: ProviderResponse;
  pendingToolTurn?: PendingToolTurn;
  outstandingCommand?: PendingCommand;
  outcome?: ClientOutcome;
}

export interface RunFiles {
  directory: string;
  stateFile: string;
  transcriptFile: string;
  promptFile: string;
  exportFile: string;
}

const safePart = (value: string): string => {
  const result = value.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  if (!result) throw new Error('runId cannot be converted to a safe output directory name');
  return result.slice(0, 180);
};

export const openRunFiles = (outputRoot: string, runId: string, allowExisting: boolean): RunFiles => {
  const directory = join(outputRoot, safePart(runId));
  if (!allowExisting && existsSync(join(directory, 'client-state.json'))) throw new Error(`Client output already exists for run ${runId}; use resume or choose a fresh output directory`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return {
    directory,
    stateFile: join(directory, 'client-state.json'),
    transcriptFile: join(directory, 'transcript.jsonl'),
    promptFile: join(directory, 'prompt.txt'),
    exportFile: join(directory, 'player-export.json'),
  };
};

export const readRunState = (files: RunFiles): ClientRunState => {
  if (!existsSync(files.stateFile)) throw new Error(`No saved client state exists at ${files.stateFile}`);
  const raw = JSON.parse(readFileSync(files.stateFile, 'utf8')) as ClientRunState;
  if (raw.format !== 'banksim-client-run' || raw.formatVersion !== 1) throw new Error('Unsupported client run-state format');
  return raw;
};

export const saveRunState = (files: RunFiles, state: ClientRunState): void => {
  state.updatedAt = new Date().toISOString();
  const temporary = `${files.stateFile}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, files.stateFile);
  const summary = {
    format: 'banksim-client-result',
    formatVersion: 1,
    clientVersion: state.clientVersion,
    toolContractVersion: state.toolContractVersion ?? null,
    reportContractVersion: state.reportContractVersion ?? null,
    runId: state.runId,
    serverStatus: state.serverStatus,
    simulationStep: state.simulationStep,
    revision: state.revision,
    terminalReason: state.terminalReason,
    modelTurns: state.modelTurns,
    toolCalls: state.toolCalls,
    providerModels: state.providerModels,
    usageRecords: state.usageRecords,
    assignedLimits: state.assignedLimits ?? null,
    transcriptGaps: state.transcriptGaps,
    prompt: { sha256: state.prompt.sha256, text: state.prompt.text, bytesBase64: state.prompt.bytesBase64 },
    config: state.config,
    startedAt: state.startedAt,
    endedAt: state.endedAt ?? null,
    outcome: state.outcome ?? null,
  };
  writeFileSync(join(files.directory, 'client-run.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
};

export const appendTranscript = (files: RunFiles, type: string, payload: Record<string, unknown>): void => {
  const event = { schemaVersion: 1, eventId: randomUUID(), type, recordedAt: new Date().toISOString(), ...payload };
  appendFileSync(files.transcriptFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
};

export const hasTranscriptEvent = (files: RunFiles, eventId: string): boolean => {
  if (!existsSync(files.transcriptFile)) return false;
  return readFileSync(files.transcriptFile, 'utf8').split('\n').some((line) => {
    if (!line) return false;
    try { return (JSON.parse(line) as { eventId?: string }).eventId === eventId; } catch { return false; }
  });
};

export const recordGap = (state: ClientRunState, code: string, detail: string): void => {
  state.transcriptGaps.push({ code, detail, at: new Date().toISOString() });
};

export const hashProviderInput = (request: ProviderRequest): string => createHash('sha256').update(JSON.stringify(request)).digest('hex');

export const makeOutcome = (state: ClientRunState, reason: string): ClientOutcome => ({
  terminalReason: reason,
  serverStatus: state.serverStatus,
  simulationStep: state.simulationStep,
  revision: state.revision,
  modelTurns: state.modelTurns,
  toolCalls: state.toolCalls,
  transcriptGaps: state.transcriptGaps,
  startedAt: state.startedAt,
  endedAt: new Date().toISOString(),
});

export const savePlayerResponse = (files: RunFiles, state: ClientRunState, response: ProviderResponse): void => {
  const turnId = state.pendingProviderRequest?.turnId ?? state.pendingToolTurn?.turnId;
  const eventId = turnId ? `model-response-${turnId}` : undefined;
  appendTranscript(files, 'model_response', {
    ...(eventId ? { eventId } : {}),
    turnNumber: state.modelTurns,
    turnId: turnId ?? null,
    responseId: response.id,
    requestedModel: response.requestedModel,
    returnedModel: response.returnedModel,
    finishReason: response.finishReason,
    usage: response.usage,
    systemFingerprint: response.systemFingerprint,
    serviceTier: response.serviceTier,
    latencyMs: response.latencyMs,
    message: response.message,
    rawResponse: response.rawResponse,
  });
};
