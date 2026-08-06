import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { WebSocketMockConfigService } from '../src/websocket/WebSocketMockConfigService.js';
import { createWorkspace, readText, writeJson, writeText } from './helpers/workspace.js';

describe('WebSocketMockConfigService', () => {
  it('discovers valid WebSocket mock profiles', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/mocks/websocket/orders.json', profile());

    const result = await new WebSocketMockConfigService().discover(Uri.file(root));

    expect(result?.profiles).toHaveLength(1);
    expect(result?.profiles[0]?.profile.rules[0]).toMatchObject({
      connection: 'public',
      channel: '/topic/orders',
      suppressRemote: true,
    });
  });

  it('keeps malformed profiles visible as invalid files', async () => {
    const root = await createWorkspace();
    await writeText(root, '.fliwright/mocks/websocket/broken.json', '{');

    const result = await new WebSocketMockConfigService().discover(Uri.file(root));

    expect(result?.profiles).toEqual([]);
    expect(result?.invalid[0]).toMatchObject({ label: 'broken.json' });
  });

  it('rejects profiles whose push templates omit payloads', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/mocks/websocket/broken-push.json', {
      version: 1,
      name: 'Broken push',
      rules: [],
      pushes: [{ name: 'Missing payload', connection: 'public', channel: '/topic/orders' }],
    });

    const result = await new WebSocketMockConfigService().discover(Uri.file(root));

    expect(result?.profiles).toEqual([]);
    expect(result?.invalid[0]).toMatchObject({
      label: 'broken-push.json',
      error: expect.stringContaining('payload is required'),
    });
  });

  it('creates a topic-aware profile template in the websocket directory', async () => {
    const root = await createWorkspace();

    const uri = await new WebSocketMockConfigService().createTemplate(Uri.file(root), '../orders');

    expect(uri.fsPath).toContain('.fliwright/mocks/websocket/orders.json');
    expect(await readText(root, '.fliwright/mocks/websocket/orders.json')).toContain('suppressRemote');
  });

  it('creates a replayable profile from an observed inbound call', async () => {
    const root = await createWorkspace();

    await new WebSocketMockConfigService().createProfileFromCall(Uri.file(root), 'snapshot.json', {
      connection: 'public',
      channel: '/topic/market/snapshot',
      direction: 'inbound',
      mockPayload: { event: 'TICK_UPDATE', market: { symbol: 'BTC-USDT' } },
      payload: '{"topic":"/topic/market/snapshot","data":{"ignored":true}}',
    });

    const text = await readText(root, '.fliwright/mocks/websocket/snapshot.json');
    expect(text).toContain('Replay observed message');
    expect(text).toContain('BTC-USDT');
    expect(text).not.toContain('ignored');
  });

  it('does not create a profile from a call without a replayable payload', async () => {
    const root = await createWorkspace();

    await expect(new WebSocketMockConfigService().createProfileFromCall(Uri.file(root), 'missing.json', {
      connection: 'public',
      channel: '/topic/orders',
      direction: 'inbound',
    })).rejects.toThrow('no replayable payload');
  });
});

function profile() {
  return {
    version: 1,
    name: 'Orders',
    rules: [{
      id: 'orders',
      connection: 'public',
      channel: '/topic/orders',
      suppressRemote: true,
      onSubscribe: [{ payload: { id: 'order-1' }, delayMs: 10 }],
    }],
    pushes: [{
      name: 'Order filled',
      connection: 'public',
      channel: '/topic/orders',
      payload: { id: 'order-1', status: 'filled' },
    }],
  };
}
