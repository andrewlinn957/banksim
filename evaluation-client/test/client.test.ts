import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadClientConfig, parseClientConfig, publicConfigSnapshot } from '../src/config.js';
import { OpenAICompatibleProvider, ProviderError } from '../src/providers.js';
import { buildPlayerTools } from '../src/tools.js';
import type { ProviderRequest } from '../src/types.js';

afterEach(() => vi.unstubAllGlobals());

const controls = {
  controls: [{
    id: 'policy.customer.retail_rate', category: 'standing-policy', label: 'Retail rate', description: 'Retail customer rate.',
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
  operationalLimits: { maxAdvanceMonths: 12, maxPageSize: 120 },
};

describe('standalone client contracts', () => {
  it('registers only player tools and describes positive transaction bounds', () => {
    const tools = buildPlayerTools(controls, { reports: [{ id: 'report.summary', title: 'Summary', available: true }] });
    const names = tools.map((tool) => tool.function.name);
    expect(names).toEqual(expect.arrayContaining([
      'get_overview', 'get_controls', 'list_reports', 'get_report', 'get_help', 'preview_next_close',
      'get_player_export', 'update_decisions', 'queue_transaction',
      'set_risk_appetite', 'set_safety_pause', 'advance_time',
    ]));
    expect(names.some((name) => /admin|seed|scenario|rewind|restore|execute_code/i.test(name))).toBe(false);
    expect(tools.find((tool) => tool.function.name === 'update_decisions')?.function.parameters).toMatchObject({
      additionalProperties: false,
    });
    const transaction = tools.find((tool) => tool.function.name === 'queue_transaction')!.function.parameters;
    const variants = transaction.anyOf as Array<{ properties: Record<string, { const?: string; exclusiveMinimum?: number }> }>;
    const gilt = variants.find((variant) => variant.properties.kind?.const === 'gilt' && variant.properties.direction?.const === 'buy');
    expect(gilt?.properties.amountGbp?.exclusiveMinimum).toBe(0);
    const sell = variants.find((variant) => variant.properties.kind?.const === 'gilt' && variant.properties.direction?.const === 'sell');
    expect(sell?.properties.tenorMonths).toBeUndefined();
    expect(sell?.properties.amountGbp).toMatchObject({ maximum: 250_000 });
    const capitalCet1 = variants.find((variant) => variant.properties.instrument?.const === 'cet1');
    expect(capitalCet1?.properties.area).toMatchObject({ const: 'Capital' });
    expect(capitalCet1?.properties.maxDiscountRatio).toBeDefined();
    expect(capitalCet1?.properties.maxSpreadBps).toBeUndefined();
    expect(variants.some((variant) => variant.properties.instrument?.const === 'cet1' && variant.properties.area?.const === 'Treasury')).toBe(false);
    expect(variants.some((variant) => variant.properties.instrument?.const === 'senior' && variant.properties.area?.const === 'Capital')).toBe(false);
    expect(variants.find((variant) => variant.properties.instrument?.const === 'tier2')?.properties.tenorMonths).toMatchObject({ enum: [60, 120] });
    const risk = tools.find((tool) => tool.function.name === 'set_risk_appetite')!.function.parameters;
    const riskSchema = ((risk.properties as Record<string, { anyOf: Array<{ properties: Record<string, JsonObject> }> }>).targets.anyOf[0]);
    expect(riskSchema.properties.lcr).toMatchObject({ minimum: 1 });
    expect(riskSchema.properties.irrbbEveLimit).toMatchObject({ exclusiveMinimum: 0 });
    expect(tools.some((tool) => tool.function.name === 'cancel_transaction')).toBe(false);
    const unavailableReport = buildPlayerTools(controls, { reports: [{ id: 'report.summary', title: 'Summary', available: true }, { id: 'report.secret', title: 'Unavailable', available: false }] })
      .find((tool) => tool.function.name === 'get_report')!;
    expect(unavailableReport.function.parameters.properties.report_id).toMatchObject({ enum: ['report.summary'] });
    const draftTools = buildPlayerTools({ ...controls, currentValues: { ...controls.currentValues, giltTradeDirection: 'buy' } }, { reports: [] });
    const cancel = draftTools.find((tool) => tool.function.name === 'cancel_transaction');
    expect(cancel?.function.parameters.properties.kind).toMatchObject({ enum: ['gilt'] });
    expect(draftTools.some((tool) => tool.function.name === 'get_report')).toBe(false);
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
