import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineSupportSettings, loadSupportSettings, mergeFliwrightConfig, readFliwrightEnvironment, readSupportSettings,
  saveSupportSettings, writeFliwrightConfigSnapshot } from '../src/index.js';

const settings = defineSupportSettings({
  id: 'navigation', title: 'Navigation', fields: {
    route: { type: 'string', label: 'Route', default: '/home', env: 'TEST_ROUTE' },
    timeout: { type: 'number', label: 'Timeout', default: 5, integer: true, min: 0, env: 'TEST_TIMEOUT' },
    wait: { type: 'boolean', label: 'Wait', default: true, env: 'TEST_WAIT' },
    mode: { type: 'select', label: 'Mode', required: true, options: [{ value: 'local', label: 'Local' }, { value: 'test', label: 'Test' }] },
  },
});

describe('support settings', () => {
  let directory: string;
  let projectRoot: string;
  let options: { projectRoot: string; env: NodeJS.ProcessEnv; homeDir: string };

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'fliwright-support-settings-')));
    projectRoot = join(directory, 'project');
    await mkdir(projectRoot);
    await writeFile(join(projectRoot, 'fliwright.config.ts'), 'export default {}');
    options = { projectRoot, env: {}, homeDir: join(directory, 'home') };
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('loads changes lazily and resolves each field by precedence, preserving falsy values', async () => {
    const empty = await loadSupportSettings(settings, options);
    expect(empty).toMatchObject({ revision: null, values: {}, issues: {} });
    expect(empty.file).toMatch(/[/\\]\.fliwright[/\\].+[/\\]support-settings[/\\][a-f0-9]+[/\\]navigation\.json$/);
    await expect(readSupportSettings(settings, options)).rejects.toMatchObject({
      code: 'missing-field', field: 'mode', supportId: 'navigation', file: empty.file,
      message: `Missing required support setting "mode" for support "navigation". Local settings file ${empty.file}.`,
    });
    const saved = await saveSupportSettings(settings, { revision: null, changes: { route: '', timeout: 0, wait: false, mode: 'local' } }, options);
    expect(JSON.parse(await readFile(saved.file, 'utf8'))).toEqual({ version: 1, values: { route: '', timeout: 0, wait: false, mode: 'local' } });
    if (process.platform !== 'win32') expect((await stat(saved.file)).mode & 0o777).toBe(0o600);
    await expect(readSupportSettings(settings, options)).resolves.toEqual({ route: '', timeout: 0, wait: false, mode: 'local' });
    await expect(readSupportSettings(settings, { ...options, env: { TEST_ROUTE: '/environment', TEST_WAIT: 'true', TEST_TIMEOUT: '1e2' },
      overrides: { wait: false, mode: 'test' } })).resolves.toEqual({ route: '/environment', timeout: 100, wait: false, mode: 'test' });
    await expect(readSupportSettings(settings, { ...options, env: { TEST_TIMEOUT: 'not-a-number' } })).rejects.toMatchObject({
      code: 'invalid-field', field: 'timeout', message: expect.stringContaining('environment variable TEST_TIMEOUT'),
    });
    await saveSupportSettings(settings, { revision: saved.revision, changes: { timeout: null } }, options);
    await expect(readSupportSettings(settings, options)).resolves.toMatchObject({ timeout: 5, mode: 'local' });
  });

  it('serializes competing writers and preserves the successful edit', async () => {
    const save = (mode: 'local' | 'test') => saveSupportSettings(settings, { revision: null, changes: { mode } }, options);
    const results = await Promise.allSettled([save('local'), save('test')]);
    const success = results.filter(result => result.status === 'fulfilled');
    expect(success).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } });
    expect((await loadSupportSettings(settings, options)).values).toEqual(success[0].value.values);
  });

  it('finds nested projects and aliases while isolating projects sharing a runtime root', async () => {
    const nested = join(projectRoot, 'tests', 'nested');
    const alias = join(directory, 'alias');
    const other = join(directory, 'second');
    await mkdir(nested, { recursive: true });
    await mkdir(other);
    await writeFile(join(other, 'fliwright.config.ts'), 'export default {}');
    await symlink(projectRoot, alias, 'junction');
    const env = { FLIWRIGHT_RUNTIME_ROOT: join(directory, 'shared') };
    const first = await saveSupportSettings(settings, { revision: null, changes: { mode: 'local' } }, { projectRoot, env });
    const second = await saveSupportSettings(settings, { revision: null, changes: { mode: 'test' } }, { projectRoot: other, env });
    expect(first.file).not.toBe(second.file);
    await expect(readSupportSettings(settings, { env: { ...env, FLIWRIGHT_PROJECT_ROOT: nested } })).resolves.toMatchObject({ mode: 'local' });
    await expect(readSupportSettings(settings, { projectRoot: join(alias, 'tests'), env: { ...env, FLIWRIGHT_PROJECT_ROOT: other } }))
      .resolves.toMatchObject({ mode: 'local' });
  });

  it('reports invalid old values and keeps unrelated stored values across edits', async () => {
    const { file } = await saveSupportSettings(settings, { revision: null, changes: { mode: 'local' } }, options);
    await writeFile(file, JSON.stringify({ version: 1, values: { mode: 'local', timeout: 'obsolete', removed: true } }));
    const loaded = await loadSupportSettings(settings, options);
    expect(loaded.values).not.toHaveProperty('removed');
    expect(loaded.issues).toHaveProperty('timeout', 'Enter a finite number.');
    await expect(readSupportSettings(settings, options)).rejects.toMatchObject({ code: 'invalid-field', field: 'timeout' });
    await expect(readSupportSettings(settings, { ...options, overrides: { timeout: 0 } })).resolves.toMatchObject({ timeout: 0 });
    await saveSupportSettings(settings, { revision: loaded.revision, changes: { timeout: null } }, options);
    expect(JSON.parse(await readFile(file, 'utf8')).values).toEqual({ mode: 'local', removed: true });
    await writeFile(file, '{"version":2}');
    await expect(loadSupportSettings(settings, options)).rejects.toMatchObject({ code: 'storage' });
    await expect(saveSupportSettings(settings, { revision: null, changes: { timeout: 1 } }, options)).rejects.toMatchObject({ code: 'storage' });
    expect(await readFile(file, 'utf8')).toBe('{"version":2}');
  });

  it('validates declaration locations and stores declaration metadata in config snapshots', async () => {
    expect(() => mergeFliwrightConfig({ project: { supportSettings: [settings, settings] } })).toThrow('Duplicate support ID');
    expect(() => defineSupportSettings({ ...settings, id: '../bad' })).toThrow();
    expect(() => defineSupportSettings({ ...settings, fields: { bad: { type: 'number', label: 'Bad', min: 1, default: 0 } } }))
      .toThrow('greater than or equal to 1');
    expect(() => defineSupportSettings({ ...settings, fields: { bad: { type: 'select', label: 'Bad',
      options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] } } })).toThrow('unique option values');
    await saveSupportSettings(settings, { revision: null, changes: { route: '/local-only' } }, options);
    const file = writeFliwrightConfigSnapshot({ supportSettings: [settings] }, { projectRoot, cacheRoot: join(directory, 'cache') });
    expect(await readFile(file, 'utf8')).not.toContain('/local-only');
    expect(readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: file }).supportSettings).toEqual([settings]);
  });
});
