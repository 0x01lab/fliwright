import { CloudError } from './contracts.js';
export class CloudClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('Invalid cloud URL');
  }
  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      key?: string;
      publicationToken?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const binary = Buffer.isBuffer(options.body);
    const response = await fetch(new URL(path, this.baseUrl), {
      method: options.method ?? 'GET',
      redirect: 'error',
      signal: options.signal ?? AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(options.body !== undefined
          ? {
              'content-type': binary
                ? 'application/octet-stream'
                : 'application/json',
            }
          : {}),
        ...(options.key ? { 'idempotency-key': options.key } : {}),
        ...(options.publicationToken
          ? { 'x-publication-token': options.publicationToken }
          : {}),
      },
      body:
        options.body === undefined
          ? undefined
          : binary
            ? new Uint8Array(options.body as Buffer)
            : JSON.stringify(options.body),
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new CloudError(
        response.status,
        data.error ?? 'Cloud request failed',
      );
    return data;
  }
}

export interface GitLabGateRequest {
  state: string;
  verdict: string;
  attempts: Array<{
    attemptId: string;
    outcome?: { cleanup: string; publication: string };
  }>;
  reports: Array<{ attemptId: string; state: string }>;
}
export function passesGitLabGate(request: GitLabGateRequest): boolean {
  const latest = request.attempts.at(-1);
  return (
    request.state === 'completed' &&
    request.verdict === 'passed' &&
    latest?.outcome?.cleanup === 'clean' &&
    request.reports.some(
      (report) =>
        report.attemptId === latest.attemptId && report.state === 'published',
    )
  );
}
