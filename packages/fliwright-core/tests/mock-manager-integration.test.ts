import { describe, it, expect } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { createProtocolMock } from './helpers/mockVMService.js';

describe('MockManager Integration', () => {
  it('configureFlutterController() sends the tool mock controller URL through VM Service', async () => {
    const mock = createProtocolMock();
    mock.mockExtension('ext.fliwright.mock.setController', (params: any) => ({
      controllerUrl: params.url,
    }));
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(mock.ws);

    await driver.mock.configureFlutterController('http://127.0.0.1:18080');

    const messages = mock.sentMessages();
    const msg = messages.find((entry) => entry.method === 'ext.fliwright.mock.setController');
    expect(msg).toBeDefined();
    expect(msg!.params).toHaveProperty('isolateId', mock.isolateId);
    expect(msg!.params).toHaveProperty('url', 'http://127.0.0.1:18080');
  });

  it('route() and getCalls() operate on the tool-side mock server', async () => {
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
    expect(await driver.mock.getCalls('/api/users')).toHaveLength(1);
  });
});
