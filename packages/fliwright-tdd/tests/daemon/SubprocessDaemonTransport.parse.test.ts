import { describe, expect, it } from 'vitest';
import { parseDaemonLines } from '../../src/daemon/SubprocessDaemonTransport.js';

describe('parseDaemonLines', () => {
  it('parses an array-wrapped event line into messages', () => {
    const line = JSON.stringify([{ event: 'daemon.connected', params: { version: '3.x' } }]);

    expect(parseDaemonLines(line)).toEqual([{ event: 'daemon.connected', params: { version: '3.x' } }]);
  });

  it('ignores non-JSON lines', () => {
    expect(parseDaemonLines('not json')).toEqual([]);
  });
});
