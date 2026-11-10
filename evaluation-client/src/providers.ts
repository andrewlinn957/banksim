import { randomUUID } from 'node:crypto';
import type { ModelProvider, ProviderRequest, ProviderResponse, ToolCall } from './types.js';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryable = false,
    readonly failureKind: 'timeout' | 'transport' | 'http' | 'invalid_response' = 'http',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const providerEndpoint = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.toString();
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly adapter = 'openai-compatible';
  private readonly endpoint: string;

  constructor(baseUrl: string, private readonly apiKey: string | undefined) {
    this.endpoint = providerEndpoint(baseUrl);
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const payload = {
      model: request.model,
      messages: request.messages,
      tools: request.tools,
      tool_choice: 'auto',
      ...(request.sampling.temperature !== undefined ? { temperature: request.sampling.temperature } : {}),
      ...(request.sampling.topP !== undefined ? { top_p: request.sampling.topP } : {}),
      ...(request.sampling.seed !== undefined ? { seed: request.sampling.seed } : {}),
    };
    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(request.sampling.requestTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new ProviderError(
        timedOut ? 'Model provider request timed out' : 'Model provider request failed before a response was received',
        undefined, true, timedOut ? 'timeout' : 'transport',
      );
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      throw new ProviderError(`Model provider returned HTTP ${response.status}`, response.status, retryable, response.status === 408 ? 'timeout' : 'http');
    }
    let raw: Record<string, unknown>;
    try {
      raw = await response.json() as Record<string, unknown>;
    } catch {
      throw new ProviderError('Model provider returned an invalid JSON response', response.status, false, 'invalid_response');
    }
    const choices = raw.choices;
    const choice = Array.isArray(choices) ? choices[0] as Record<string, unknown> | undefined : undefined;
    const message = choice?.message;
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new ProviderError('Model provider response did not include a chat message', response.status, false, 'invalid_response');
    const normalizedMessage = message as Record<string, unknown>;
    const toolCalls = normalizedMessage.tool_calls;
    if (toolCalls !== undefined && !Array.isArray(toolCalls)) throw new ProviderError('Model provider returned malformed tool calls', response.status, false, 'invalid_response');
    const returnedToolCalls: ToolCall[] = (Array.isArray(toolCalls) ? toolCalls : []).map((rawCall) => {
      const call = rawCall as Record<string, unknown>;
      const fn = call.function as Record<string, unknown> | undefined;
      if (typeof call.id !== 'string' || typeof fn?.name !== 'string' || typeof fn.arguments !== 'string') {
        throw new ProviderError('Model provider returned a malformed function call', response.status, false, 'invalid_response');
      }
      return { id: call.id, type: 'function', function: { name: fn.name, arguments: fn.arguments } };
    });
    const content = normalizedMessage.content;
    const normalized = {
      role: 'assistant' as const,
      content: typeof content === 'string' ? content : null,
      ...(returnedToolCalls.length > 0 ? { tool_calls: returnedToolCalls } : {}),
      ...(typeof normalizedMessage.refusal === 'string' || normalizedMessage.refusal === null ? { refusal: normalizedMessage.refusal } : {}),
    };
    const usage = raw.usage && typeof raw.usage === 'object' && !Array.isArray(raw.usage) ? raw.usage as Record<string, unknown> : null;
    return {
      id: typeof raw.id === 'string' ? raw.id : randomUUID(),
      requestedModel: request.model,
      returnedModel: typeof raw.model === 'string' ? raw.model : null,
      message: normalized,
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      usage,
      systemFingerprint: typeof raw.system_fingerprint === 'string' ? raw.system_fingerprint : null,
      serviceTier: typeof raw.service_tier === 'string' ? raw.service_tier : null,
      rawResponse: raw,
      latencyMs: Math.max(0, performance.now() - started),
    };
  }
}

export class DeterministicMockProvider implements ModelProvider {
  readonly adapter = 'mock';
  private nextCompletion = 0;

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const index = this.nextCompletion++;
    const assistant = index === 0
      ? {
          role: 'assistant' as const,
          content: 'I will inspect the opening position and available controls first.',
          tool_calls: [
            { id: 'mock-overview-1', type: 'function' as const, function: { name: 'get_overview', arguments: '{}' } },
            { id: 'mock-controls-1', type: 'function' as const, function: { name: 'get_controls', arguments: '{}' } },
          ],
        }
      : index === 1
        ? {
            role: 'assistant' as const,
            content: 'I will make one modest policy adjustment, edit and submit a gilt ticket, then advance one month.',
            tool_calls: [
              { id: 'mock-policy-1', type: 'function' as const, function: { name: 'update_decisions', arguments: JSON.stringify({ controls: { 'policy.deposit.corporate_rate': 0.025 }, drafts: { gilt: { direction: 'buy', amountGbp: 1_000_000, tenorMonths: 60 } } }) } },
              { id: 'mock-gilt-1', type: 'function' as const, function: { name: 'queue_transaction', arguments: JSON.stringify({ kind: 'giltTrade' }) } },
              { id: 'mock-advance-1', type: 'function' as const, function: { name: 'advance_time', arguments: JSON.stringify({ months: 1 }) } },
            ],
          }
        : { role: 'assistant' as const, content: 'The deterministic mock plan is complete.', tool_calls: [] };
    const toolCalls = assistant.tool_calls ?? [];
    return {
      id: `mock-completion-${index + 1}`,
      requestedModel: request.model,
      returnedModel: request.model,
      message: assistant,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, provider: 'deterministic-mock' },
      systemFingerprint: 'mock-v1',
      serviceTier: null,
      rawResponse: {
        id: `mock-completion-${index + 1}`,
        object: 'chat.completion',
        model: request.model,
        choices: [{ index: 0, message: assistant, finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
      latencyMs: 0,
    };
  }
}

export const createProvider = (args: { adapter: 'openai-compatible' | 'mock'; baseUrl?: string; apiKey?: string }): ModelProvider =>
  args.adapter === 'mock'
    ? new DeterministicMockProvider()
    : new OpenAICompatibleProvider(args.baseUrl ?? (() => { throw new Error('OpenAI-compatible provider requires baseUrl'); })(), args.apiKey);
