import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareNativeDemo } from '../prepare-native-demo.mjs';

test('stages governed fixture sources into a fresh host without device actions or workspace scaffolding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stage-native-demo-'));
  const directory = join(root, 'host');
  const calls = [];
  try {
    const staged = await prepareNativeDemo({ directory, flutter: 'owned-flutter' }, async (program, args, options) => {
      calls.push({ program, args });
      assert.equal(options.cwd, directory);
      if (args[0] === 'create') {
        await mkdir(join(directory, 'ios/Runner'), { recursive: true });
        await mkdir(join(directory, 'ios/Flutter'), { recursive: true });
        await writeFile(join(directory, 'ios/Flutter/Debug.xcconfig'), '#include "Generated.xcconfig"\n');
        await writeFile(join(directory, 'ios/Runner/Info.plist'), '<plist><dict><key>CFBundleName</key><string>fixture</string></dict></plist>');
      }
    });
    assert.equal(staged, directory);
    assert.deepEqual(calls.map(call => call.args[0]), ['create', 'pub']);
    assert.ok(calls.every(call => call.program === 'owned-flutter'));
    assert.match(await readFile(join(directory, 'ios/Runner/AppDelegate.swift'), 'utf8'), /requestRecordPermission/);
    assert.match(await readFile(join(directory, 'ios/Runner/Info.plist'), 'utf8'), /NSMicrophoneUsageDescription/);
    assert.match(await readFile(join(directory, 'ios/Flutter/Debug.xcconfig'), 'utf8'), /SWIFT_ACTIVE_COMPILATION_CONDITIONS = \$\(inherited\) FLIWRIGHT_NATIVE_FIXTURE/);
    assert.match(await readFile(join(directory, 'pubspec.yaml'), 'utf8'), /path: "\//);
    assert.match(await readFile(join(directory, 'lib/native_fixture_main.dart'), 'utf8'), /FliwrightBridge.init/);
    assert.match(await readFile(join(directory, '.fliwright/tests/native-mixed.test.ts'), 'utf8'), /scope: 'system'/);
    assert.match(await readFile(join(directory, '.fliwright/tests/native-input.test.ts'), 'utf8'), /native_text_input/);
    assert.match(await readFile(join(directory, 'fliwright.config.ts'), 'utf8'), /native.project.ts/);
    assert.match(await readlink(join(directory, 'node_modules')), /e2e\/node_modules$/);
    await assert.rejects(prepareNativeDemo({ directory }, async () => { throw new Error('must not run'); }), /EEXIST/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stages the Android host with real permission declarations, a debug-only channel and platform-specific tests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stage-native-android-'));
  const directory = join(root, 'host');
  const calls = [];
  try {
    await prepareNativeDemo({ directory, flutter: 'owned-flutter', platform: 'android' }, async (program, args, options) => {
      calls.push({ program, args });
      assert.equal(options.cwd, directory);
      if (args[0] === 'create') {
        await mkdir(join(directory, 'android/app/src/main/java/dev/fliwright/form_demo'), { recursive: true });
        await writeFile(join(directory, 'android/app/src/main/AndroidManifest.xml'), '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="fixture"/></manifest>');
      }
    });
    assert.ok(calls[0].args.includes('--platforms=android'));
    assert.ok(calls[0].args.includes('--android-language=java'));
    const activity = await readFile(join(directory, 'android/app/src/main/java/dev/fliwright/form_demo/MainActivity.java'), 'utf8');
    assert.match(activity, /FLAG_DEBUGGABLE/);
    assert.match(activity, /requestPermissions/);
    assert.match(activity, /checkSelfPermission/);
    const manifest = await readFile(join(directory, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    assert.match(manifest, /android.permission.CAMERA/);
    assert.match(manifest, /android.permission.RECORD_AUDIO/);
    assert.match(await readFile(join(directory, 'fliwright.config.ts'), 'utf8'), /native.android.project.ts/);
    assert.match(await readFile(join(directory, '.fliwright/tests/native-mixed.test.ts'), 'utf8'), /permission_allow_foreground_only_button/);
    assert.deepEqual(calls.map(call => call.args[0]), ['create', 'pub']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects unsupported platform before creating a host or running any tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'invalid-native-platform-'));
  try {
    await assert.rejects(prepareNativeDemo({ directory: join(root, 'host'), platform: 'desktop' }, async () => { throw new Error('must not run'); }), /platform/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
