import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockManager, MockRuntime, ScenarioCoordinator, ScenarioResolver, TimelineRecorder, resolveMockRuleSet, type MockRuleSet } from '../src/index.js';

describe('explicit shared and Item mock rule sets', () => {
  let root: string;
  let config: MockRuleSet;
  const endpoint = (path: string, body: unknown, method = 'GET') => ({
    version: 1, name: path, endpoint: path, method,
    rules: [{ name: 'success', status: 200, body }, { name: 'error', status: 500, body: { error: true } }],
  });
  const writeEndpoint = async (file: string, value: unknown) => {
    await writeFile(join(root, file), JSON.stringify(value));
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fliwright-rule-set-'));
    await mkdir(join(root, 'shared/api'), { recursive: true });
    await mkdir(join(root, 'item/api'), { recursive: true });
    await writeEndpoint('shared/api/user.json', endpoint('/user', { shared: true, nested: { inherited: true } }));
    await writeEndpoint('shared/api/unused.json', endpoint('/unused', {}));
    await writeEndpoint('item/api/user.json', endpoint('/user', { item: true }));
    config = {
      sources: [
        { name: 'shared', directory: join(root, 'shared'), files: ['api/user.json', 'api/unused.json'] },
        { name: 'item-437', directory: join(root, 'item'), files: ['api/user.json'] },
      ],
      rules: [{ source: 'shared', endpoint: '/user', method: 'get', rule: 'success' }],
    };
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('selects only referenced rules and records their source and content hash', async () => {
    const resolved = await resolveMockRuleSet(config);
    expect(resolved.routes).toHaveLength(1);
    expect(resolved.routes[0]).toMatchObject({
      source: 'shared', file: 'api/user.json', endpoint: '/user', method: 'GET', rule: 'success',
      response: { status: 200, body: { shared: true, nested: { inherited: true } } },
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(resolved.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await writeEndpoint('shared/api/user.json', endpoint('/user', { changed: true }));
    expect((await resolveMockRuleSet(config)).fingerprint).not.toBe(resolved.fingerprint);
  });

  it('requires explicit replacement and replaces the whole response', async () => {
    config.rules.push({ source: 'item-437', endpoint: '/user', method: 'GET', rule: 'success' });
    await expect(resolveMockRuleSet(config)).rejects.toThrow(/replace/i);
    config.rules[1].replace = true;
    const resolved = await resolveMockRuleSet(config);
    expect(resolved.routes).toHaveLength(1);
    expect(resolved.routes[0].response).toEqual({ status: 200, body: { item: true } });
    expect(resolved.routes[0].source).toBe('item-437');
    config.rules = [config.rules[1]];
    await expect(resolveMockRuleSet(config)).rejects.toThrow(/replace/i);
  });

  it.each(['source', 'rule', 'method', 'file', 'json', 'status', 'duplicate-route', 'duplicate-rule', 'duplicate-source', 'path'])('fails strictly for invalid %s', async (kind) => {
    if (kind === 'source') config.rules[0].source = 'missing';
    if (kind === 'rule') config.rules[0].rule = 'missing';
    if (kind === 'method') config.rules[0].method = 'POST';
    if (kind === 'file') config.sources[0].files = ['api/missing.json'];
    if (kind === 'json') await writeFile(join(root, 'shared/api/user.json'), '{');
    if (kind === 'status') await writeEndpoint('shared/api/user.json', { ...endpoint('/user', {}), rules: [{ name: 'success' }] });
    if (kind === 'duplicate-route') {
      await writeEndpoint('shared/api/unused.json', endpoint('/user', {}));
    }
    if (kind === 'duplicate-rule') {
      const value = endpoint('/user', {}); value.rules.push(value.rules[0]);
      await writeEndpoint('shared/api/user.json', value);
    }
    if (kind === 'duplicate-source') config.sources.push(config.sources[0]);
    if (kind === 'path') config.sources[0].files = ['../item/api/user.json'];
    await expect(resolveMockRuleSet(config)).rejects.toThrow();
  });

  function flutterBridge() {
    const routes = new Map<string, Record<string, unknown>>();
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method.endsWith('.clearRoutes')) routes.clear();
      if (method.endsWith('.addRoute')) {
        const route = JSON.parse(params!.route as string);
        routes.set(`${route.method} ${route.path}`, route);
      }
      if (method.endsWith('.listRoutes')) return { routes: [...routes.values()] };
      if (method.endsWith('.getCalls')) return { calls: [] };
      return { success: true };
    });
    return { routes, send };
  }

  it('applies resolved routes strictly and resets state for every attempt without reviving old rules', async () => {
    const bridge = flutterBridge();
    const manager = new MockManager(bridge.send);
    await manager.loadRules(join(root, 'shared'));
    const report = await manager.applyRuleSet(config);
    expect(report.routes[0]).not.toHaveProperty('response');
    expect([...bridge.routes.keys()]).toEqual(['GET /user']);
    expect(manager.listRules()).toEqual([]);
    await expect(manager.switchRule('/unused', 'success', 'GET')).rejects.toThrow();
    config.rules = [{ source: 'item-437', endpoint: '/user', method: 'GET', rule: 'error' }];
    await manager.applyRuleSet(config);
    expect(bridge.routes.get('GET /user')).toMatchObject({ response: { status: 500, body: { error: true } } });
    expect(bridge.send.mock.calls.filter(([method]) => method.endsWith('.clearCalls'))).toHaveLength(2);
    expect(bridge.send).toHaveBeenCalledWith('ext.fliwright.mock.setPassthrough', { enabled: 'false' });
  });

  it('validates before touching the app and stops when Flutter rejects application', async () => {
    const bridge = flutterBridge();
    const manager = new MockManager(bridge.send);
    config.rules[0].rule = 'missing';
    await expect(manager.applyRuleSet(config)).rejects.toThrow();
    expect(bridge.send).not.toHaveBeenCalled();
    config.rules[0].rule = 'success';
    bridge.send.mockImplementation(async () => ({ success: false }));
    await expect(manager.applyRuleSet(config)).rejects.toThrow(/Flutter/i);
  });

  it.each(['addRoute', 'listRoutes'])('cleans up partial routes when Flutter rejects or fails to apply %s', async (operation) => {
    const bridge = flutterBridge();
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method.endsWith(`.${operation}`)) {
        return operation === 'addRoute' ? { success: false } : { routes: [] };
      }
      return bridge.send(method, params);
    });
    const manager = new MockManager(send);
    await expect(manager.applyRuleSet(config)).rejects.toThrow(/Flutter/i);
    expect([...bridge.routes.keys()]).toEqual([]);
    expect(manager._server.listRoutes()).toEqual([]);
  });

  it('keeps GET and POST selections independent and supports the existing baseRule format', async () => {
    await writeEndpoint('item/api/user.json', {
      version: 1, name: 'Create user', endpoint: '/user', method: 'POST',
      baseRule: { status: 201, headers: { 'Content-Type': 'application/json' }, body: { keep: true, omit: true } },
      rules: [{ name: 'created', body: { id: 1 }, removeBodyFields: ['omit'] }],
    });
    config.rules.push({ source: 'item-437', endpoint: '/user', method: 'POST', rule: 'created' });
    const result = await resolveMockRuleSet(config);
    expect(result.routes.map(route => route.method)).toEqual(['GET', 'POST']);
    expect(result.routes[1].response).toEqual({
      status: 201, headers: { 'Content-Type': 'application/json' }, body: { keep: true, id: 1 },
    });
  });

  it('clearing loaded routes also forgets the old catalog before the next directory is loaded', async () => {
    const manager = new MockManager(flutterBridge().send);
    await manager.loadRules(join(root, 'shared'));
    await manager.clearFlutterRoutes();
    expect(manager.listRules()).toEqual([]);
    await manager.loadRules(join(root, 'item'));
    expect(manager.listRules().map(route => route.endpoint)).toEqual(['/user']);
    expect(manager._server.listRoutes().map(route => route.path)).toEqual(['/user']);
  });

  it('records rule provenance in the timeline without response bodies', async () => {
    const recorder = new TimelineRecorder({ runId: 'rules', testName: 'Item 437' });
    const runtime = new MockRuntime(new MockManager(flutterBridge().send), recorder);
    const report = await runtime.applyRuleSet(config);
    expect(recorder.toJSON().nodes[0]).toMatchObject({
      status: 'passed', metadata: { operation: 'applyRuleSet', ruleSet: report },
    });
    expect(JSON.stringify(report)).not.toContain('inherited');
  });

  it('composes shared and Item scenarios into one application before authentication', async () => {
    const bridge = flutterBridge();
    const mock = new MockManager(bridge.send);
    const app = { invoke: vi.fn(async () => ({ isAuthenticated: true })) };
    const scenario = new ScenarioResolver({
      shared: { name: 'shared', layers: [{ kind: 'mocks', ...config }] },
      item: { name: 'item', extends: ['shared'], layers: [
        { kind: 'mocks', sources: [], rules: [{ source: 'item-437', endpoint: '/user', method: 'GET', rule: 'success', replace: true }] },
        { kind: 'auth', state: 'authenticated' },
      ] },
    }).resolve('item');
    const report = await new ScenarioCoordinator({ mock, app }).apply(scenario, { mode: 'attach' });
    expect(report.mocks?.routes).toEqual([expect.objectContaining({ source: 'item-437' })]);
    expect(bridge.send.mock.calls.filter(([method]) => method.endsWith('.clearRoutes'))).toHaveLength(1);
    expect(bridge.routes.get('GET /user')).toMatchObject({ response: { body: { item: true } } });
    expect(app.invoke).toHaveBeenCalledWith('auth', 'seedLoggedIn', {});
    expect(bridge.send.mock.invocationCallOrder.at(-1)).toBeLessThan(app.invoke.mock.invocationCallOrder[0]);
  });

  it('rejects ambiguous directory/source composition and conflicting network policy', () => {
    for (const layer of [
      { kind: 'mocks' as const, directory: '.fliwright/mocks' },
      { kind: 'mocks' as const, sources: [], denyUnmatchedRequests: false },
      { kind: 'mocks' as const, sources: [config.sources[0]] },
    ]) {
      expect(() => new ScenarioResolver({
        shared: { name: 'shared', layers: [{ kind: 'mocks', ...config, denyUnmatchedRequests: true }] },
        item: { name: 'item', extends: ['shared'], layers: [layer] },
      }).resolve('item')).toThrow();
    }
  });
});
