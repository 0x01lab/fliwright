import { pathToFileURL } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { loadConfig, defineConfig, resolveProjectConfig, resolveProjectImport, type FliwrightCliConfig } from '../src/config.js';

describe('defineConfig', () => {
  it('fills defaults for omitted optional fields', () => {
    const config = defineConfig({});
    expect(config.timeout).toBe(30000);
    expect(config.screenshot).toBe('file');
    expect(config.testDir).toBe('.fliwright/tests');
    expect(config.reporter).toBe('pretty');
    expect(config.vmServiceUrl).toBeUndefined();
  });

  it('preserves explicit values', () => {
    const config = defineConfig({
      vmServiceUrl: 'ws://localhost:8181/ws',
      timeout: 60000,
      testDir: 'e2e',
    });
    expect(config.vmServiceUrl).toBe('ws://localhost:8181/ws');
    expect(config.timeout).toBe(60000);
    expect(config.testDir).toBe('e2e');
    expect(config.screenshot).toBe('file');
  });

  it('preserves named scenarios for CLI and MCP consumers', () => {
    const config = defineConfig({
      scenarioMode: 'attach',
      scenarios: {
        guest: { name: 'guest', layers: [{ kind: 'auth', state: 'guest' }] },
      },
    });

    expect(config.scenarioMode).toBe('attach');
    expect(config.scenarios?.guest?.name).toBe('guest');
  });
});

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-config-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig(tmpDir);
    expect(config.testDir).toBe('.fliwright/tests');
    expect(config.reporter).toBe('pretty');
    expect(config.timeout).toBe(30000);
  });

  it('resolves configurable storage from the project file even when started in a child directory', async () => {
    const child = join(tmpDir, 'lib/features');
    await mkdir(child, { recursive: true });
    await writeFile(join(tmpDir, 'fliwright.config.ts'), `export default { runsRoot: 'evidence/runs', cacheRoot: 'scratch' };`);
    expect(await resolveProjectConfig(child, {}, {})).toMatchObject({
      runsRoot: join(tmpDir, 'evidence/runs'), cacheRoot: join(tmpDir, 'scratch'),
    });
    expect(await resolveProjectConfig(child, { runsRoot: 'one-off' }, { FLIWRIGHT_RUNS_ROOT: 'ci-runs' }))
      .toMatchObject({ runsRoot: join(tmpDir, 'one-off'), cacheRoot: join(tmpDir, 'scratch') });
    expect(await resolveProjectConfig(child, {}, { FLIWRIGHT_RUNS_ROOT: 'ci-runs' }))
      .toMatchObject({ runsRoot: join(tmpDir, 'ci-runs'), cacheRoot: join(tmpDir, 'scratch') });
  });

  it('defaults runtime partitions outside the project', async () => {
    expect(await resolveProjectConfig(tmpDir, {}, {})).toMatchObject({
      runsRoot: join(homedir(), '.fliwright', tmpDir.replace(/[/\\]/g, '-'), 'runs'),
      cacheRoot: join(homedir(), '.fliwright', tmpDir.replace(/[/\\]/g, '-'), 'cache'),
      paths: { recordings: join(homedir(), '.fliwright', tmpDir.replace(/[/\\]/g, '-'), 'recordings') },
    });
  });

  it('resolves import-only project dependencies for configs outside the project', async () => {
    await mkdir(join(tmpDir, 'node_modules/import-only'), { recursive: true });
    await writeFile(join(tmpDir, 'node_modules/import-only/package.json'), JSON.stringify({
      name: 'import-only', type: 'module', exports: { './preset': { import: './preset.js' } },
    }));
    await writeFile(join(tmpDir, 'node_modules/import-only/preset.js'), 'export const preset = {};');
    expect(resolveProjectImport('import-only/preset', tmpDir)).toBe(pathToFileURL(await realpath(join(tmpDir, 'node_modules/import-only/preset.js'))).href);
  });

  it('loads values from fliwright.config.ts', async () => {
    await writeFile(join(tmpDir, 'fliwright.config.ts'), [
      "const defineConfig = (o) => o;",
      'export default defineConfig({',
      "  testDir: 'e2e',",
      '  timeout: 60000,',
      '});',
    ].join('\n'));

    const config = await loadConfig(tmpDir);
    expect(config.testDir).toBe('e2e');
    expect(config.timeout).toBe(60000);
  });

  it('derives CLI discovery from shared paths and validates recording settings', async () => {
    await writeFile(join(tmpDir, 'fliwright.config.ts'), `export default { paths: { tests: 'checks' }, recording: { testFinalScreenshots: false } };`);
    expect(await loadConfig(tmpDir)).toMatchObject({ testDir: 'checks', paths: { tests: 'checks' },
      recording: { mode: 'standard', testFinalScreenshots: false, failureCaptureBudgetMs: 3000, testFinalizationBudgetMs: 5000 } });
    await writeFile(join(tmpDir, 'fliwright.config.ts'), `export default { recording: { mode: 'trace' } };`);
    await expect(loadConfig(tmpDir)).rejects.toThrow();
  });
});
