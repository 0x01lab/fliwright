import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockRuleStore } from '../src/MockRuleStore.js';
import type { MockRule, MockEndpointConfig, MockIndex } from '../src/types.js';
import { readFile, readdir } from 'node:fs/promises';

// We'll mock fs/promises at the module level
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);

describe('MockRuleStore', () => {
  let store: MockRuleStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MockRuleStore();
  });

  describe('loadFromDirectory()', () => {
    it('loads mock-index.json and all endpoint files', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/get-token.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Get Token List',
        method: 'GET',
        endpoint: '/v1/public/token',
        rules: [
          { name: 'success', status: 200, body: { data: [] } },
          { name: 'empty', status: 200, body: { data: [] } },
          { name: 'server_error', status: 500, body: { error: 'fail' } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('get-token.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const endpoints = store.listEndpoints();
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].endpoint).toBe('/v1/public/token');
      expect(endpoints[0].method).toBe('GET');
      expect(endpoints[0].rules).toEqual(['success', 'empty', 'server_error']);
      expect(endpoints[0].activeRule).toBe('success');
    });

    it('keeps entries separate by method and endpoint', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/get-user.json', 'api/post-user.json'],
      };
      const getEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Get User',
        method: 'GET',
        endpoint: '/api/user',
        rules: [
          { name: 'success', status: 200, body: { method: 'GET' } },
          { name: 'error', status: 500, body: { fail: true } },
        ],
      };
      const postEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Create User',
        method: 'POST',
        endpoint: '/api/user',
        rules: [
          { name: 'success', status: 201, body: { method: 'POST' } },
          { name: 'error', status: 422, body: { invalid: true } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('get-user.json')) return JSON.stringify(getEndpoint);
        if (p.endsWith('post-user.json')) return JSON.stringify(postEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.listEndpoints()).toEqual([
        expect.objectContaining({ endpoint: '/api/user', method: 'GET' }),
        expect.objectContaining({ endpoint: '/api/user', method: 'POST' }),
      ]);
      expect(store.getActiveResponse('/api/user', 'GET')).toEqual({
        status: 200,
        body: { method: 'GET' },
      });
      expect(store.getActiveResponse('/api/user', 'POST')).toEqual({
        status: 201,
        body: { method: 'POST' },
      });
    });

    it('auto-loads api/*.json when mock-index.json does not exist', async () => {
      const instrumentEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Instrument API',
        method: 'GET',
        endpoint: '/api/v1/public/trading/instrument',
        rules: [
          { name: 'empty', status: 200, body: { data: [] } },
          { name: 'success', status: 200, body: { success: true } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) throw new Error('ENOENT');
        if (p.endsWith('instrument-api.json')) return JSON.stringify(instrumentEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });
      mockReaddir.mockResolvedValue([
        { name: 'instrument-api.json', isFile: () => true },
        { name: 'README.md', isFile: () => true },
        { name: 'nested', isFile: () => false },
      ] as any);

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const endpoints = store.listEndpoints();
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toEqual({
        endpoint: '/api/v1/public/trading/instrument',
        method: 'GET',
        rules: ['empty', 'success'],
        activeRule: 'success',
      });
    });

    it('uses first rule during auto-load when success rule is absent', async () => {
      const endpoint: MockEndpointConfig = {
        version: 1,
        name: 'No Success',
        method: 'GET',
        endpoint: '/api/no-success',
        rules: [
          { name: 'empty', status: 200, body: [] },
          { name: 'server_error', status: 500, body: { error: true } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) throw new Error('ENOENT');
        if (p.endsWith('no-success.json')) return JSON.stringify(endpoint);
        throw new Error(`Unexpected read: ${p}`);
      });
      mockReaddir.mockResolvedValue([
        { name: 'no-success.json', isFile: () => true },
      ] as any);

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.listEndpoints()[0].activeRule).toBe('empty');
    });

    it('skips individual files that fail to parse', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/good.json', 'api/bad.json'],
      };
      const goodEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Good',
        method: 'GET',
        endpoint: '/api/good',
        rules: [{ name: 'success', status: 200, body: {} }],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('good.json')) return JSON.stringify(goodEndpoint);
        if (p.endsWith('bad.json')) return 'not valid json{{{';
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const endpoints = store.listEndpoints();
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].endpoint).toBe('/api/good');
    });

    it('sets activeRule to defaultRule from index', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'empty',
        files: ['api/test.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Test',
        method: 'POST',
        endpoint: '/api/test',
        rules: [
          { name: 'success', status: 200, body: {} },
          { name: 'empty', status: 200, body: {} },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('test.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.listEndpoints()[0].activeRule).toBe('empty');
    });

    it('expands endpoint baseRule into each rule override', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/user.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'User',
        method: 'GET',
        endpoint: '/api/user',
        baseRule: {
          status: 200,
          delay: 50,
          headers: {
            'Content-Type': 'application/json',
            'X-Base': 'base',
          },
          body: {
            success: true,
            source: 'base',
          },
        },
        rules: [
          {
            name: 'success',
            body: {
              name: 'Ada',
            },
          },
          {
            name: 'server_error',
            status: 500,
            headers: {
              'X-Base': 'override',
            },
            body: {
              success: false,
              message: 'failed',
            },
          },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('user.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.getActiveResponse('/api/user')).toEqual({
        status: 200,
        delay: 50,
        headers: {
          'Content-Type': 'application/json',
          'X-Base': 'base',
        },
        body: {
          success: true,
          source: 'base',
          name: 'Ada',
        },
      });

      expect(store.switchRule('/api/user', 'server_error')).toEqual({
        status: 500,
        delay: 50,
        headers: {
          'Content-Type': 'application/json',
          'X-Base': 'override',
        },
        body: {
          success: false,
          source: 'base',
          message: 'failed',
        },
      });
    });

    it('skips baseRule endpoint files when a rule cannot resolve status', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/bad.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Bad',
        method: 'GET',
        endpoint: '/api/bad',
        baseRule: {
          headers: {
            'Content-Type': 'application/json',
          },
        },
        rules: [
          {
            name: 'success',
            body: {},
          },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('bad.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.listEndpoints()).toEqual([]);
    });

    it('replaces non-object bodies instead of merging them with base body', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'array_body',
        files: ['api/body.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Body',
        method: 'GET',
        endpoint: '/api/body',
        baseRule: {
          status: 200,
          body: { ok: true, inherited: true },
        },
        rules: [
          { name: 'array_body', body: [1, 2, 3] },
          { name: 'string_body', body: 'plain text' },
          { name: 'null_body', body: null },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('body.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.getActiveResponse('/api/body')).toEqual({ status: 200, body: [1, 2, 3] });
      expect(store.switchRule('/api/body', 'string_body')).toEqual({ status: 200, body: 'plain text' });
      expect(store.switchRule('/api/body', 'null_body')).toEqual({ status: 200, body: null });
    });

    it('removes inherited body fields after applying rule body overrides', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'without_phone',
        files: ['api/user.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'User',
        method: 'GET',
        endpoint: '/api/user',
        baseRule: {
          status: 200,
          body: {
            username: 'ada',
            phone: '+85268****85',
            otpConfigured: true,
          },
        },
        rules: [
          {
            name: 'without_phone',
            body: { otpConfigured: false },
            removeBodyFields: ['phone'],
          },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('user.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.getActiveResponse('/api/user')).toEqual({
        status: 200,
        body: {
          username: 'ada',
          otpConfigured: false,
        },
      });
    });

    it('falls back to first rule when defaultRule does not match any rule', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'nonexistent',
        files: ['api/test.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Test',
        method: 'GET',
        endpoint: '/api/test',
        rules: [
          { name: 'success', status: 200, body: {} },
          { name: 'empty', status: 200, body: {} },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('test.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.listEndpoints()[0].activeRule).toBe('success');
    });
  });

  describe('listEndpoints()', () => {
    it('returns empty array when no rules loaded', () => {
      expect(store.listEndpoints()).toEqual([]);
    });
  });

  describe('switchRule()', () => {
    it('switches active rule for an endpoint', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/test.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Test',
        method: 'GET',
        endpoint: '/api/test',
        rules: [
          { name: 'success', status: 200, body: { ok: true } },
          { name: 'error', status: 500, body: { fail: true } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('test.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const response = store.switchRule('/api/test', 'error');

      expect(response).toEqual({ status: 500, body: { fail: true } });
      expect(store.listEndpoints()[0].activeRule).toBe('error');
    });

    it('switches by method when endpoint path is shared', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/get-user.json', 'api/post-user.json'],
      };
      const getEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Get User',
        method: 'GET',
        endpoint: '/api/user',
        rules: [
          { name: 'success', status: 200, body: { method: 'GET' } },
          { name: 'error', status: 500, body: { fail: 'get' } },
        ],
      };
      const postEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Create User',
        method: 'POST',
        endpoint: '/api/user',
        rules: [
          { name: 'success', status: 201, body: { method: 'POST' } },
          { name: 'error', status: 422, body: { fail: 'post' } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('get-user.json')) return JSON.stringify(getEndpoint);
        if (p.endsWith('post-user.json')) return JSON.stringify(postEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const response = store.switchRule('/api/user', 'error', 'POST');

      expect(response).toEqual({ status: 422, body: { fail: 'post' } });
      expect(store.getActiveResponse('/api/user', 'GET')).toEqual({
        status: 200,
        body: { method: 'GET' },
      });
      expect(store.getActiveResponse('/api/user', 'POST')).toEqual({
        status: 422,
        body: { fail: 'post' },
      });
    });

    it('throws when switching a shared endpoint without method', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/get-user.json', 'api/post-user.json'],
      };
      const baseEndpoint = {
        version: 1,
        name: 'User',
        endpoint: '/api/user',
        rules: [{ name: 'success', status: 200, body: {} }],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('get-user.json')) return JSON.stringify({ ...baseEndpoint, method: 'GET' });
        if (p.endsWith('post-user.json')) return JSON.stringify({ ...baseEndpoint, method: 'POST' });
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(() => store.switchRule('/api/user', 'success')).toThrow(/ambiguous.*specify method/i);
    });

    it('throws if endpoint not found', () => {
      expect(() => store.switchRule('/api/nonexistent', 'success')).toThrow(
        /endpoint.*not found/i,
      );
    });

    it('throws if ruleName not found and lists available rules', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/test.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Test',
        method: 'GET',
        endpoint: '/api/test',
        rules: [{ name: 'success', status: 200, body: {} }],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('test.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(() => store.switchRule('/api/test', 'nonexistent')).toThrow(
        /rule "nonexistent" not found.*available: success/i,
      );
    });
  });

  describe('getActiveResponse()', () => {
    it('returns the active rule response for an endpoint', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/test.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Test',
        method: 'GET',
        endpoint: '/api/test',
        rules: [
          { name: 'success', status: 200, delay: 100, headers: { 'Content-Type': 'application/json' }, body: { ok: true } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('test.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const response = store.getActiveResponse('/api/test');
      expect(response).toEqual({
        status: 200,
        delay: 100,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: true },
      });
    });

    it('returns null for unknown endpoint', () => {
      expect(store.getActiveResponse('/api/nope')).toBeNull();
    });
  });
});
