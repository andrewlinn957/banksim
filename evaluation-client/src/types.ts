export type JsonObject = Record<string, unknown>;

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  refusal?: string | null;
  [key: string]: unknown;
}

export interface FunctionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonObject;
  };
}

export interface SamplingSettings {
  temperature?: number;
  topP?: number;
  seed?: number;
  requestTimeoutMs: number;
  maxProviderRetries: number;
}

export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  tools: FunctionToolDefinition[];
  sampling: SamplingSettings;
}

export interface ProviderResponse {
  id: string;
  requestedModel: string;
  returnedModel: string | null;
  message: ChatMessage;
  finishReason: string | null;
  usage: JsonObject | null;
  systemFingerprint: string | null;
  serviceTier: string | null;
  rawResponse: JsonObject;
  latencyMs: number;
}

export interface ModelProvider {
  readonly adapter: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface RunLimits {
  maxModelTurns: number;
  maxToolCalls: number;
  maxNoProgressTurns: number;
}

export interface ProviderConfig {
  adapter: 'openai-compatible' | 'mock';
  baseUrl?: string;
  apiKeyEnv?: string;
  model: string;
  temperature?: number;
  topP?: number;
  seed?: number;
  requestTimeoutMs: number;
  maxProviderRetries: number;
}

export interface ClientConfig {
  serverUrl: string;
  runId: string;
  playerTokenEnv: string;
  provider: ProviderConfig;
  promptFile: string;
  limits: RunLimits;
  outputDirectory: string;
}

export interface LoadedConfig {
  config: ClientConfig;
  configPath: string;
  promptPath: string;
  outputPath: string;
  playerToken: string;
  modelApiKey?: string;
  promptText: string;
  promptBytesBase64: string;
  promptSha256: string;
}

export interface ApiEnvelope<T = unknown> {
  requestId?: string;
  data?: T;
  error?: { code?: string; message?: string; issues?: unknown[] };
  [key: string]: unknown;
}

export interface ClientOutcome {
  terminalReason: string;
  serverStatus: string;
  simulationStep: number;
  revision: number;
  modelTurns: number;
  toolCalls: number;
  transcriptGaps: Array<{ code: string; detail: string; at: string }>;
  startedAt: string;
  endedAt: string;
}
