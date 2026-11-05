import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepareNativeDemo } from './prepare-native-demo.mjs';

const root = resolve(import.meta.dirname, '..');
const execute = promisify(execFile);

/** Compile owned native fixtures and all published plugins in a disposable mobile app. */
export async function verifyMobileBuild(platform, directory, prepare = prepareNativeDemo, run = execute) {
  if (!['android', 'ios'].includes(platform)) throw new Error('Expected android or ios');
  await prepare({ platform, directory });
  const manifestPath = join(directory, 'pubspec.yaml');
  const manifest = await readFile(manifestPath, 'utf8');
  await writeFile(manifestPath, manifest.replace('dependencies:\n', `dependencies:\n  fliwright_design_qa:\n    path: ${JSON.stringify(join(root, 'packages/fliwright-design-qa'))}\n  fliwright_bridge_riverpod:\n    path: ${JSON.stringify(join(root, 'packages/fliwright-bridge-riverpod'))}\n`)
    + `\ndependency_overrides:\n  fliwright_bridge:\n    path: ${JSON.stringify(join(root, 'packages/fliwright-bridge'))}\n`);
  if (platform === 'android') {
    // The approved plugins require the external Kotlin plugin used by AGP 8.
    // Keep this disposable host on the reviewed toolchain rather than Flutter's moving template.
    const stack = JSON.parse(await readFile(join(root, 'harness/stack/framework.json'), 'utf8'));
    const settingsPath = join(directory, 'android/settings.gradle.kts');
    const settings = await readFile(settingsPath, 'utf8');
    const application = /id\("com\.android\.application"\) version "[^"]+"/;
    const kotlin = /id\("org\.jetbrains\.kotlin\.android"\) version "[^"]+"/;
    if (!application.test(settings) || !kotlin.test(settings)) throw new Error('Unexpected Android toolchain template');
    await writeFile(settingsPath, settings
      .replace(application, `id("com.android.application") version "${stack.ciToolchains.androidGradlePlugin}"`)
      .replace(kotlin, `id("org.jetbrains.kotlin.android") version "${stack.ciToolchains.kotlin}"`));
  }
  const args = platform === 'android' ? ['build', 'apk', '--debug'] : ['build', 'ios', '--simulator', '--debug', '--no-codesign'];
  const result = await run('flutter', [...args, '--target', 'lib/native_fixture_main.dart'], { cwd: directory, timeout: 1200000, maxBuffer: 32 * 1024 * 1024 });
  process.stdout.write(result?.stdout ?? '');
  process.stderr.write(result?.stderr ?? '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const temporary = await mkdtemp(join(tmpdir(), 'fliwright-mobile-compile-'));
  try {
    await verifyMobileBuild(process.argv[2], join(temporary, 'host'));
  } catch (error) {
    console.error(error.stdout ?? '', error.stderr ?? '');
    throw error;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
