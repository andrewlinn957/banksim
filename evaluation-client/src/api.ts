import type { ApiEnvelope } from './types.js';

export interface HttpResult<T = unknown> {
  status: number;
  data: T;
}

export class ApiTransportError extends Error {
  constructor(message: string, readonly causeValue?: unknown) {
    super(message);
    this.name = 'ApiTransportError';
  }
}

export class BankSimApiClient {
  constructor(
    readonly baseUrl: string,
    private readonly runId: string,
    private readonly playerToken: string,
    private readonly timeoutMs = 300_000,
  ) {}

  async request<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpResult<T>> {
    const url = `${this.baseUrl}/api/v1/runs/${encodeURIComponent(this.runId)}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.playerToken}`,
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ApiTransportError('BankSim request did not produce a response', error);
    }
    let data: unknown;
    try {
      data = await response.json() as unknown;
    } catch {
      data = { error: { code: 'INVALID_SERVER_RESPONSE', message: 'BankSim returned a non-JSON response' } } satisfies ApiEnvelope;
    }
    return { status: response.status, data: data as T };
  }

  get<T = unknown>(path: string): Promise<HttpResult<T>> {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body: unknown): Promise<HttpResult<T>> {
    return this.request<T>('POST', path, body);
  }

  getCommand<T = unknown>(commandId: string): Promise<HttpResult<T>> {
    return this.get<T>(`/commands/${encodeURIComponent(commandId)}`);
  }

  async report<T = unknown>(reportId: string, query: Record<string, unknown> = {}): Promise<HttpResult<T>> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach((item) => search.append(key, String(item)));
      else search.set(key, String(value));
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : '';
    return this.get<T>(`/reports/${encodeURIComponent(reportId)}${suffix}`);
  }
}
