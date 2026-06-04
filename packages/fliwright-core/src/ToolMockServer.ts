import http from 'node:http';
import type { MockCall, MockRouteResponse } from './types.js';
import { MockRuleStore } from './MockRuleStore.js';

export interface ToolMockRequest {
  method: string;
  url: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ToolMockResult {
  matched: boolean;
  passthrough?: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delay?: number;
  error?: string;
  reason?: string;
  candidates?: Array<{ method?: string; path: string }>;
}

interface ToolMockRoute {
  id: string;
  method?: string;
  pathPattern: string;
  response: MockRouteResponse;
}

export interface ToolMockServerOptions {
  host?: string;
  port?: number;
  passthrough?: boolean;
}

export class ToolMockServer {
  private server: http.Server | null = null;
  private routes: ToolMockRoute[] = [];
  private calls: MockCall[] = [];
  private passthrough: boolean;
  readonly ruleStore = new MockRuleStore();

  constructor(private options: ToolMockServerOptions = {}) {
    this.passthrough = options.passthrough ?? true;
  }

  get url(): string | null {
    const address = this.server?.address();
    if (!address || typeof address === 'string') return null;
    return `http://${this.options.host ?? '127.0.0.1'}:${address.port}`;
  }

  async start(): Promise<string> {
    if (this.server) return this.url!;

    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 0;
    this.server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });

    return this.url!;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  route(path: string, response: MockRouteResponse & { method?: string }): void {
    const route: ToolMockRoute = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method: response.method,
      pathPattern: path,
      response: {
        status: response.status,
        headers: response.headers,
        body: response.body,
        delay: response.delay,
      },
    };
    this.routes = this.routes.filter((existing) => !sameRouteKey(existing, route));
    this.routes.push(route);
  }

  removeRoute(path: string, method?: string): void {
    this.routes = this.routes.filter((route) => {
      if (route.pathPattern !== path) return true;
      if (!method) return false;
      return (route.method ?? '').toUpperCase() !== method.toUpperCase();
    });
  }

  clear(): void {
    this.routes = [];
  }

  clearCalls(): void {
    this.calls = [];
  }

  setPassthrough(enabled: boolean): void {
    this.passthrough = enabled;
  }

  getCalls(path?: string): MockCall[] {
    return path ? this.calls.filter((call) => call.path === path) : [...this.calls];
  }

  listRoutes(): Array<{ id: string; method?: string; path: string }> {
    return this.routes.map((route) => ({
      id: route.id,
      method: route.method,
      path: route.pathPattern,
    }));
  }

  async loadRules(mockDir = '.fliwright/mocks'): Promise<void> {
    await this.ruleStore.loadFromDirectory(mockDir);
    for (const endpoint of this.ruleStore.listEndpoints()) {
      const response = this.ruleStore.getActiveResponse(endpoint.endpoint, endpoint.method);
      if (response) {
        this.route(endpoint.endpoint, { ...response, method: endpoint.method });
      }
    }
  }

  switchRule(endpoint: string, ruleName: string, method?: string): void {
    this.ruleStore.switchRule(endpoint, ruleName, method);
    const entry = this.ruleStore.listEndpoints().find((item) => (
      item.endpoint === endpoint && (!method || item.method.toUpperCase() === method.toUpperCase())
    ));
    const response = entry ? this.ruleStore.getActiveResponse(endpoint, entry.method) : null;
    if (response) {
      this.route(endpoint, { ...response, method: entry?.method });
    }
  }

  handleMockRequest(request: ToolMockRequest): ToolMockResult {
    const path = request.path || parsePath(request.url);
    this.calls.push({
      method: request.method,
      path,
      headers: request.headers ?? {},
      body: stringifyBody(request.body),
      timestamp: new Date().toISOString(),
    });

    const route = this.routes.find((candidate) => matchesRoute(candidate, request.method, path));
    if (!route) {
      const pathCandidates = this.routes
        .filter((candidate) => routePathMatches(candidate, path))
        .map(routeCandidate);
      const methodMismatch = pathCandidates.length > 0;
      return {
        matched: false,
        passthrough: this.passthrough,
        status: this.passthrough ? undefined : 404,
        headers: { 'Content-Type': 'application/json' },
        body: {
          error: methodMismatch ? 'Mock route path matched but method did not' : 'No matching mock route',
          method: request.method,
          path,
          candidates: pathCandidates,
        },
        reason: methodMismatch ? 'method_mismatch' : 'path_mismatch',
        candidates: methodMismatch ? pathCandidates : this.routes.map(routeCandidate),
      };
    }

    return {
      matched: true,
      status: route.response.status ?? 200,
      headers: route.response.headers ?? { 'Content-Type': 'application/json' },
      body: route.response.body,
      delay: route.response.delay,
    };
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (req.method === 'GET' && req.url === '/debug') {
        writeJson(res, 200, this.debugState());
        return;
      }
      if (req.url?.startsWith('/routes')) {
        await this.handleRoutesAdmin(req, res);
        return;
      }
      if (req.url?.startsWith('/calls')) {
        await this.handleCallsAdmin(req, res);
        return;
      }
      if (req.method === 'POST' && req.url === '/passthrough') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as { enabled?: boolean };
        this.setPassthrough(body.enabled === true);
        writeJson(res, 200, { passthrough: this.passthrough });
        return;
      }
      if (req.method !== 'POST' || req.url !== '/mock') {
        writeJson(res, 404, { error: 'Not found' });
        return;
      }

      const raw = await readBody(req);
      const request = JSON.parse(raw || '{}') as ToolMockRequest;
      const result = this.handleMockRequest(request);
      if (result.delay && result.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, result.delay));
      }
      writeJson(res, 200, result);
    } catch (error) {
      writeJson(res, 500, { matched: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private debugState(): Record<string, unknown> {
    return {
      routes: this.listRoutes(),
      calls: this.calls.length,
      passthrough: this.passthrough,
    };
  }

  private async handleRoutesAdmin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      writeJson(res, 200, { routes: this.listRoutes() });
      return;
    }

    const raw = await readBody(req);
    const body = JSON.parse(raw || '{}') as {
      path?: string;
      method?: string;
      response?: MockRouteResponse;
    };

    if (req.method === 'POST') {
      if (!body.path) {
        writeJson(res, 400, { error: 'Missing path' });
        return;
      }
      this.route(body.path, { ...(body.response ?? {}), method: body.method });
      writeJson(res, 200, { routes: this.listRoutes() });
      return;
    }

    if (req.method === 'DELETE') {
      if (body.path) {
        this.removeRoute(body.path, body.method);
      } else {
        this.clear();
      }
      writeJson(res, 200, { routes: this.listRoutes() });
      return;
    }

    writeJson(res, 405, { error: 'Method not allowed' });
  }

  private async handleCallsAdmin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      const url = new URL(req.url ?? '/calls', 'http://127.0.0.1');
      writeJson(res, 200, { calls: this.getCalls(url.searchParams.get('path') ?? undefined) });
      return;
    }

    if (req.method === 'DELETE') {
      this.clearCalls();
      writeJson(res, 200, { calls: [] });
      return;
    }

    writeJson(res, 405, { error: 'Method not allowed' });
  }
}

function sameRouteKey(a: ToolMockRoute, b: ToolMockRoute): boolean {
  return a.pathPattern === b.pathPattern && (a.method ?? '').toUpperCase() === (b.method ?? '').toUpperCase();
}

function routeCandidate(route: ToolMockRoute): { method?: string; path: string } {
  return route.method ? { method: route.method, path: route.pathPattern } : { path: route.pathPattern };
}

function matchesRoute(route: ToolMockRoute, method: string, path: string): boolean {
  if (route.method && route.method.toUpperCase() !== method.toUpperCase()) return false;
  return routePathMatches(route, path);
}

function routePathMatches(route: ToolMockRoute, path: string): boolean {
  if (route.pathPattern.endsWith('/*')) {
    const prefix = route.pathPattern.slice(0, -2);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  return path === route.pathPattern;
}

function parsePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0] || '/';
  }
}

function stringifyBody(body: unknown): string {
  if (body === undefined || body === null) return '';
  return typeof body === 'string' ? body : JSON.stringify(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
