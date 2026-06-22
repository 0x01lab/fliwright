import { describe, expect, it } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { createProtocolMock } from './helpers/mockVMService.js';

describe('AppInstance', () => {
  it('reads app info through the bridge app extension', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.app.info', (params) => {
      expect(params.isolateId).toBe(protocol.isolateId);
      return {
        id: 'exio',
        name: 'Exio',
        environment: 'dev',
        capabilities: ['auth', 'exio.account'],
      };
    });
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    const info = await driver.app.info();

    expect(info).toEqual({
      id: 'exio',
      name: 'Exio',
      environment: 'dev',
      capabilities: ['auth', 'exio.account'],
    });
  });

  it('reads app snapshots without assuming business-specific fields', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.app.snapshot', () => ({
      id: 'shop',
      capabilities: ['auth'],
      snapshot: {
        route: '/checkout',
        auth: { isAuthenticated: true, userId: 'u_1' },
        cart: { items: 2 },
      },
    }));
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    const snapshot = await driver.app.getSnapshot<{
      route: string;
      auth: { isAuthenticated: boolean; userId: string };
      cart: { items: number };
    }>();

    expect(snapshot.snapshot.route).toBe('/checkout');
    expect(snapshot.snapshot.auth.userId).toBe('u_1');
    expect(snapshot.snapshot.cart.items).toBe(2);
  });

  it('lists and invokes capabilities with JSON input', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.app.capabilities', () => ({
      capabilities: [
        { name: 'auth', description: 'Authentication state', methods: ['getStatus'] },
      ],
    }));
    protocol.mockExtension('ext.fliwright.app.invoke', (params) => {
      expect(params.capability).toBe('auth');
      expect(params.method).toBe('getStatus');
      expect(JSON.parse(params.input)).toEqual({ refresh: true });
      return {
        success: true,
        result: { isAuthenticated: true, userId: 'u_1' },
      };
    });
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    await expect(driver.app.listCapabilities()).resolves.toEqual([
      { name: 'auth', description: 'Authentication state', methods: ['getStatus'] },
    ]);
    await expect(
      driver.app.invoke('auth', 'getStatus', { refresh: true }),
    ).resolves.toEqual({ isAuthenticated: true, userId: 'u_1' });
  });

  it('returns undefined for missing capabilities', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.app.info', () => ({
      id: 'plain-app',
      capabilities: [],
    }));
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    await expect(driver.app.getCapability('auth')).resolves.toBeUndefined();
  });

  it('maps typed capability methods to bridge invocation', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.app.info', () => ({
      id: 'exio',
      capabilities: ['auth'],
    }));
    protocol.mockExtension('ext.fliwright.app.invoke', (params) => {
      expect(params.capability).toBe('auth');
      expect(params.method).toBe('getStatus');
      return {
        success: true,
        result: { isAuthenticated: true, userId: 'u_1' },
      };
    });
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    const auth = await driver.app.getCapability<{
      getStatus(): Promise<{ isAuthenticated: boolean; userId?: string }>;
    }>('auth');

    await expect(auth?.getStatus()).resolves.toEqual({
      isAuthenticated: true,
      userId: 'u_1',
    });
  });

  it('throws when a capability invocation returns an extension error payload', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.app.invoke', () => ({
      success: false,
      error: 'Capability "auth" is not registered',
    }));
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    await expect(driver.app.invoke('auth', 'getStatus')).rejects.toThrow(
      'Capability "auth" is not registered',
    );
  });
});
