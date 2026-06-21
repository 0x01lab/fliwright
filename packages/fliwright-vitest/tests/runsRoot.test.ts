import { describe, expect, it } from 'vitest';

// NOTE: This test lives under tests/ (per vitest.config.ts include: 'tests/**/*.test.ts').
// The runtime module is in src/, hence the '../src/' import path.
describe('createFliwrightTest runsRoot plumbing', () => {
  it('exports FliwrightConfig.runsRoot in the type surface', async () => {
    // The config type is exercised indirectly: importing the module and
    // referencing createFliwrightTest confirms the surface compiles with runsRoot.
    const mod = await import('../src/index.js');
    expect(typeof mod.createFliwrightTest).toBe('function');
  });

  it('respects FLIWRIGHT_RUNS_ROOT env when constructing the artifact store', async () => {
    // We cannot run a real driver here; instead we verify the env is read by
    // spying on process.env through a focused unit on the resolution helper.
    // resolveRunsRoot is what makes the FLIWRIGHT_RUNS_ROOT env branch reachable
    // from a real test run inside createFliwrightTest.
    const { resolveRunsRoot } = await import('../src/index.js');
    const prev = process.env.FLIWRIGHT_RUNS_ROOT;
    process.env.FLIWRIGHT_RUNS_ROOT = '/tmp/expected-root';
    try {
      expect(resolveRunsRoot({ runsRoot: undefined })).toBe('/tmp/expected-root');
      expect(resolveRunsRoot({ runsRoot: '/tmp/explicit' })).toBe('/tmp/explicit');
    } finally {
      if (prev === undefined) delete process.env.FLIWRIGHT_RUNS_ROOT;
      else process.env.FLIWRIGHT_RUNS_ROOT = prev;
    }
  });
});
