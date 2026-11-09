import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadedConfig, ChatMessage, FunctionToolDefinition, JsonObject, ModelProvider, ProviderRequest, ProviderResponse, ToolCall } from './types.js';
import { BankSimApiClient, ApiTransportError, type HttpResult } from './api.js';
import { buildPlayerTools } from './tools.js';
import { PLAYER_PROTOCOL_INSTRUCTIONS, SYSTEM_INSTRUCTION_VERSION } from './protocol.js';
import { publicConfigSnapshot } from './config.js';
import {
  appendTranscript,
  hashProviderInput,
  makeOutcome,
  openRunFiles,
  readRunState,
  recordGap,
  savePlayerResponse,
  saveRunState,
  hasTranscriptEvent,
  type ClientRunState,
  type PendingCommand,
  type PendingToolTurn,
  type RunFiles,
} from './state.js';

export const CLIENT_VERSION = '0.1.0';
const CONTEXT_GAP_NOTICE_VERSION = 'resume-gap-note-v1';
const PROVIDER_GAP_NOTICE_VERSION = 'provider-gap-v1';

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asRecord = (value: unknown): RecordValue => isRecord(value) ? value : {};
const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const successful = (result: HttpResult) => result.status >= 200 && result.status < 300;
const finiteNumber = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

interface BootstrapData {
  overview: RecordValue;
  controls: RecordValue;
  reports: Array<{ id: string; title: string; available: boolean }>;
  scenarioBriefing: unknown | null;
}

const safeContents = (value: unknown): string => {
  try { return JSON.stringify(value); } catch { return '[unserializable tool result]'; }
};

export class EvaluationRunner {
  readonly api: BankSimApiClient;
  readonly files: RunFiles;
  private tools: FunctionToolDefinition[] = [];
  private currentOverview: RecordValue = {};
  private stopRequested = false;
  private state: ClientRunState;

  private constructor(readonly loaded: LoadedConfig, private readonly provider: ModelProvider, files: RunFiles, state: ClientRunState) {
    this.api = new BankSimApiClient(loaded.config.serverUrl, loaded.config.runId, loaded.playerToken, 300_000);
    this.files = files;
    this.state = state;
  }

  static async start(loaded: LoadedConfig, provider: ModelProvider): Promise<EvaluationRunner> {
    const files = openRunFiles(loaded.outputPath, loaded.config.runId, false);
    writeFileSync(files.promptFile, Buffer.from(loaded.promptBytesBase64, 'base64'), { mode: 0o600 });
    const runner = new EvaluationRunner(loaded, provider, files, {
      format: 'banksim-client-run', formatVersion: 1, clientVersion: CLIENT_VERSION,
      runId: loaded.config.runId, startedAt: now(), updatedAt: now(), terminalReason: null,
      serverStatus: 'unknown', simulationStep: 0, revision: 0, monthsRemaining: null,
      config: publicConfigSnapshot(loaded.config),
      prompt: { text: loaded.promptText, bytesBase64: loaded.promptBytesBase64, sha256: loaded.promptSha256 },
      systemInstructionVersion: SYSTEM_INSTRUCTION_VERSION,
      messages: [], modelTurns: 0, toolCalls: 0, noProgressTurns: 0,
      transcriptGaps: [], providerModels: [loaded.config.provider.model], usageRecords: [],
    });
    await runner.bootstrap();
    return runner;
  }

  static async resume(loaded: LoadedConfig, provider: ModelProvider): Promise<EvaluationRunner> {
    const files = openRunFiles(loaded.outputPath, loaded.config.runId, true);
    const state = readRunState(files);
    if (state.prompt.sha256 !== loaded.promptSha256) throw new Error('Prompt file hash differs from the saved attempt; resume with the original prompt file.');
    const previousConfig = asRecord(state.config);
    const nextConfig = publicConfigSnapshot(loaded.config);
    const previousProvider = asRecord(previousConfig.provider);
    const nextProvider = asRecord(nextConfig.provider);
    if (json(previousConfig.serverUrl) !== json(nextConfig.serverUrl) ||
        json(previousConfig.runId) !== json(nextConfig.runId) ||
        json(previousProvider) !== json(nextProvider)) {
      throw new Error('Server, run ID or provider settings differ from the saved attempt; resume with the original settings.');
    }
    const previousLimits = asRecord(previousConfig.limits);
    const nextLimits = asRecord(nextConfig.limits);
    const limitsChanged = json(previousLimits) !== json(nextLimits);
    if (limitsChanged) {
      for (const key of ['maxModelTurns', 'maxToolCalls', 'maxNoProgressTurns']) {
        if (finiteNumber(nextLimits[key]) < finiteNumber(previousLimits[key])) throw new Error('Resume limits may be raised, but not lowered, within an attempt.');
      }
      appendTranscript(files, 'client_budget_extended', { previousLimits, newLimits: nextLimits, version: 'budget-policy-v1' });
      state.config = nextConfig;
    }
    if (state.terminalReason && !['interrupted', 'provider_error', 'budget_exhausted'].includes(state.terminalReason)) {
      throw new Error(`This attempt is terminal (${state.terminalReason}) and cannot be resumed.`);
    }
    if (state.terminalReason) {
      appendTranscript(files, 'client_resumed', { previousTerminalReason: state.terminalReason });
      state.terminalReason = null;
      delete state.endedAt;
      delete state.outcome;
    }
    const runner = new EvaluationRunner(loaded, provider, files, state);
    await runner.reconcileAtResume();
    return runner;
  }

  static attach(loaded: LoadedConfig, provider: ModelProvider, options: { verifyPrompt?: boolean } = {}): EvaluationRunner {
    const files = openRunFiles(loaded.outputPath, loaded.config.runId, true);
    const state = readRunState(files);
    if (options.verifyPrompt !== false && state.prompt.sha256 !== loaded.promptSha256) throw new Error('Prompt file hash differs from the saved attempt.');
    if (state.runId !== loaded.config.runId) throw new Error('Saved client state belongs to a different run ID.');
    return new EvaluationRunner(loaded, provider, files, state);
  }

  requestStop(): void {
    this.stopRequested = true;
  }

  getState(): ClientRunState { return this.state; }

  private async read(path: string, body?: unknown): Promise<HttpResult> {
    const method = body === undefined ? 'GET' : 'POST';
    const result = body === undefined ? await this.api.get(path) : await this.api.post(path, body);
    appendTranscript(this.files, 'player_request', {
      method, path: `/api/v1/runs/${this.loaded.config.runId}${path}`,
      ...(body !== undefined ? { requestBody: body } : {}),
      responseStatus: result.status,
      responseBody: result.data,
    });
    return result;
  }

  private requireRead(result: HttpResult, label: string): RecordValue {
    if (!successful(result)) throw new Error(`${label} failed with HTTP ${result.status}`);
    return asRecord(result.data);
  }

  private observe(data: RecordValue): void {
    const revision = data.revision;
    const step = data.simulationStep;
    if (Number.isSafeInteger(revision)) this.state.revision = revision as number;
    if (Number.isSafeInteger(step)) this.state.simulationStep = step as number;
    if (typeof data.status === 'string') this.state.serverStatus = data.status;
    if (typeof data.monthsRemaining === 'number' || data.monthsRemaining === null) this.state.monthsRemaining = data.monthsRemaining;
    this.state.lastOverview = data;
  }

  private validateAssignedLimits(data: RecordValue): { maxModelTurns: number; maxToolCalls: number } {
    const limits = asRecord(data.evaluationLimits);
    const maxModelTurns = limits.maxModelTurns;
    const maxToolCalls = limits.maxToolCalls;
    if (!Number.isSafeInteger(maxModelTurns) || !Number.isSafeInteger(maxToolCalls) || (maxModelTurns as number) < 1 || (maxToolCalls as number) < 1) {
      throw new Error('BankSim overview omitted valid administrator-assigned model and tool-call budgets.');
    }
    const assigned = { maxModelTurns: maxModelTurns as number, maxToolCalls: maxToolCalls as number };
    if (this.loaded.config.limits.maxModelTurns > assigned.maxModelTurns || this.loaded.config.limits.maxToolCalls > assigned.maxToolCalls) {
      throw new Error(`Local limits exceed the run's assigned budget (maxModelTurns=${assigned.maxModelTurns}, maxToolCalls=${assigned.maxToolCalls}).`);
    }
    if (this.state.assignedLimits && json(this.state.assignedLimits) !== json(assigned)) {
      throw new Error('Administrator-assigned run budgets changed after the attempt started.');
    }
    this.state.assignedLimits = assigned;
    return assigned;
  }

  private async bootstrap(): Promise<void> {
    const runId = this.loaded.config.runId;
    const overviewResponse = await this.read('/overview');
    const overview = this.requireRead(overviewResponse, 'Opening overview');
    const assignedLimits = this.validateAssignedLimits(overview);
    this.observe(overview);
    const controlsResponse = await this.read('/controls');
    const controls = this.requireRead(controlsResponse, 'Opening controls');
    const reportResponse = await this.read('/reports');
    const reportData = this.requireRead(reportResponse, 'Report catalogue');
    const reports = Array.isArray(reportData.reports) ? reportData.reports as BootstrapData['reports'] : [];
    let scenarioBriefing: unknown | null = null;
    if (reports.some((report) => report.id === 'report.scenario' && report.available)) {
      const scenarioResponse = await this.read('/reports/report.scenario');
      if (successful(scenarioResponse)) scenarioBriefing = scenarioResponse.data;
    }
    this.state.latestControls = controls;
    this.state.reportCatalog = reports;
    this.currentOverview = asRecord(overview.overview);
    this.tools = buildPlayerTools(controls as never, { reports });
    const openingBriefing = {
      overview: this.currentOverview,
      runStatus: { status: this.state.serverStatus, simulationStep: this.state.simulationStep, monthsRemaining: this.state.monthsRemaining, ...assignedLimits },
      scenario: scenarioBriefing,
    };
    this.state.messages = [
      { role: 'system', content: PLAYER_PROTOCOL_INSTRUCTIONS },
      { role: 'user', content: `Player-visible opening information returned by BankSim:\n${JSON.stringify(openingBriefing)}` },
      { role: 'user', content: this.loaded.promptText },
    ];
    appendTranscript(this.files, 'client_run_started', {
      runId, clientVersion: CLIENT_VERSION, adapter: this.provider.adapter,
      model: this.loaded.config.provider.model,
      prompt: { text: this.loaded.promptText, bytesBase64: this.loaded.promptBytesBase64, sha256: this.loaded.promptSha256 },
      systemInstructionVersion: SYSTEM_INSTRUCTION_VERSION,
      openingBriefing,
      messages: this.state.messages,
      toolDefinitions: this.tools,
      config: this.state.config,
    });
    saveRunState(this.files, this.state);
  }

  async inspect(): Promise<RecordValue> {
    const result = await this.read('/overview');
    const data = this.requireRead(result, 'Overview');
    this.observe(data);
    saveRunState(this.files, this.state);
    return data;
  }

  async collectPlayerExport(): Promise<RecordValue> {
    const result = await this.read('/export');
    const data = this.requireRead(result, 'Player export');
    writeFileSync(this.files.exportFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    appendTranscript(this.files, 'player_export_collected', { path: 'player-export.json', responseStatus: result.status });
    saveRunState(this.files, this.state);
    return data;
  }

  async run(): Promise<ClientRunState> {
    if (this.state.pendingProviderRequest && !this.state.pendingProviderResponse) {
      recordGap(this.state, 'provider_response_missing', `Provider request for turn ${this.state.pendingProviderRequest.turnNumber} started but no response was durably recorded; resuming does not assume whether it completed.`);
      appendTranscript(this.files, 'transcript_gap', { ...this.state.transcriptGaps.at(-1)! });
      this.state.messages.push({
        role: 'system',
        content: `Resume notice (${PROVIDER_GAP_NOTICE_VERSION}): the previous provider request may have completed, but its response was not saved. No tool call from that missing response was executed by this client. Do not infer what it said; continue from the saved messages and current BankSim information.`,
      });
      delete this.state.pendingProviderRequest;
      saveRunState(this.files, this.state);
    }
    if (this.state.pendingToolTurn) await this.processPendingToolTurn();

    while (!this.state.terminalReason) {
      if (this.stopRequested) {
        await this.finish('interrupted');
        break;
      }
      if (this.isTerminalServerStatus()) {
        await this.finish(this.state.serverStatus);
        break;
      }
      if (!this.state.pendingProviderResponse && this.state.modelTurns >= this.loaded.config.limits.maxModelTurns) {
        await this.finish('budget_exhausted', { budget: 'maxModelTurns' });
        break;
      }
      if (!this.state.pendingProviderResponse && this.state.toolCalls >= this.loaded.config.limits.maxToolCalls) {
        await this.finish('budget_exhausted', { budget: 'maxToolCalls' });
        break;
      }

      let turnId: string;
      let response = this.state.pendingProviderResponse;
      if (!response) {
        try {
          await this.refreshContextForTurn();
        } catch (error) {
          appendTranscript(this.files, 'player_refresh_failed', { message: error instanceof Error ? error.message : 'Unknown refresh error' });
          await this.finish('server_error', { phase: 'pre_model_refresh' });
          break;
        }
        if (this.isTerminalServerStatus()) {
          await this.finish(this.state.serverStatus);
          break;
        }

        turnId = randomUUID();
        const turnNumber = this.state.modelTurns + 1;
        const request: ProviderRequest = {
          model: this.loaded.config.provider.model,
          messages: structuredClone(this.state.messages),
          tools: structuredClone(this.tools),
          sampling: {
            ...(this.loaded.config.provider.temperature !== undefined ? { temperature: this.loaded.config.provider.temperature } : {}),
            ...(this.loaded.config.provider.topP !== undefined ? { topP: this.loaded.config.provider.topP } : {}),
            ...(this.loaded.config.provider.seed !== undefined ? { seed: this.loaded.config.provider.seed } : {}),
            requestTimeoutMs: this.loaded.config.provider.requestTimeoutMs,
            maxProviderRetries: this.loaded.config.provider.maxProviderRetries,
          },
        };
        const inputHash = hashProviderInput(request);
        this.state.modelTurns += 1;
        this.state.pendingProviderRequest = { turnId, turnNumber, messages: request.messages, tools: request.tools, startedAt: now(), inputHash };
        saveRunState(this.files, this.state);
        appendTranscript(this.files, 'model_request', {
          turnId, turnNumber, adapter: this.provider.adapter, requestedModel: request.model,
          messages: request.messages, tools: request.tools,
          sampling: request.sampling, inputHash,
        });

        const received = await this.callProviderWithRetries(request, turnId, turnNumber);
        if (!received) break;
        response = received;
        this.state.pendingProviderResponse = response;
        saveRunState(this.files, this.state);
        savePlayerResponse(this.files, this.state, response);
      } else {
        const pendingRequest = this.state.pendingProviderRequest;
        if (!pendingRequest) throw new Error('Saved provider response has no matching request metadata');
        turnId = pendingRequest.turnId;
        const eventId = `model-response-${turnId}`;
        if (!hasTranscriptEvent(this.files, eventId)) savePlayerResponse(this.files, this.state, response);
      }
      const turnNumber = this.state.pendingProviderRequest?.turnNumber ?? this.state.modelTurns;
      delete this.state.pendingProviderResponse;
      delete this.state.pendingProviderRequest;
      if (response.returnedModel && !this.state.providerModels.includes(response.returnedModel)) this.state.providerModels.push(response.returnedModel);
      if (response.usage) this.state.usageRecords.push({ turnId, requestedModel: response.requestedModel, returnedModel: response.returnedModel, usage: response.usage, latencyMs: response.latencyMs });
      const calls = response.message.tool_calls ?? [];
      if (calls.length === 0) {
        this.state.messages.push(response.message);
        await this.finish('model_finished', { finishReason: response.finishReason });
        break;
      }
      const remainingToolBudget = this.loaded.config.limits.maxToolCalls - this.state.toolCalls;
      if (calls.length > remainingToolBudget) {
        this.state.messages.push(response.message);
        appendTranscript(this.files, 'model_tool_calls_not_executed', { turnId, count: calls.length, remainingBudget: remainingToolBudget });
        await this.finish('budget_exhausted', { budget: 'maxToolCalls', unexecutedReturnedCalls: calls.length });
        break;
      }
      this.state.pendingToolTurn = {
        turnId, assistantMessage: response.message, calls, nextToolIndex: 0, toolResponses: [],
        countedCallIds: [], simulationStepAtStart: this.state.simulationStep,
      };
      saveRunState(this.files, this.state);
      await this.processPendingToolTurn();
      if (this.state.terminalReason) break;
    }
    return this.state;
  }

  private async callProviderWithRetries(request: ProviderRequest, turnId: string, turnNumber: number): Promise<ProviderResponse | null> {
    const maximumAttempts = request.sampling.maxProviderRetries + 1;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      if (this.stopRequested) {
        await this.finish('interrupted', { pendingProviderRequest: turnId });
        return null;
      }
      const startedAt = now();
      try {
        const response = await this.provider.complete(request);
        appendTranscript(this.files, 'provider_attempt_succeeded', { turnId, turnNumber, attempt, startedAt, providerLatencyMs: response.latencyMs, responseId: response.id });
        return response;
      } catch (error) {
        const retryable = Boolean((error as { retryable?: boolean })?.retryable);
        const statusCode = (error as { statusCode?: number })?.statusCode ?? null;
        const failureKind = (error as { failureKind?: string })?.failureKind ?? 'provider_error';
        appendTranscript(this.files, 'provider_attempt_failed', {
          turnId, turnNumber, attempt, startedAt,
          error: error instanceof Error ? error.message : 'Unknown provider error',
          statusCode, retryable, failureKind,
        });
        if (!retryable || attempt >= maximumAttempts) {
          delete this.state.pendingProviderRequest;
          await this.finish(failureKind === 'timeout' ? 'provider_timeout' : 'provider_error', { turnId, turnNumber, attempts: attempt, statusCode, failureKind });
          return null;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(1000 * 2 ** (attempt - 1), 10_000)));
      }
    }
    return null;
  }

  private async refreshContextForTurn(): Promise<void> {
    const beforeRevision = this.state.revision;
    const overviewResult = await this.read('/overview');
    const overview = this.requireRead(overviewResult, 'Overview refresh');
    this.validateAssignedLimits(overview);
    const observedRevision = finiteNumber(overview.revision, beforeRevision);
    if (observedRevision < beforeRevision) throw new Error(`Server revision moved backwards from ${beforeRevision} to ${observedRevision}`);
    if (observedRevision > beforeRevision && !this.state.outstandingCommand) {
      recordGap(this.state, 'unmatched_server_revision', `Server revision changed from ${beforeRevision} to ${observedRevision} without a matching local command response. The intervening interaction is not inferred.`);
      appendTranscript(this.files, 'transcript_gap', { ...this.state.transcriptGaps.at(-1)! });
      this.state.messages.push({
        role: 'system',
        content: `Resume notice (${CONTEXT_GAP_NOTICE_VERSION}): BankSim is now at revision ${observedRevision}, while the saved transcript ended at revision ${beforeRevision}. The missing interaction is not available in this client transcript. Re-read current player reports and controls before making another decision.`,
      });
    }
    this.observe(overview);
    this.currentOverview = asRecord(overview.overview);

    const controlsResult = await this.read('/controls');
    const controls = this.requireRead(controlsResult, 'Controls refresh');
    this.state.latestControls = controls;
    const reportsResult = await this.read('/reports');
    const reportData = this.requireRead(reportsResult, 'Reports refresh');
    const reports = Array.isArray(reportData.reports) ? reportData.reports as Array<{ id: string; title: string; available: boolean }> : [];
    this.state.reportCatalog = reports;
    this.tools = buildPlayerTools(controls as never, { reports });
    saveRunState(this.files, this.state);
  }

  private async processPendingToolTurn(): Promise<void> {
    const pending = this.state.pendingToolTurn;
    if (!pending) return;
    while (pending.nextToolIndex < pending.calls.length) {
      if (this.stopRequested) {
        await this.finish('interrupted', { pendingTurnId: pending.turnId, nextToolIndex: pending.nextToolIndex });
        return;
      }
      const call = pending.calls[pending.nextToolIndex];
      if (!call) throw new Error('Pending model tool call is missing');
      const savedCommand = this.state.outstandingCommand;
      if (savedCommand && (savedCommand.toolCallId !== call.id || savedCommand.turnId !== pending.turnId || savedCommand.toolIndex !== pending.nextToolIndex)) {
        throw new Error('A saved command does not match the pending model tool call; refusing to issue another mutation.');
      }
      if (!pending.countedCallIds.includes(call.id)) {
        if (this.state.toolCalls >= this.loaded.config.limits.maxToolCalls) {
          await this.finish('budget_exhausted', { budget: 'maxToolCalls', pendingTurnId: pending.turnId });
          return;
        }
        this.state.toolCalls += 1;
        pending.countedCallIds.push(call.id);
        saveRunState(this.files, this.state);
      }
      let toolResult: unknown;
      try {
        if (savedCommand) toolResult = await this.reconcileOutstandingCommand();
        else {
          const args = JSON.parse(call.function.arguments || '{}') as unknown;
          toolResult = await this.executeTool(call, args, pending);
        }
      } catch (error) {
        if (error instanceof ApiTransportError) {
          appendTranscript(this.files, 'player_request_uncertain', { turnId: pending.turnId, toolCallId: call.id, toolName: call.function.name, message: error.message });
          await this.finish('interrupted', { outstandingCommandId: this.state.outstandingCommand?.commandId ?? null });
          return;
        }
        toolResult = { ok: false, error: error instanceof Error ? error.message : 'Tool failed before a response was returned' };
      }
      pending.toolResponses.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: safeContents(toolResult) });
      pending.nextToolIndex += 1;
      if (this.state.outstandingCommand?.toolCallId === call.id) delete this.state.outstandingCommand;
      saveRunState(this.files, this.state);
      appendTranscript(this.files, 'tool_result', { turnId: pending.turnId, toolCallId: call.id, toolName: call.function.name, result: toolResult });
      if (this.isTerminalServerStatus()) break;
    }
    if (pending.nextToolIndex >= pending.calls.length || this.isTerminalServerStatus()) {
      this.state.messages.push(pending.assistantMessage, ...pending.toolResponses);
      const advanced = this.state.simulationStep > pending.simulationStepAtStart;
      this.state.noProgressTurns = advanced ? 0 : this.state.noProgressTurns + 1;
      appendTranscript(this.files, 'model_turn_completed', {
        turnId: pending.turnId, toolCalls: pending.calls.length,
        simulationStepBefore: pending.simulationStepAtStart, simulationStepAfter: this.state.simulationStep,
        noProgressTurns: this.state.noProgressTurns,
      });
      delete this.state.pendingToolTurn;
      saveRunState(this.files, this.state);
      if (this.isTerminalServerStatus()) await this.finish(this.state.serverStatus);
      else if (this.state.noProgressTurns >= this.loaded.config.limits.maxNoProgressTurns) {
        await this.finish('budget_exhausted', { budget: 'maxNoProgressTurns', simulationStep: this.state.simulationStep });
      }
    }
  }

  private async executeTool(call: ToolCall, argsValue: unknown, turn: PendingToolTurn): Promise<unknown> {
    const args = asRecord(argsValue);
    const toolCallId = call.id;
    const name = call.function.name;
    switch (name) {
      case 'get_overview': return this.executeReadTool(toolCallId, name, '/overview', undefined, (data) => {
        this.observe(data); this.currentOverview = asRecord(data.overview);
      });
      case 'get_controls': return this.executeReadTool(toolCallId, name, '/controls', undefined, (data) => {
        this.state.latestControls = data; this.tools = buildPlayerTools(data as never, { reports: this.state.reportCatalog ?? [] });
      });
      case 'list_reports': return this.executeReadTool(toolCallId, name, '/reports', undefined, (data) => {
        const catalog = Array.isArray(data.reports) ? data.reports as Array<{ id: string; title: string; available: boolean }> : [];
        this.state.reportCatalog = catalog; this.tools = buildPlayerTools(asRecord(this.state.latestControls) as never, { reports: catalog });
      });
      case 'get_report': {
        const reportId = this.requireString(args.report_id, 'report_id');
        const query = args.query === undefined ? {} : asRecord(args.query);
        const result = await this.api.report(reportId, query);
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
          if (value === undefined || value === null) continue;
          if (Array.isArray(value)) value.forEach((item) => search.append(key, String(item)));
          else search.set(key, String(value));
        }
        const reportPath = `/reports/${encodeURIComponent(reportId)}${search.size > 0 ? `?${search.toString()}` : ''}`;
        appendTranscript(this.files, 'player_request', {
          method: 'GET', path: `/api/v1/runs/${this.loaded.config.runId}${reportPath}`,
          responseStatus: result.status, responseBody: result.data,
        });
        return this.finishReadResult(toolCallId, name, reportPath, result, (data) => {
          if (reportId === 'report.overview') this.currentOverview = asRecord(data.data);
        });
      }
      case 'get_help': {
        const topicId = this.requireString(args.topic_id, 'topic_id');
        const path = `/help/${encodeURIComponent(topicId)}`;
        return this.executeReadTool(toolCallId, name, path);
      }
      case 'preview_next_close': {
        const department = this.requireString(args.department, 'department');
        if (!['Customers', 'Lending', 'Capital', 'Treasury'].includes(department)) throw new Error('Unknown management area');
        return this.executeReadTool(toolCallId, name, '/preview', { department });
      }
      case 'get_player_export': return this.executeReadTool(toolCallId, name, '/export');
      case 'update_decisions': return this.executeMutationTool(call, turn, 'update_decisions', { controls: asRecord(args.controls) });
      case 'queue_transaction': return this.executeMutationTool(call, turn, 'queue_transaction', args);
      case 'cancel_transaction': return this.executeMutationTool(call, turn, 'cancel_transaction', { kind: args.kind });
      case 'set_risk_appetite': return this.executeMutationTool(call, turn, 'set_risk_appetite', { targets: args.targets });
      case 'set_safety_pause': return this.executeMutationTool(call, turn, 'set_safety_pause', { enabled: args.enabled });
      case 'advance_time': return this.executeMutationTool(call, turn, 'advance_time', { months: args.months });
      default:
        appendTranscript(this.files, 'unregistered_model_tool_rejected', { turnId: turn.turnId, toolCallId, toolName: name });
        return { ok: false, error: 'This tool is not registered in the BankSim player client.' };
    }
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`);
    return value;
  }

  private async executeReadTool(toolCallId: string, toolName: string, path: string, body?: unknown, onData?: (data: RecordValue) => void): Promise<unknown> {
    const result = await this.read(path, body);
    return this.finishReadResult(toolCallId, toolName, path, result, onData);
  }

  private finishReadResult(toolCallId: string, toolName: string, path: string, result: HttpResult, onData?: (data: RecordValue) => void): unknown {
    const data = asRecord(result.data);
    if (successful(result)) onData?.(data);
    saveRunState(this.files, this.state);
    return { ok: successful(result), httpStatus: result.status, data: result.data, toolCallId, toolName, path };
  }

  private async executeMutationTool(call: ToolCall, turn: PendingToolTurn, type: string, payload: RecordValue): Promise<unknown> {
    const body = {
      commandId: randomUUID(),
      expectedRevision: this.state.revision,
      type,
      payload,
    };
    const pending: PendingCommand = {
      commandId: body.commandId,
      body,
      toolCallId: call.id,
      toolName: call.function.name,
      toolIndex: turn.nextToolIndex,
      turnId: turn.turnId,
    };
    this.state.outstandingCommand = pending;
    saveRunState(this.files, this.state);
    appendTranscript(this.files, 'player_command_prepared', { ...pending });
    return this.reconcileOutstandingCommand();
  }

  private async reconcileOutstandingCommand(): Promise<unknown> {
    const pending = this.state.outstandingCommand;
    if (!pending) return { ok: false, error: 'No outstanding command was saved' };
    if (pending.responseStatus !== undefined) {
      return {
        ok: successful({ status: pending.responseStatus, data: pending.responseBody }),
        httpStatus: pending.responseStatus, data: pending.responseBody, commandId: pending.commandId,
        toolCallId: pending.toolCallId, toolName: pending.toolName,
      };
    }
    let result: HttpResult;
    try {
      result = await this.api.getCommand(pending.commandId);
      appendTranscript(this.files, 'player_command_status_check', {
        commandId: pending.commandId, responseStatus: result.status, responseBody: result.data,
      });
      if (result.status === 404) {
        result = await this.api.post('/commands', pending.body);
        appendTranscript(this.files, 'player_command_submitted', {
          commandId: pending.commandId, requestBody: pending.body, responseStatus: result.status, responseBody: result.data,
        });
      }
    } catch (error) {
      if (!(error instanceof ApiTransportError)) throw error;
      appendTranscript(this.files, 'player_command_status_uncertain', { commandId: pending.commandId, message: error.message });
      throw error;
    }
    const data = asRecord(result.data);
    if (data.progress && asRecord(data.progress).status === 'running') {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
        result = await this.api.getCommand(pending.commandId);
        appendTranscript(this.files, 'player_command_polled', { commandId: pending.commandId, responseStatus: result.status, responseBody: result.data });
        if (asRecord(asRecord(result.data).progress).status !== 'running') break;
      }
      if (asRecord(asRecord(result.data).progress).status === 'running') {
        throw new ApiTransportError('BankSim command is still running; resume later to reconcile the same command ID.');
      }
    }
    const responseData = asRecord(result.data);
    this.observe(responseData);
    pending.responseStatus = result.status;
    pending.responseBody = result.data;
    saveRunState(this.files, this.state);
    appendTranscript(this.files, 'player_command_completed', {
      commandId: pending.commandId, toolCallId: pending.toolCallId, toolName: pending.toolName,
      requestBody: pending.body, responseStatus: result.status, responseBody: result.data,
    });
    return { ok: successful(result), httpStatus: result.status, data: result.data, commandId: pending.commandId, toolCallId: pending.toolCallId, toolName: pending.toolName };
  }

  private async reconcileAtResume(): Promise<void> {
    if (this.state.outstandingCommand && !this.state.pendingToolTurn) {
      throw new Error('Saved command has no pending model turn; refusing to issue or discard a mutation.');
    }
    if (this.state.pendingToolTurn) return;
    const previousRevision = this.state.revision;
    try {
      await this.refreshContextForTurn();
      if (this.state.revision > previousRevision) saveRunState(this.files, this.state);
    } catch (error) {
      appendTranscript(this.files, 'resume_reconciliation_failed', { message: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  private isTerminalServerStatus(): boolean {
    return ['bank_failure', 'horizon_reached', 'owner_stopped', 'server_error', 'interrupted'].includes(this.state.serverStatus);
  }

  private async finish(reason: string, details: Record<string, unknown> = {}): Promise<void> {
    if (this.state.terminalReason && this.state.terminalReason !== 'interrupted') return;
    this.state.terminalReason = reason;
    this.state.endedAt = now();
    this.state.outcome = makeOutcome(this.state, reason);
    appendTranscript(this.files, 'client_outcome', { ...this.state.outcome, details });
    saveRunState(this.files, this.state);
  }
}
