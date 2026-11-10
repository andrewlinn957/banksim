import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadClientConfig, parseClientConfig, publicConfigSnapshot } from '../src/config.js';
import { EvaluationRunner } from '../src/runner.js';
import { DeterministicMockProvider, OpenAICompatibleProvider, ProviderError } from '../src/providers.js';
import { buildPlayerTools } from '../src/tools.js';
import type { JsonObject, ProviderRequest } from '../src/types.js';

afterEach(() => vi.unstubAllGlobals());

const controls = {
  controls: [{
    id: 'policy.customer.retail_rate', area: 'Customers', category: 'standing-policy', label: 'Retail rate', description: 'Retail customer rate.',
    guiLocation: 'Customers', units: 'annual rate', inputFields: ['retailRate'], minimum: 0, maximum: 0.2, sliderStep: 0.005,
  }],
  currentValues: { retailRate: 0.03, capitalMarketsInstrument: 'none', giltTradeDirection: 'none', boeFacility: 'none', hedgeDirection: 'none' },
  riskAppetite: { floors: { cet1: 0.08, leverage: 0.04, lcr: 1, nsfr: 1 }, maximums: { cet1: 0.2, leverage: 0.1, lcr: 10, nsfr: 10 }, effective: null },
  treasuryLimits: { maxGiltSaleGbp: 250_000, maxBoeFundingGbp: 500_000 },
  transactionOptions: { capitalMarketsByArea: {
    Capital: [
      { instrument: 'cet1', label: 'CET1 equity', pricingKind: 'discount' as const, permittedTenorMonths: [] },
      { instrument: 'at1', label: 'AT1', pricingKind: 'spread' as const, permittedTenorMonths: [] },
      { instrument: 'tier2', label: 'Tier 2', pricingKind: 'spread' as const, permittedTenorMonths: [60, 120] },
    ],
    Treasury: [{ instrument: 'senior', label: 'Senior debt', pricingKind: 'spread' as const, permittedTenorMonths: [24, 60, 120] }],
  } },
  time: { monthsUntilQuarterEnd: 3, monthsUntilYearEnd: 12, continuousRunLimitMonths: 12 },
  monthsRemaining: 4,
  operationalLimits: { maxAdvanceMonths: 12, maxPageSize: 120 },
};

describe('standalone client contracts', () => {
  it('registers player-only tools and keeps form drafts separate from queued transactions', () => {
    const gameControls = {
      ...controls,
      controls: [
        ...controls.controls,
        { id: 'transaction.capital_markets', area: 'Capital', category: 'one-off-transaction', label: 'Capital markets ticket', description: 'Ticket draft.', guiLocation: 'Capital', units: 'GBP', inputFields: ['instrument', 'amount'], available: true },
        { id: 'transaction.gilt', area: 'Treasury', category: 'one-off-transaction', label: 'Gilt ticket', description: 'Gilt draft.', guiLocation: 'Treasury', units: 'GBP', inputFields: ['direction', 'amount'], fieldChoices: { giltTradeDirection: ['buy', 'sell'], giltDurationYears: [2, 5, 10] }, available: true },
        { id: 'transaction.boe_funding', area: 'Treasury', category: 'one-off-transaction', label: 'BoE funding', description: 'Funding draft.', guiLocation: 'Treasury', units: 'GBP', inputFields: ['facility', 'amount'], fieldChoices: { boeFacility: ['STR', 'ILTR'] }, available: true },
        { id: 'transaction.hedge', area: 'Treasury', category: 'one-off-transaction', label: 'Hedge', description: 'Hedge draft.', guiLocation: 'Treasury', units: 'GBP', inputFields: ['direction', 'notional'], fieldChoices: { hedgeDirection: ['payFixedReceiveFloat', 'receiveFixedPayFloat'], hedgeMaturityMonths: [12, 24, 60] }, available: true },
      ],
      queuedTransactions: [],
    };
    const tools = buildPlayerTools(gameControls, { reports: [{ id: 'report.summary', title: 'Summary', available: true }, { id: 'report.quote', title: 'Capital-market quote', available: true }] });
    const names = tools.map((tool) => tool.function.name);
    expect(names).toEqual(expect.arrayContaining([
      'get_overview', 'get_controls', 'list_reports', 'get_report', 'get_help', 'preview_next_close',
      'get_player_export', 'update_decisions', 'queue_transaction',
      'set_risk_appetite', 'set_safety_pause', 'advance_time',
    ]));
    expect(names.some((name) => /admin|seed|scenario|rewind|restore|execute_code/i.test(name))).toBe(false);
    const update = tools.find((tool) => tool.function.name === 'update_decisions')!.function.parameters;
    expect(update).toMatchObject({ additionalProperties: false, anyOf: [{ required: ['controls'] }, { required: ['drafts'] }] });
    const updateProperties = update.properties as Record<string, JsonObject>;
    expect(updateProperties.controls).toMatchObject({ minProperties: 1, additionalProperties: false });
    const draftSchemas = updateProperties.drafts.properties as Record<string, JsonObject>;
    expect(draftSchemas).toHaveProperty('capitalMarkets');
    expect(draftSchemas).toHaveProperty('gilt');
    const capitalVariants = draftSchemas.capitalMarkets.anyOf as Array<{ properties: Record<string, JsonObject> }>;
    const capitalCet1 = capitalVariants.find((variant) => variant.properties.instrument.anyOf?.some((choice: JsonObject) => choice.const === 'cet1'))!;
    expect(capitalCet1.properties.area).toMatchObject({ const: 'Capital' });
    expect(capitalCet1.properties.maxDiscountRatio).toBeDefined();
    expect(capitalCet1.properties.maxSpreadBps).toBeUndefined();
    expect(capitalVariants.some((variant) => variant.properties.area.const === 'Treasury' && variant.properties.instrument.anyOf?.some((choice: JsonObject) => choice.const === 'cet1'))).toBe(false);
    const giltDraft = draftSchemas.gilt.anyOf as Array<{ properties: Record<string, JsonObject> }>;
    const giltBuy = giltDraft.find((variant) => variant.properties.direction?.enum?.includes('buy'))!;
    const giltSell = giltDraft.find((variant) => variant.properties.direction?.enum?.includes('sell'))!;
    expect(giltBuy.properties.tenorMonths).toMatchObject({ enum: [24, 60, 120] });
    expect(giltBuy.properties.amountGbp.anyOf).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'string', const: '' })]));
    expect(giltSell.properties.tenorMonths).toBeUndefined();
    expect(giltSell.properties.amountGbp.anyOf[0]).toMatchObject({ maximum: 250_000 });
    const boeDraft = draftSchemas.boeFunding.properties as Record<string, JsonObject>;
    expect(boeDraft.amountGbp.anyOf[0]).toMatchObject({ maximum: 500_000 });
    const changedGiltChoices = {
      ...gameControls,
      controls: gameControls.controls.map((control) => control.id === 'transaction.gilt'
        ? { ...control, fieldChoices: { giltTradeDirection: ['buy', 'sell'], giltDurationYears: [3, 7] } }
        : control),
    };
    const changedGiltDraft = buildPlayerTools(changedGiltChoices, { reports: [] })
      .find((tool) => tool.function.name === 'update_decisions')!.function.parameters.properties.drafts.properties.gilt;
    expect(changedGiltDraft.anyOf[0].properties.tenorMonths).toMatchObject({ enum: [36, 84] });

    const queue = tools.find((tool) => tool.function.name === 'queue_transaction')!.function.parameters;
    expect(queue.required).toEqual(['kind']);
    expect(queue.properties.kind).toMatchObject({ enum: ['capitalMarkets', 'giltTrade', 'boeFunding', 'hedge'] });
    expect(queue.properties).not.toHaveProperty('amountGbp');
    expect(tools.find((tool) => tool.function.name === 'advance_time')?.function.parameters.properties.months).toMatchObject({ maximum: 4 });
    const risk = tools.find((tool) => tool.function.name === 'set_risk_appetite')!.function.parameters;
    const riskSchema = ((risk.properties as Record<string, { anyOf: Array<{ properties: Record<string, JsonObject> }> }>).targets.anyOf[0]);
    expect(riskSchema.properties.lcr).toMatchObject({ minimum: 1 });
    expect(riskSchema.properties.irrbbEveLimit).toMatchObject({ exclusiveMinimum: 0 });

    const queuedTools = buildPlayerTools({ ...gameControls, queuedTransactions: [{ id: 42, kind: 'giltTrade', label: 'Buy gilts: £1m' }] }, { reports: [] });
    const cancel = queuedTools.find((tool) => tool.function.name === 'cancel_transaction');
    expect(cancel?.function.parameters.properties.transaction_id).toMatchObject({ type: 'integer', enum: [42] });
    expect(queuedTools.find((tool) => tool.function.name === 'queue_transaction')?.function.parameters.properties.kind).toMatchObject({ enum: ['capitalMarkets', 'boeFunding', 'hedge'] });

    const terminalControls = { ...gameControls, controls: gameControls.controls.map((control) => ({ ...control, available: false })) };
    const terminalTools = buildPlayerTools(terminalControls, { reports: [] });
    expect(terminalTools.some((tool) => ['update_decisions', 'queue_transaction', 'cancel_transaction', 'advance_time'].includes(tool.function.name))).toBe(false);
    const unavailableReport = buildPlayerTools(gameControls, { reports: [{ id: 'report.summary', title: 'Summary', available: true }, { id: 'report.secret', title: 'Unavailable', available: false }] })
      .find((tool) => tool.function.name === 'get_report')!;
    const availableReportBranches = unavailableReport.function.parameters.anyOf as Array<{ properties: Record<string, JsonObject> }>;
    expect(availableReportBranches.map((branch) => branch.properties.report_id.const)).toEqual(['report.summary']);
    const reportBranches = tools.find((tool) => tool.function.name === 'get_report')!.function.parameters.anyOf as Array<{ properties: Record<string, JsonObject> }>;
    expect(reportBranches.map((branch) => branch.properties.report_id.const)).toEqual(['report.summary', 'report.quote']);
  });

  it('uses report-specific query schemas supplied by the shared API registry', () => {
    const reportTools = buildPlayerTools(controls, { reports: [
      {
        id: 'report.events', title: 'Event log', available: true, queryFields: ['offset', 'limit'],
        querySchema: { type: 'object', properties: {
          offset: { type: 'integer', minimum: 0, maximum: 100_000 },
          limit: { type: 'integer', minimum: 1, maximum: 120 },
        }, additionalProperties: false },
      },
      { id: 'report.quote', title: 'Capital quote', available: true, queryFields: [], querySchema: { type: 'object', properties: {}, additionalProperties: false } },
    ] });
    const parameters = reportTools.find((tool) => tool.function.name === 'get_report')!.function.parameters;
    const branches = parameters.anyOf as Array<{ properties: Record<string, JsonObject> }>;
    const events = branches.find((branch) => branch.properties.report_id.const === 'report.events')!;
    const quote = branches.find((branch) => branch.properties.report_id.const === 'report.quote')!;
    expect(events.properties.query.properties.offset).toMatchObject({ type: 'integer', maximum: 100_000 });
    expect(events.properties.query.properties.limit).toMatchObject({ type: 'integer', maximum: 120 });
    expect(quote.properties).not.toHaveProperty('query');
  });

  it('sends only documented Chat Completions fields and records returned tool calls and usage', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => new Response(JSON.stringify({
      id: 'chatcmpl-test', model: 'provider-model-v2', system_fingerprint: 'fp-test', service_tier: 'default',
      choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'get_overview', arguments: '{}' } },
        { id: 'call-2', type: 'function', function: { name: 'advance_time', arguments: '{"months":1}' } },
      ] } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider('https://models.example/v1', 'provider-secret');
    const request: ProviderRequest = {
      model: 'explicit-model', messages: [{ role: 'user', content: 'task' }], tools: buildPlayerTools(controls, { reports: [] }),
      sampling: { temperature: 0.3, topP: 0.9, seed: 23, requestTimeoutMs: 5000, maxProviderRetries: 2 },
    };
    const response = await provider.complete(request);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://models.example/v1/chat/completions');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer provider-secret');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'seed', 'temperature', 'tool_choice', 'tools', 'top_p']);
    expect(body).toMatchObject({ model: 'explicit-model', tool_choice: 'auto', temperature: 0.3, top_p: 0.9, seed: 23 });
    expect(JSON.stringify(body)).not.toContain('provider-secret');
    expect(response.returnedModel).toBe('provider-model-v2');
    expect(response.message.tool_calls).toHaveLength(2);
    expect(response.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(response.systemFingerprint).toBe('fp-test');
  });

  it('saves the server tool/report contract versions with the effective opening tools', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'banksim-client-contract-test-'));
    try {
      writeFileSync(join(directory, 'prompt.md'), 'Manage the bank.\n');
      writeFileSync(join(directory, 'config.json'), JSON.stringify({
        serverUrl: 'http://127.0.0.1:3000', runId: 'run-contract', playerTokenEnv: 'BANKSIM_PLAYER_TOKEN',
        provider: { adapter: 'mock', model: 'mock-contract-v1' },
        promptFile: './prompt.md', limits: { maxModelTurns: 10, maxToolCalls: 20 }, outputDirectory: './results',
      }));
      const loaded = loadClientConfig(join(directory, 'config.json'), { BANKSIM_PLAYER_TOKEN: 'player-token-for-test' });
      vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => {
        const path = String(input);
        const response = path.endsWith('/overview')
          ? { requestId: 'req-overview', runId: 'run-contract', status: 'active', simulationStep: 0, revision: 0, monthsRemaining: 1,
              evaluationLimits: { maxModelTurns: 10, maxToolCalls: 20 }, controlContractVersion: 'banksim-player-tools-test-v2', reportContractVersion: 'banksim-player-reports-test-v3', overview: {} }
          : path.endsWith('/controls')
            ? { requestId: 'req-controls', controls: controls.controls, currentValues: controls.currentValues, riskAppetite: controls.riskAppetite,
                treasuryLimits: controls.treasuryLimits, transactionOptions: controls.transactionOptions, time: controls.time, operationalLimits: controls.operationalLimits }
            : { requestId: 'req-reports', reports: [] };
        return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      const runner = await EvaluationRunner.start(loaded, new DeterministicMockProvider());
      expect(runner.getState()).toMatchObject({
        toolContractVersion: 'banksim-player-tools-test-v2',
        reportContractVersion: 'banksim-player-reports-test-v3',
      });
      const started = readFileSync(runner.files.transcriptFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
        .find((event) => event.type === 'client_run_started');
      expect(started).toMatchObject({ toolContractVersion: 'banksim-player-tools-test-v2', reportContractVersion: 'banksim-player-reports-test-v3' });
      expect(started.toolDefinitions).toEqual(expect.arrayContaining([
        expect.objectContaining({ function: expect.objectContaining({ name: 'get_overview' }) }),
        expect.objectContaining({ function: expect.objectContaining({ name: 'update_decisions' }) }),
      ]));
      const summary = JSON.parse(readFileSync(join(runner.files.directory, 'client-run.json'), 'utf8'));
      expect(summary).toMatchObject({ toolContractVersion: 'banksim-player-tools-test-v2', reportContractVersion: 'banksim-player-reports-test-v3' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('classifies an adapter timeout separately from other provider failures', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    const provider = new OpenAICompatibleProvider('https://models.example/v1', 'provider-secret');
    const request: ProviderRequest = {
      model: 'explicit-model', messages: [{ role: 'user', content: 'task' }], tools: [],
      sampling: { requestTimeoutMs: 5, maxProviderRetries: 0 },
    };
    await expect(provider.complete(request)).rejects.toMatchObject<Partial<ProviderError>>({ failureKind: 'timeout', retryable: true });
  });

  it('requires an explicit model and preserves exact prompt bytes without persisting credentials', () => {
    const directory = mkdtempSync(join(tmpdir(), 'banksim-client-test-'));
    try {
      const prompt = '  Keep this exact.\n\n';
      const promptPath = join(directory, 'prompt.md');
      const configPath = join(directory, 'config.json');
      writeFileSync(promptPath, prompt, 'utf8');
      const config = {
        serverUrl: 'https://banksim.example', runId: 'run-one', playerTokenEnv: 'BANKSIM_PLAYER_TOKEN',
        provider: { adapter: 'openai-compatible', baseUrl: 'https://provider.example/v1', apiKeyEnv: 'MODEL_API_KEY', model: 'model-explicit', seed: 5 },
        promptFile: './prompt.md', outputDirectory: './results',
      };
      writeFileSync(configPath, JSON.stringify(config));
      expect(() => parseClientConfig({ ...config, provider: { ...config.provider, model: '' } })).toThrow(/provider.model/);
      const loaded = loadClientConfig(configPath, { BANKSIM_PLAYER_TOKEN: 'player-secret', MODEL_API_KEY: 'model-secret' });
      expect(loaded.promptText).toBe(prompt);
      expect(Buffer.from(loaded.promptBytesBase64, 'base64')).toEqual(readFileSync(promptPath));
      expect(loaded.promptSha256).toBe(createHash('sha256').update(readFileSync(promptPath)).digest('hex'));
      const saved = JSON.stringify(publicConfigSnapshot(loaded.config));
      expect(saved).not.toContain('player-secret');
      expect(saved).not.toContain('model-secret');
      expect(saved).toContain('MODEL_API_KEY');
      expect(() => parseClientConfig({ ...config, serverUrl: 'https://user:secret@banksim.example' })).toThrow(/credentials/);
      expect(() => parseClientConfig({ ...config, serverUrl: 'http://banksim.example' })).toThrow(/HTTPS/);
      expect(parseClientConfig({ ...config, serverUrl: 'http://127.0.0.1:3000' }).serverUrl).toBe('http://127.0.0.1:3000');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
