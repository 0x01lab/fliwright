import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { packageCodexPlugin, verifyCodexReleaseTag } from '../release-codex-plugin.mjs';

test('requires an exact Codex tag and distinguishes prereleases from build metadata', () => {
  for (const [version, prerelease] of [['1.2.3', false], ['1.2.3+codex.20261105', false], ['1.2.3-rc.1+build.2', true]]) {
    const manifest = { name: 'fliwright', version };
    assert.deepEqual(verifyCodexReleaseTag(manifest, `codex-v${version}`), { version, prerelease });
    for (const tag of [undefined, `v${version}`, 'codex-v9.9.9', `codex-v${version}\n`]) {
      assert.throws(() => verifyCodexReleaseTag(manifest, tag), /does not match/);
    }
  }
  for (const version of ['../1.2.3', '01.2.3', '1.2', '1.2.3-01', '1.2.3\n']) {
    assert.throws(() => verifyCodexReleaseTag({ name: 'fliwright', version }, `codex-v${version}`), /strict semver/);
  }
  assert.throws(() => verifyCodexReleaseTag({ name: 'other', version: '1.2.3' }, 'codex-v1.2.3'), /manifest/);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'codex-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pluginRoot = join(root, 'plugins/fliwright');
  mkdirSync(join(pluginRoot, '.codex-plugin'), { recursive: true });
  mkdirSync(join(pluginRoot, 'skills/example'), { recursive: true });
  writeFileSync(join(pluginRoot, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'fliwright', version: '1.2.3' }));
  writeFileSync(join(pluginRoot, 'skills/example/SKILL.md'), 'Example skill\n');
  writeFileSync(join(root, 'unrelated.txt'), 'Repository-only file');
  return { root, pluginRoot, output: join(root, 'release') };
}

test('release archive extracts the hidden manifest and Skills with a matching SHA-256 checksum', (t) => {
  const { root, output } = fixture(t);
  const release = packageCodexPlugin(root, output, 'codex-v1.2.3');
  assert.equal(basename(release.archive), 'fliwright-codex-1.2.3.tar.gz');
  const extracted = join(root, 'extracted');
  mkdirSync(extracted);
  execFileSync('tar', ['-xzf', release.archive, '-C', extracted]);
  assert.deepEqual(JSON.parse(readFileSync(join(extracted, '.codex-plugin/plugin.json'), 'utf8')), { name: 'fliwright', version: '1.2.3' });
  assert.equal(readFileSync(join(extracted, 'skills/example/SKILL.md'), 'utf8'), 'Example skill\n');
  assert.deepEqual(readdirSync(extracted).sort(), ['.codex-plugin', 'skills']);
  const digest = createHash('sha256').update(readFileSync(release.archive)).digest('hex');
  assert.equal(readFileSync(release.checksum, 'utf8'), `${digest}  ${basename(release.archive)}\n`);
});

test('rejects mismatched versions and output inside the bundle before creating artifacts', (t) => {
  const { root, pluginRoot, output } = fixture(t);
  assert.throws(() => packageCodexPlugin(root, output, 'codex-v9.9.9'), /does not match/);
  assert.throws(() => readdirSync(output), { code: 'ENOENT' });
  assert.throws(() => packageCodexPlugin(root, join(pluginRoot, 'release'), 'codex-v1.2.3'), /outside/);
});
