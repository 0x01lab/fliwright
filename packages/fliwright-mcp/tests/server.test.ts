import { describe, expect, it } from 'vitest';
import {
  createFliwrightServer,
  resolveMcpToolProfile,
  type FliwrightMcpToolProfile,
} from '../src/server.js';

function toolNames(profile?: FliwrightMcpToolProfile): string[] {
  const { server } = createFliwrightServer({ toolProfile: profile });
  const registeredTools = (server as unknown as {
    _registeredTools: Record<string, unknown>;
  })._registeredTools;
  return Object.keys(registeredTools).sort();
}

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

  it('uses the compact core tool profile by default', () => {
    const tools = toolNames();

    expect(tools).toHaveLength(15);
    expect(tools).toContain('fliwright_debug_snapshot');
    expect(tools).toContain('fliwright_run');
    expect(tools).not.toContain('fliwright_action');
    expect(tools).not.toContain('fliwright_flow_list');
    expect(tools).not.toContain('fliwright_tdd_start');
  });

  it('adds only the selected specialist tool family', () => {
    const developmentTools = toolNames('development');
    const tddTools = toolNames('tdd');
    const flowTools = toolNames('flow');

    expect(developmentTools).toContain('fliwright_action');
    expect(developmentTools).not.toContain('fliwright_tdd_start');
    expect(developmentTools).not.toContain('fliwright_flow_list');

    expect(tddTools).toContain('fliwright_tdd_start');
    expect(tddTools).toContain('fliwright_devassist_cycle');
    expect(tddTools).not.toContain('fliwright_flow_list');

    expect(flowTools).toContain('fliwright_flow_list');
    expect(flowTools).not.toContain('fliwright_tdd_start');
  });

  it('keeps the complete legacy tool surface behind the full profile', () => {
    const tools = toolNames('full');

    expect(tools).toHaveLength(52);
    expect(tools).toContain('fliwright_action');
    expect(tools).toContain('fliwright_flow_review_run');
    expect(tools).toContain('fliwright_tdd_cycle');
    expect(tools).toContain('fliwright_devassist_cycle');
  });

  it('validates configured tool profiles', () => {
    expect(resolveMcpToolProfile(undefined)).toBe('core');
    expect(resolveMcpToolProfile('tdd')).toBe('tdd');
    expect(() => resolveMcpToolProfile('everything')).toThrow(
      'Unknown Fliwright MCP tool profile',
    );
  });
});
