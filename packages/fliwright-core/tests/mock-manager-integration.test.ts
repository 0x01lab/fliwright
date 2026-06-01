/**
 * Integration test: MockManager through Driver → VMServiceConnector → Protocol
 *
 * Verifies that MockManager calls go through the real connector,
 * include correct isolateId, and produce valid JSON-RPC.
 */
import { describe, it, expect } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { createProtocolMock } from './helpers/mockVMService.js';

describe('MockManager Integration', () => {
  it('route() sends correct JSON-RPC through real connector', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(mock.ws);

    await driver.mock.route('/api/users', {
      method: 'GET',
      status: 200,
      body: [{ id: 1, name: 'Test' }],
    });

    const messages = mock.sentMessages();
    // Should have getVM + ext.fliwright.mock.addRoute
    const addRoute = messages.find(m => m.method === 'ext.fliwright.mock.addRoute');
    expect(addRoute).toBeDefined();
    expect(addRoute!.params).toHaveProperty('isolateId', mock.isolateId);
    expect(addRoute!.params!.route).toBeDefined();

    const routeConfig = JSON.parse(addRoute!.params!.route as string);
    expect(routeConfig.path).toBe('/api/users');
    expect(routeConfig.method).toBe('GET');
    expect(routeConfig.response.status).toBe(200);
  });

  it('removeRoute() + clear() send correct methods', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(mock.ws);

    await driver.mock.route('/api/test', { status: 200 });
    await driver.mock.removeRoute('/api/test');
    await driver.mock.clear();

    const messages = mock.sentMessages();
    expect(messages.find(m => m.method === 'ext.fliwright.mock.removeRoute')).toBeDefined();
    expect(messages.find(m => m.method === 'ext.fliwright.mock.clearRoutes')).toBeDefined();

    const removeMsg = messages.find(m => m.method === 'ext.fliwright.mock.removeRoute')!;
    expect(removeMsg.params).toHaveProperty('path', '/api/test');
    expect(removeMsg.params).toHaveProperty('isolateId', mock.isolateId);
  });

  it('getCalls() returns data from mock extension', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver();

    mock.mockExtension('ext.fliwright.mock.getCalls', () => ({
      calls: [
        { method: 'GET', path: '/api/users', headers: {}, body: '', timestamp: '2026-01-01T00:00:00Z' },
      ],
    }));

    await driver.attachMockConnector(mock.ws);

    const calls = await driver.mock.getCalls('/api/users');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/api/users');
  });

  it('setPassthrough() sends correct params', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(mock.ws);

    await driver.mock.setPassthrough(true);

    const messages = mock.sentMessages();
    const msg = messages.find(m => m.method === 'ext.fliwright.mock.setPassthrough');
    expect(msg).toBeDefined();
    expect(msg!.params).toHaveProperty('enabled', 'true');
    expect(msg!.params).toHaveProperty('isolateId', mock.isolateId);
  });
});
