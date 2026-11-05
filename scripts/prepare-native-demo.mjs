import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demo = join(repository, 'examples/form_demo');
const execute = promisify(execFile);

/** Generate a disposable mobile host; owned test source stays in the repository. */
export async function prepareNativeDemo(options = {}, run = execute) {
  const platform = options.platform ?? 'ios';
  if (!['ios', 'android'].includes(platform)) throw new Error('Choose the ios or android native fixture platform.');
  const directory = options.directory ? resolve(options.directory) : await mkdtemp(join(tmpdir(), 'fliwright-native-demo-'));
  if (options.directory) await mkdir(directory);
  const flutter = options.flutter ?? 'flutter';
  await run(flutter, ['create', `--platforms=${platform}`, ...(platform === 'android' ? ['--android-language=java'] : []), '--org=dev.fliwright', '--project-name=form_demo', '--no-pub', '.'],
    { cwd: directory, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  await mkdir(join(directory, 'lib'), { recursive: true });
  for (const file of ['native_fixture.dart', 'native_fixture_main.dart']) {
    await cp(join(demo, 'lib', file), join(directory, 'lib', file));
  }
  await cp(join(demo, 'assets'), join(directory, 'assets'), { recursive: true });
  const pubspec = (await readFile(join(demo, 'pubspec.yaml'), 'utf8'))
    .replace('path: ../../packages/fliwright-bridge', `path: ${JSON.stringify(join(repository, 'packages/fliwright-bridge'))}`);
  await writeFile(join(directory, 'pubspec.yaml'), pubspec);
  if (platform === 'ios') {
    await cp(join(demo, 'native_fixtures/ios/AppDelegate.swift'), join(directory, 'ios/Runner/AppDelegate.swift'));
    const debugConfig = join(directory, 'ios/Flutter/Debug.xcconfig');
    await writeFile(debugConfig, `${await readFile(debugConfig, 'utf8')}\nSWIFT_ACTIVE_COMPILATION_CONDITIONS = $(inherited) FLIWRIGHT_NATIVE_FIXTURE\n`);
    const plistPath = join(directory, 'ios/Runner/Info.plist');
    const plist = await readFile(plistPath, 'utf8');
    if (!/<\/dict>\s*<\/plist>\s*$/.test(plist)) throw new Error(`Unexpected generated Info.plist in ${directory}.`);
    await writeFile(plistPath, plist.replace(/<\/dict>\s*<\/plist>\s*$/,
      '<key>NSMicrophoneUsageDescription</key><string>Verify native permission decisions in the Fliwright test fixture.</string>\n</dict>\n</plist>\n'));
  } else {
    await cp(join(demo, 'native_fixtures/android/MainActivity.java'), join(directory, 'android/app/src/main/java/dev/fliwright/form_demo/MainActivity.java'));
    const manifestPath = join(directory, 'android/app/src/main/AndroidManifest.xml');
    const manifest = await readFile(manifestPath, 'utf8');
    if (!/<application\b/.test(manifest)) throw new Error(`Unexpected generated AndroidManifest.xml in ${directory}.`);
    await writeFile(manifestPath, manifest.replace(/<application\b/,
      '<uses-permission android:name="android.permission.CAMERA"/>\n<uses-permission android:name="android.permission.RECORD_AUDIO"/>\n<application'));
  }
  await run(flutter, ['pub', 'get'], { cwd: directory, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  await mkdir(join(directory, '.fliwright/tests'), { recursive: true });
  await cp(join(repository, `e2e/.fliwright/tests/${platform === 'ios' ? 'native-mixed' : 'native-android-mixed'}.test.ts`), join(directory, '.fliwright/tests/native-mixed.test.ts'));
  if (platform === 'ios') {
    await cp(join(repository, 'e2e/.fliwright/tests/native-input.test.ts'), join(directory, '.fliwright/tests/native-input.test.ts'));
  }
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await writeFile(join(directory, 'fliwright.config.ts'), `export { default } from ${JSON.stringify(join(repository, `e2e/native${platform === 'ios' ? '' : '.android'}.project.ts`))};\n`);
  await symlink(join(repository, 'e2e/node_modules'), join(directory, 'node_modules'), 'dir');
  return directory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length % 2 || args.some((value, index) => index % 2 === 0 && !['--output', '--flutter', '--platform'].includes(value))) {
    throw new Error('Usage: node scripts/prepare-native-demo.mjs [--output NEW_DIRECTORY] [--flutter FLUTTER_EXECUTABLE] [--platform ios|android]');
  }
  const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  console.log(await prepareNativeDemo({ directory: options['--output'], flutter: options['--flutter'], platform: options['--platform'] }));
}
