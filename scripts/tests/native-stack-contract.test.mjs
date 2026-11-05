import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateNativeStack } from '../native-stack-contract.mjs';

test('native governance checks imported frameworks, source roster, dependency managers and build settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-stack-'));
  try {
    mkdirSync(join(root, 'runners/Runner.xcodeproj'), { recursive: true });
    const source = join(root, 'runners/Runner.swift');
    const project = join(root, 'runners/Runner.xcodeproj/project.pbxproj');
    writeFileSync(source, 'import XCTest\nimport Foundation\n');
    writeFileSync(project, 'SWIFT_VERSION = 5.0; CODE_SIGNING_ALLOWED = NO;');
    const stack = { nativeProjects: { runners: { sources: ['Runner.swift'], project: 'Runner.xcodeproj/project.pbxproj',
      schemes: [], allowedImports: ['XCTest', 'Foundation'], requiredBuildSettings: { SWIFT_VERSION: '5.0', CODE_SIGNING_ALLOWED: 'NO' } } } };
    assert.deepEqual(validateNativeStack(root, stack), []);
    writeFileSync(source, 'import Appium\n');
    assert.match(validateNativeStack(root, stack).join('\n'), /Appium/);
    writeFileSync(source, 'import XCTest\n');
    writeFileSync(project, 'SWIFT_VERSION = 5.0; CODE_SIGNING_ALLOWED = YES;');
    assert.match(validateNativeStack(root, stack).join('\n'), /CODE_SIGNING_ALLOWED/);
    writeFileSync(project, 'SWIFT_VERSION = 5.0; CODE_SIGNING_ALLOWED = NO; packageReferences = (dependency);');
    assert.match(validateNativeStack(root, stack).join('\n'), /external dependencies/);
    writeFileSync(join(root, 'runners/Extra.swift'), 'import XCTest');
    assert.match(validateNativeStack(root, stack).join('\n'), /source roster/);
    writeFileSync(join(root, 'runners/Podfile'), 'source');
    assert.match(validateNativeStack(root, stack).join('\n'), /Podfile/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('source-only Flutter host fixtures govern imports and reject generated or dependency manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-fixture-stack-'));
  try {
    mkdirSync(join(root, 'fixture'), { recursive: true });
    writeFileSync(join(root, 'fixture/AppDelegate.swift'), 'import Flutter\nimport UIKit\n');
    const stack = { nativeSourceFixtures: { fixture: { sources: ['AppDelegate.swift'], allowedImports: ['Flutter', 'UIKit'] } } };
    assert.deepEqual(validateNativeStack(root, stack), []);
    writeFileSync(join(root, 'fixture/AppDelegate.swift'), 'import UnapprovedCameraSDK\n');
    assert.match(validateNativeStack(root, stack).join('\n'), /UnapprovedCameraSDK/);
    writeFileSync(join(root, 'fixture/AppDelegate.swift'), 'import Flutter\n');
    writeFileSync(join(root, 'fixture/Extra.swift'), 'import UIKit\n');
    assert.match(validateNativeStack(root, stack).join('\n'), /source roster/);
    rmSync(join(root, 'fixture/Extra.swift'));
    writeFileSync(join(root, 'fixture/Podfile'), 'dependency');
    assert.match(validateNativeStack(root, stack).join('\n'), /Podfile/);
    rmSync(join(root, 'fixture/Podfile'));
    mkdirSync(join(root, 'fixture/Runner.xcodeproj'));
    assert.match(validateNativeStack(root, stack).join('\n'), /generated|Xcode/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Android source fixtures govern Java/Kotlin imports and refuse generated Gradle projects', () => {
  const root = mkdtempSync(join(tmpdir(), 'android-fixture-stack-'));
  try {
    mkdirSync(join(root, 'fixture'));
    const source = join(root, 'fixture/MainActivity.java');
    writeFileSync(source, 'package example.app;\nimport android.app.AlertDialog;\nimport io.flutter.embedding.android.FlutterActivity;\n');
    const stack = { nativeSourceFixtures: { fixture: { sources: ['MainActivity.java'], allowedImports: ['android.app.AlertDialog', 'io.flutter.embedding.android.FlutterActivity'] } } };
    assert.deepEqual(validateNativeStack(root, stack), []);
    writeFileSync(source, 'import unapproved.camera.SDK;\n');
    assert.match(validateNativeStack(root, stack).join('\n'), /unapproved.camera.SDK/);
    writeFileSync(source, 'import static unapproved.camera.SDK.open;\n');
    assert.match(validateNativeStack(root, stack).join('\n'), /unapproved.camera.SDK.open/);
    writeFileSync(source, 'package example.app; import unapproved.camera.SDK;\n');
    assert.match(validateNativeStack(root, stack).join('\n'), /unapproved.camera.SDK/);
    writeFileSync(source, 'import android.app.*;\n');
    assert.match(validateNativeStack(root, stack).join('\n'), /android.app.\*/);
    writeFileSync(source, 'import android.app.AlertDialog;\n');
    writeFileSync(join(root, 'fixture/Extra.kt'), 'import unapproved.Camera\n');
    assert.match(validateNativeStack(root, stack).join('\n'), /source roster/);
    assert.match(validateNativeStack(root, stack).join('\n'), /unapproved.Camera/);
    rmSync(join(root, 'fixture/Extra.kt'));
    for (const file of ['build.gradle', 'build.gradle.kts', 'settings.gradle.kts', 'gradle.properties', 'gradlew', 'libs.versions.toml']) {
      writeFileSync(join(root, 'fixture', file), 'generated');
      assert.match(validateNativeStack(root, stack).join('\n'), /Gradle|manifest|generated/i, file);
      rmSync(join(root, 'fixture', file));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
