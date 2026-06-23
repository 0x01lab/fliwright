import { describe, expect, it } from 'vitest';
import type { AppHandle, DaemonMessage, DaemonTransport } from '../../src/index.js';

describe('package scaffold', () => {
  it('exports the daemon transport types', () => {
    const transport: DaemonTransport = {
      request: async () => ({}),
      onEvent: () => () => {},
      dispose: async () => {},
    };
    const handle: AppHandle = { appId: 'a', deviceId: 'd', wsUri: 'ws://x', supportsRestart: true };
    const message: DaemonMessage = { event: 'app.started', params: { appId: 'a' } };

    expect(transport).toBeDefined();
    expect(handle.appId).toBe('a');
    expect(message.event).toBe('app.started');
  });
});
