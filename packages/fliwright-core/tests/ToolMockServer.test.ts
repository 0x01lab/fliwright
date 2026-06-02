import { describe, expect, it } from 'vitest';
import { ToolMockServer } from '../src/ToolMockServer.js';

describe('ToolMockServer', () => {
  it('matches registered routes and records calls', () => {
    const server = new ToolMockServer({ passthrough: false });
    server.route('/api/users', {
      method: 'GET',
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: [{ id: 1 }],
    });

    const result = server.handleMockRequest({
      method: 'GET',
      url: 'https://dev.ex.io/api/users?x=1',
      path: '/api/users',
      headers: { authorization: 'Bearer token' },
    });

    expect(result).toEqual({
      matched: true,
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: [{ id: 1 }],
      delay: undefined,
    });
    expect(server.getCalls('/api/users')).toHaveLength(1);
  });

  it('returns passthrough for unmatched requests when enabled', () => {
    const server = new ToolMockServer({ passthrough: true });
    const result = server.handleMockRequest({
      method: 'GET',
      url: 'https://dev.ex.io/api/missing',
      path: '/api/missing',
    });

    expect(result.matched).toBe(false);
    expect(result.passthrough).toBe(true);
  });

  it('reports method mismatch when the path exists for another method', () => {
    const server = new ToolMockServer({ passthrough: true });
    server.route('/api/user/info', { method: 'GET', status: 200, body: { ok: true } });

    const result = server.handleMockRequest({
      method: 'POST',
      url: 'https://dev.ex.io/api/user/info',
      path: '/api/user/info',
    });

    expect(result.matched).toBe(false);
    expect(result.passthrough).toBe(true);
    expect(result.reason).toBe('method_mismatch');
    expect(result.candidates).toEqual([{ method: 'GET', path: '/api/user/info' }]);
    expect(result.body).toEqual({
      error: 'Mock route path matched but method did not',
      method: 'POST',
      path: '/api/user/info',
      candidates: [{ method: 'GET', path: '/api/user/info' }],
    });
  });

  it('replaces routes by method and path', () => {
    const server = new ToolMockServer();
    server.route('/api/ping', { method: 'GET', status: 200, body: { version: 1 } });
    server.route('/api/ping', { method: 'GET', status: 201, body: { version: 2 } });

    expect(server.listRoutes()).toHaveLength(1);
    const result = server.handleMockRequest({
      method: 'GET',
      url: 'https://dev.ex.io/api/ping',
      path: '/api/ping',
    });
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ version: 2 });
  });

  it('removes routes by method and path when method is provided', () => {
    const server = new ToolMockServer();
    server.route('/api/user', { method: 'GET', status: 200 });
    server.route('/api/user', { method: 'POST', status: 201 });

    server.removeRoute('/api/user', 'GET');

    expect(server.listRoutes()).toEqual([
      expect.objectContaining({ method: 'POST', path: '/api/user' }),
    ]);
  });
});
