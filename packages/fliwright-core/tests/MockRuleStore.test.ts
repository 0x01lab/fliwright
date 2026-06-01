import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockRuleStore } from '../src/MockRuleStore.js';
import type { MockRule, MockEndpointConfig, MockIndex } from '../src/types.js';
import { readFile } from 'node:fs/promises';

// We'll mock fs/promises at the module level
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);

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

    it('silently skips when mock-index.json does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.listEndpoints()).toEqual([]);
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
