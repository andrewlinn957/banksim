import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ClientConfig, LoadedConfig, ProviderConfig, RunLimits } from './types.js';

const DEFAULT_LIMITS: RunLimits = { maxModelTurns: 1000, maxToolCalls: 5000, maxNoProgressTurns: 12 };
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_PROVIDER_RETRIES = 2;

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Config field ${field} must be a non-empty string`);
  return value;
};
const requireInteger = (value: unknown, field: string, minimum: number, maximum: number, fallback?: number): number => {
  const actual = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(actual) || (actual as number) < minimum || (actual as number) > maximum) {
    throw new Error(`Config field ${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return actual as number;
};
const validateHttpUrl = (value: string, field: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${field} must use HTTP or HTTPS`);
  const host = url.hostname.toLowerCase();
  const loopback = host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';
  if (url.protocol === 'http:' && !loopback) throw new Error(`${field} must use HTTPS except for a loopback development endpoint`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${field} must not contain credentials, query parameters or a fragment; use environment variables for secrets`);
  return url.toString().replace(/\/$/, '');
};
const validateSampling = (provider: Record<string, unknown>): Pick<ProviderConfig, 'temperature' | 'topP' | 'seed'> => {
  const sampling: Pick<ProviderConfig, 'temperature' | 'topP' | 'seed'> = {};
  if (provider.temperature !== undefined) {
    if (typeof provider.temperature !== 'number' || !Number.isFinite(provider.temperature) || provider.temperature < 0 || provider.temperature > 2) throw new Error('provider.temperature must be from 0 to 2');
    sampling.temperature = provider.temperature;
  }
  if (provider.topP !== undefined) {
    if (typeof provider.topP !== 'number' || !Number.isFinite(provider.topP) || provider.topP <= 0 || provider.topP > 1) throw new Error('provider.topP must be greater than 0 and no more than 1');
    sampling.topP = provider.topP;
  }
  if (provider.seed !== undefined) sampling.seed = requireInteger(provider.seed, 'provider.seed', 0, Number.MAX_SAFE_INTEGER);
  return sampling;
};

export const parseClientConfig = (value: unknown): ClientConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
  const raw = value as Record<string, unknown>;
  const providerRaw = raw.provider as Record<string, unknown> | undefined;
  if (!providerRaw || typeof providerRaw !== 'object' || Array.isArray(providerRaw)) throw new Error('Config field provider must be an object');
  const adapter = providerRaw.adapter;
  if (adapter !== 'openai-compatible' && adapter !== 'mock') throw new Error('provider.adapter must be openai-compatible or mock');
  const model = requireText(providerRaw.model, 'provider.model');
  const timeout = requireInteger(providerRaw.requestTimeoutMs, 'provider.requestTimeoutMs', 1000, 600_000, DEFAULT_TIMEOUT_MS);
  const retries = requireInteger(providerRaw.maxProviderRetries, 'provider.maxProviderRetries', 0, 10, DEFAULT_PROVIDER_RETRIES);
  const provider: ProviderConfig = {
    adapter,
    model,
    requestTimeoutMs: timeout,
    maxProviderRetries: retries,
    ...validateSampling(providerRaw),
  };
  if (adapter === 'openai-compatible') {
    provider.baseUrl = validateHttpUrl(requireText(providerRaw.baseUrl, 'provider.baseUrl'), 'provider.baseUrl');
    if (providerRaw.apiKeyEnv !== undefined) provider.apiKeyEnv = requireText(providerRaw.apiKeyEnv, 'provider.apiKeyEnv');
  }

  const limitsRaw = (raw.limits && typeof raw.limits === 'object' ? raw.limits : {}) as Record<string, unknown>;
  const limits: RunLimits = {
    maxModelTurns: requireInteger(limitsRaw.maxModelTurns, 'limits.maxModelTurns', 1, 1_000_000, DEFAULT_LIMITS.maxModelTurns),
    maxToolCalls: requireInteger(limitsRaw.maxToolCalls, 'limits.maxToolCalls', 1, 5_000_000, DEFAULT_LIMITS.maxToolCalls),
    maxNoProgressTurns: requireInteger(limitsRaw.maxNoProgressTurns, 'limits.maxNoProgressTurns', 1, 1000, DEFAULT_LIMITS.maxNoProgressTurns),
  };
  return {
    serverUrl: validateHttpUrl(requireText(raw.serverUrl, 'serverUrl'), 'serverUrl'),
    runId: requireText(raw.runId, 'runId'),
    playerTokenEnv: requireText(raw.playerTokenEnv, 'playerTokenEnv'),
    provider,
    promptFile: requireText(raw.promptFile, 'promptFile'),
    limits,
    outputDirectory: requireText(raw.outputDirectory, 'outputDirectory'),
  };
};

export const loadClientConfig = (path: string, env: NodeJS.ProcessEnv = process.env, options: { requireModelApiKey?: boolean } = {}): LoadedConfig => {
  const configPath = resolve(path);
  const configText = readFileSync(configPath, 'utf8');
  const config = parseClientConfig(JSON.parse(configText) as unknown);
  const root = dirname(configPath);
  const promptPath = isAbsolute(config.promptFile) ? config.promptFile : resolve(root, config.promptFile);
  const outputPath = isAbsolute(config.outputDirectory) ? config.outputDirectory : resolve(root, config.outputDirectory);
  const playerToken = env[config.playerTokenEnv];
  if (!playerToken) throw new Error(`Player token environment variable ${config.playerTokenEnv} is not set`);
  let modelApiKey: string | undefined;
  if (config.provider.adapter === 'openai-compatible' && config.provider.apiKeyEnv) {
    modelApiKey = env[config.provider.apiKeyEnv];
    if (!modelApiKey && options.requireModelApiKey !== false) throw new Error(`Model API key environment variable ${config.provider.apiKeyEnv} is not set`);
  }
  const promptBytes = readFileSync(promptPath);
  let promptText: string;
  try {
    promptText = new TextDecoder('utf-8', { fatal: true }).decode(promptBytes);
  } catch {
    throw new Error(`Prompt file ${promptPath} is not valid UTF-8 text`);
  }
  return {
    config, configPath, promptPath, outputPath, playerToken,
    ...(modelApiKey !== undefined ? { modelApiKey } : {}),
    promptText,
    promptBytesBase64: promptBytes.toString('base64'),
    promptSha256: createHash('sha256').update(promptBytes).digest('hex'),
  };
};

export const publicConfigSnapshot = (config: ClientConfig) => ({
  serverUrl: config.serverUrl,
  runId: config.runId,
  playerTokenEnv: config.playerTokenEnv,
  provider: {
    adapter: config.provider.adapter,
    ...(config.provider.baseUrl ? { baseUrl: config.provider.baseUrl } : {}),
    ...(config.provider.apiKeyEnv ? { apiKeyEnv: config.provider.apiKeyEnv } : {}),
    model: config.provider.model,
    ...(config.provider.temperature !== undefined ? { temperature: config.provider.temperature } : {}),
    ...(config.provider.topP !== undefined ? { topP: config.provider.topP } : {}),
    ...(config.provider.seed !== undefined ? { seed: config.provider.seed } : {}),
    requestTimeoutMs: config.provider.requestTimeoutMs,
    maxProviderRetries: config.provider.maxProviderRetries,
  },
  promptFile: config.promptFile,
  limits: config.limits,
});
