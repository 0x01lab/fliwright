/**
 * Integration test: FliwrightDriver + RiverpodPlugin → Protocol
 *
 * Exercises the full plugin lifecycle through real PluginRegistry + VMServiceConnector.
 */
import { describe, it, expect } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';
import type { FliwrightPlugin, PluginContext } from '@fliwright/core';
import { riverpodPlugin } from '../src/plugin.js';
import { createProtocolMock } from '../../fliwright-core/tests/helpers/mockVMService.js';

describe('Driver + Riverpod Plugin Integration', () => {
  it('plugin registers adapter and state.read sends correct extension call', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });

    mock.mockExtension('ext.fliwright.riverpod.read', (params: any) => {
      return { value: 42 };
    });

    await driver.attachMockConnector(mock.ws);

    const value = await driver.state.read('counter');
    expect(value).toBe(42);

    const messages = mock.sentMessages();
    const readMsg = messages.find(m => m.method === 'ext.fliwright.riverpod.read');
    expect(readMsg).toBeDefined();
    expect(readMsg!.params).toHaveProperty('provider', 'counter');
    expect(readMsg!.params).toHaveProperty('isolateId', mock.isolateId);
  });

  it('state.override sends serialized value through connector', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });

    let capturedParams: any;
    mock.mockExtension('ext.fliwright.riverpod.override', (params: any) => {
      capturedParams = params;
      return { status: 'ok' };
    });

    await driver.attachMockConnector(mock.ws);

    await driver.state.override('authProvider', { loggedIn: true });

    expect(capturedParams).toBeDefined();
    expect(capturedParams.provider).toBe('authProvider');
    expect(capturedParams.value).toBe(JSON.stringify({ loggedIn: true }));
    expect(capturedParams.isolateId).toBe(mock.isolateId);
  });

  it('state.listProviders returns provider list', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });

    mock.mockExtension('ext.fliwright.riverpod.list', () => ({
      providers: [
        { name: 'counter', type: 'StateProvider', value: 0 },
        { name: 'authProvider', type: 'StateNotifierProvider', value: null },
      ],
    }));

    await driver.attachMockConnector(mock.ws);

    const providers = await driver.state.listProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0].name).toBe('counter');
    expect(providers[1].name).toBe('authProvider');
  });

  it('dispose cleans up without errors', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });

    await driver.attachMockConnector(mock.ws);
    await expect(driver.dispose()).resolves.toBeUndefined();
  });

  it('event pipeline: riverpod state change reaches watch callback', async () => {
    const mock = createProtocolMock();
    const driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });

    mock.mockExtension('ext.fliwright.riverpod.watch', () => ({ status: 'ok' }));
    mock.mockExtension('ext.fliwright.riverpod.unwatch', () => ({ status: 'ok' }));

    await driver.attachMockConnector(mock.ws);

    const changes: Array<{ old: unknown; new: unknown }> = [];
    const unwatch = await driver.state.watch('counter', (oldVal, newVal) => {
      changes.push({ old: oldVal, new: newVal });
    });

    // Simulate a state change event
    mock.emitStreamEvent('riverpod.stateChanged', {
      providerKey: 'counter',
      oldValue: 0,
      newValue: 1,
    });

    // Wait for event processing
    await new Promise(r => setTimeout(r, 50));

    expect(changes).toHaveLength(1);
    expect(changes[0].old).toBe(0);
    expect(changes[0].new).toBe(1);

    // Clean up
    unwatch();
  });
});
