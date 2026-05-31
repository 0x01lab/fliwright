import { describe, it, expect } from 'vitest';
import { createFliwrightServer } from '../src/server.js';

describe('createFliwrightServer', () => {
  it('creates an MCP server instance', () => {
    const { server } = createFliwrightServer();
    expect(server).toBeDefined();
  });

  it('exposes server state', () => {
    const { state } = createFliwrightServer();
    expect(state).toBeDefined();
    expect(state.getLastRunResult()).toBeNull();
  });
});
