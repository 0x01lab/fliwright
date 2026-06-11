import { describe, it, expect } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { createProtocolMock } from './helpers/mockVMService.js';

describe('MockManager Integration', () => {
  it('configureFlutterController() syncs passthrough without a tool controller URL', async () => {
    const mock = createProtocolMock();
    mock.mockExtension('ext.fliwright.mock.setPassthrough', (params: any) => ({
      passthrough: params.enabled === 'true',
    }));
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(mock.ws);

    await driver.mock.configureFlutterController('http://127.0.0.1:18080');

    const messages = mock.sentMessages();
    const msg = messages.find((entry) => entry.method === 'ext.fliwright.mock.setPassthrough');
    expect(msg).toBeDefined();
    expect(msg!.params).toHaveProperty('isolateId', mock.isolateId);
    expect(msg!.params).toHaveProperty('enabled', 'true');
    expect(messages.some((entry) => entry.method === 'ext.fliwright.mock.setController')).toBe(false);
  });

  it('route() syncs Flutter store and keeps a local mirror for tool-side inspection', async () => {
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(createProtocolMock().ws);

    await driver.mock.route('/api/users', {
      method: 'GET',
      status: 200,
      body: [{ id: 1, name: 'Test' }],
    });

    const result = driver.mock['_server'].handleMockRequest({
      method: 'GET',
      url: 'https://dev.ex.io/api/users',
      path: '/api/users',
    });

    expect(result.matched).toBe(true);
    expect(result.body).toEqual([{ id: 1, name: 'Test' }]);
    expect(driver.mock['_server'].getCalls('/api/users')).toHaveLength(1);
  });
});
