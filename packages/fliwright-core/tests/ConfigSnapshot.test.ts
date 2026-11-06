import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { readFliwrightEnvironment, writeFliwrightConfigSnapshot } from '../src/index.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'fliwright-config-snapshot-'));
  roots.push(root);
  return root;
}

describe('configuration snapshots', () => {
  it('round trips large settings through a private absolute path and retains scalar override priority', () => {
    const cacheRoot = temporaryRoot();
    const payload = 'x'.repeat(2 * 1024 * 1024);
    const config = { recording: { mode: 'full' }, scenarios: {
      large: { name: 'large', layers: [{ kind: 'storage', seed: { payload } }] },
    } };
    const file = writeFliwrightConfigSnapshot(config, { cacheRoot });
    expect(isAbsolute(file)).toBe(true);
    expect(readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: file })).toEqual(config);
    expect(readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: file, FLIWRIGHT_RECORDING_MODE: 'off' }).recording?.mode).toBe('off');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('reuses identical snapshots while keeping concurrent run configurations isolated', () => {
    const cacheRoot = temporaryRoot();
    const first = writeFliwrightConfigSnapshot({ recording: { mode: 'off' } }, { cacheRoot });
    const second = writeFliwrightConfigSnapshot({ recording: { mode: 'full' } }, { cacheRoot });
    expect(writeFliwrightConfigSnapshot({ recording: { mode: 'off' } }, { cacheRoot })).toBe(first);
    expect(second).not.toBe(first);
    expect(JSON.parse(readFileSync(first, 'utf8')).recording.mode).toBe('off');
    expect(readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: second }).recording?.mode).toBe('full');
  });

  it('loads a referenced path on demand relative to the supplied project root', () => {
    const projectRoot = temporaryRoot();
    const environment = { FLIWRIGHT_PROJECT_ROOT: projectRoot, FLIWRIGHT_CONFIG_PATH: 'settings.json' };
    expect(() => readFliwrightEnvironment(environment)).toThrow();
    writeFileSync(join(projectRoot, 'settings.json'), JSON.stringify({ paths: { tests: 'checks' } }));
    expect(readFliwrightEnvironment(environment).paths?.tests).toBe('checks');
    writeFileSync(join(projectRoot, 'settings.json'), '{broken');
    expect(() => readFliwrightEnvironment(environment)).toThrow();
  });
});
