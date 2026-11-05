import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyMobileBuild } from '../verify-mobile-build.mjs';

for (const platform of ['android', 'ios']) test(`compiles ${platform} fixtures against all local plugins without signing`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mobile-compile-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let invoked = false;
  await verifyMobileBuild(platform, directory, async options => {
    assert.equal(options.platform, platform);
    if (platform === 'android') {
      await mkdir(join(directory, 'android'));
      await writeFile(join(directory, 'android/settings.gradle.kts'), 'id("com.android.application") version "9.1.0" apply false\nid("org.jetbrains.kotlin.android") version "2.4.0" apply false');
    }
    await writeFile(join(directory, 'pubspec.yaml'), 'name: fixture\ndependencies:\n  flutter:\n    sdk: flutter\n');
  }, async (command, args, options) => {
    invoked = true;
    assert.equal(command, 'flutter');
    assert.equal(options.cwd, directory);
    assert.ok(args.includes('--debug'));
    assert.equal(args.at(-1), 'lib/native_fixture_main.dart');
    assert.equal(args.includes('--no-codesign'), platform === 'ios');
    if (platform === 'android') assert.match(await readFile(join(directory, 'android/settings.gradle.kts'), 'utf8'), /version "8\.13\.2"/);
    const manifest = await readFile(join(directory, 'pubspec.yaml'), 'utf8');
    assert.match(manifest, /fliwright_design_qa:\n    path:/);
    assert.match(manifest, /fliwright_bridge_riverpod:\n    path:/);
    assert.match(manifest, /dependency_overrides:\n  fliwright_bridge:/);
  });
  assert.ok(invoked);
});

test('rejects unsupported platforms before touching the filesystem', async () => {
  await assert.rejects(verifyMobileBuild('web', '/unused'), /android or ios/);
});
