import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { FliwrightDriver } from '@fliwright/core';
import { resolveProjectConfig } from '../config.js';
import { resolveVmUrl } from '../vm-discovery.js';

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

export interface DoctorOptions {
  vmServiceUrl?: string;
  print?: boolean;
  signal?: AbortSignal;
}

export async function doctorCommand(
  projectDir: string,
  options: DoctorOptions = {},
): Promise<CheckResult[]> {
  options.signal?.throwIfAborted();
  const checks: CheckResult[] = [];

  checks.push(await checkNodeVersion());
  checks.push(await checkFlutterSdk(options.signal));
  checks.push(await checkPackageInstalled('@fliwright/core'));
  checks.push(await checkPackageInstalled('@fliwright/vitest'));
  checks.push(await checkConfigFile(projectDir));
  checks.push(...await checkRecordingConfiguration(projectDir));
  checks.push(await checkVitestPreset(projectDir, options.signal));
  const vmService = await checkVmService(projectDir, options.vmServiceUrl);
  checks.push(vmService.check);
  checks.push(...await checkRuntimeDiagnostics(vmService.url, options.signal));

  options.signal?.throwIfAborted();
  const output = checks.map((check) => {
    const icon = check.passed ? chalk.green('✅') : chalk.yellow('⚠️ ');
    return `${icon} ${check.name}: ${check.message}`;
  }).join('\n');

  if (options.print !== false) console.log(output);
  return checks;
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.version;
  const [major, minor] = version.slice(1).split('.').map(Number);
  const supported = (major === 22 && minor >= 12) || major === 24 || major >= 26;
  return {
    name: 'Node.js',
    passed: supported,
    message: `${version}${!supported ? ' (requires Node 22.12+, 24.x or >=26)' : ''}`,
  };
}

async function checkFlutterSdk(signal?: AbortSignal): Promise<CheckResult> {
  try {
    const output = await execAsync('flutter', ['--version'], undefined, signal);
    const versionLine = output.split('\n')[0] ?? '';
    return {
      name: 'Flutter SDK',
      passed: true,
      message: versionLine.trim(),
    };
  } catch {
    return {
      name: 'Flutter SDK',
      passed: false,
      message: 'not found (install from https://flutter.dev)',
    };
  }
}

async function checkPackageInstalled(pkg: string): Promise<CheckResult> {
  try {
    const entry = fileURLToPath(import.meta.resolve(pkg));
    const mod = JSON.parse(await readFile(join(dirname(entry), '..', 'package.json'), 'utf8')) as { version?: string };
    const version = mod.version ?? 'unknown';
    return {
      name: pkg,
      passed: true,
      message: `${version} installed`,
    };
  } catch {
    return {
      name: pkg,
      passed: false,
      message: `not installed (run: pnpm add -D ${pkg})`,
    };
  }
}

async function checkConfigFile(projectDir: string): Promise<CheckResult> {
  const configPath = join(projectDir, 'fliwright.config.ts');
  try {
    await stat(configPath);
    return {
      name: 'fliwright.config.ts',
      passed: true,
      message: 'found',
    };
  } catch {
    return {
      name: 'fliwright.config.ts',
      passed: false,
      message: 'not found (run: fliwright init)',
    };
  }
}

async function checkRecordingConfiguration(projectDir: string): Promise<CheckResult[]> {
  try {
    const config = await resolveProjectConfig(projectDir);
    const names = Object.keys(config.scenarios ?? {});
    const environment = ['FLIWRIGHT_CONFIG', 'FLIWRIGHT_RECORDING_MODE', 'FLIWRIGHT_RUNS_ROOT',
      'FLIWRIGHT_SCENARIOS', 'FLIWRIGHT_SCENARIO_MODE'].filter((key) => process.env[key]);
    return [{
      name: 'Recording configuration', passed: true,
      message: `mode=${config.recording.mode}, runsRoot=${config.runsRoot}, cacheRoot=${config.cacheRoot}, scenarios=${names.join(',') || '(none)'}, source=${environment.length ? `environment (${environment.join(',')}) > ` : ''}fliwright.config.ts/defaults`,
    }, {
      name: 'Automation paths', passed: true,
      message: Object.entries(config.paths).map(([key, value]) => `${key}=${value}`).join(', '),
    }];
  } catch (error) {
    return [{ name: 'Recording configuration', passed: false, message: messageOf(error) }];
  }
}

/** Resolve the real config in a bounded subprocess; never collect or execute project tests. */
async function checkVitestPreset(projectDir: string, signal?: AbortSignal): Promise<CheckResult> {
  try {
    const script = `
      import { resolveConfig } from ${JSON.stringify(import.meta.resolve('vitest/node'))};
      const viteConfig = await resolveConfig({ root: ${JSON.stringify(projectDir)} });
      const result = { runner: viteConfig.test?.runner, include: viteConfig.test?.include ?? [],
        env: viteConfig.test?.env, configFile: viteConfig.configFile };
      process.stdout.write('\\nFLIWRIGHT_DOCTOR_CONFIG=' + JSON.stringify(result) + '\\n');
    `;
    const output = await execAsync(process.execPath, ['--input-type=module', '--eval', script], projectDir, signal);
    const line = output.split('\n').find((entry) => entry.startsWith('FLIWRIGHT_DOCTOR_CONFIG='));
    if (!line) throw new Error('Vitest did not return its resolved configuration.');
    const config = JSON.parse(line.slice('FLIWRIGHT_DOCTOR_CONFIG='.length)) as {
      runner?: string; include: string[]; env?: Record<string, string>; configFile?: string;
    };
    const expectedRunner = fileURLToPath(import.meta.resolve('@fliwright/vitest/runner'));
    const passed = config.runner === expectedRunner && Boolean(config.env?.FLIWRIGHT_CONFIG);
    return {
      name: 'Vitest recording preset', passed,
      message: passed
        ? `resolved ${config.configFile}: runner=${config.runner}, include=${config.include.join(', ')}`
        : `Recording lifecycle is not verified for runner=${config.runner ?? '(default)'}. Configure fliwrightPreset(); custom runners must explicitly compose the Fliwright lifecycle and pass runner integration checks.`,
    };
  } catch (error) {
    return { name: 'Vitest recording preset', passed: false, message: messageOf(error) };
  }
}

async function checkVmService(projectDir: string, providedUrl?: string): Promise<{ check: CheckResult; url?: string }> {
  try {
    const config = await resolveProjectConfig(projectDir);
    const url = await resolveVmUrl({ cliFlag: providedUrl, configUrl: config.vmServiceUrl, cwd: projectDir, verify: true });
    return { check: {
      name: 'VM Service', passed: Boolean(url),
      message: url ? 'reachable (using argument > environment > project config > workspace cache > discovery)'
        : 'no Flutter app detected (run `flutter run` to start one)',
    }, url: url ?? undefined };
  } catch (error) {
    return { check: { name: 'VM Service', passed: false, message: messageOf(error) } };
  }
}

const runtimeCheckNames = ['Bridge extensions', 'Recording target capture', 'Recording focused input',
  'Evidence screenshot', 'Evidence snapshot', 'Mock server', 'Riverpod observer'];

async function checkRuntimeDiagnostics(vmServiceUrl?: string, signal?: AbortSignal): Promise<CheckResult[]> {
  signal?.throwIfAborted();
  if (!vmServiceUrl) return runtimeCheckNames.map(skippedRuntimeCheck);
  const driver = new FliwrightDriver();
  const abort = () => { void driver.dispose({ signal: AbortSignal.abort() }).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await driver.connect(toWebSocketUrl(vmServiceUrl));
    return [
      ...await checkBridgeExtensions(driver),
      await checkEvidenceChannel(driver, 'screenshot'),
      await checkEvidenceChannel(driver, 'snapshot'),
      await checkMockServer(driver),
      await checkRiverpodObserver(driver),
    ];
  } catch (error) {
    return runtimeCheckNames.map((name) => ({ name, passed: false,
      message: `could not connect to VM Service: ${messageOf(error)}` }));
  } finally {
    signal?.removeEventListener('abort', abort);
    await driver.dispose(signal?.aborted ? { signal: AbortSignal.abort() } : undefined);
  }
}

async function checkEvidenceChannel(driver: FliwrightDriver, channel: 'screenshot' | 'snapshot'): Promise<CheckResult> {
  try {
    const response = await driver.sendRequest(channel === 'screenshot' ? 'ext.fliwright.screenshot' : 'ext.fliwright.snap', {}) as {
      success?: boolean; screenshot?: string; snapshot?: unknown; error?: string;
    };
    const available = response.success !== false && (channel === 'screenshot'
      ? typeof response.screenshot === 'string' && response.screenshot.length > 0
      : response.snapshot != null);
    return { name: `Evidence ${channel}`, passed: available,
      message: available ? 'capture available' : response.error ?? 'capture returned no evidence' };
  } catch (error) {
    return { name: `Evidence ${channel}`, passed: false, message: messageOf(error) };
  }
}

function skippedRuntimeCheck(name: string): CheckResult {
  return {
    name,
    passed: false,
    message: 'skipped (no VM Service URL)',
  };
}

async function checkBridgeExtensions(driver: FliwrightDriver): Promise<CheckResult[]> {
  try {
    const ping = await driver.sendRequest('ext.fliwright.ping') as { status?: string };
    const handshake = await driver.sendRequest('ext.fliwright.handshake', {
      protocolVersion: '2',
    }) as {
      compatible?: boolean;
      protocolVersion?: number;
      debugMode?: boolean;
      initialized?: boolean;
      bridgeCapabilities?: Record<string, unknown>;
    };
    const passed = ping.status === 'ok' && handshake.compatible === true;
    const targetCapture = handshake.bridgeCapabilities?.recordingBeforeDispatchTarget === true;
    const focusedInput = handshake.bridgeCapabilities?.recordingFocusedInputController === true;
    return [{
      name: 'Bridge extensions', passed,
      message: `protocol=${handshake.protocolVersion}, compatible=${handshake.compatible === true}, initialized=${handshake.initialized === true}, debugMode=${handshake.debugMode === true}`,
    }, {
      name: 'Recording target capture', passed: passed && targetCapture,
      message: targetCapture ? 'before-dispatch target freezing available'
        : 'Install FliwrightRecordingBinding before starting the app to capture targets before dispatch.',
    }, {
      name: 'Recording focused input', passed: passed && focusedInput,
      message: focusedInput ? 'focused controller listener available' : 'bridge does not expose focused input capture',
    }];
  } catch (error) {
    return ['Bridge extensions', 'Recording target capture', 'Recording focused input'].map((name) => ({
      name, passed: false, message: messageOf(error),
    }));
  }
}

async function checkMockServer(driver: FliwrightDriver): Promise<CheckResult> {
  try {
    const state = await driver.sendRequest('ext.fliwright.mock.debugState') as {
      serverPort?: number;
      routes?: unknown[];
      routeCount?: number;
    };
    return {
      name: 'Mock server',
      passed: true,
      message: `reachable (port=${state.serverPort ?? 'n/a'}, routes=${state.routeCount ?? state.routes?.length ?? 'n/a'})`,
    };
  } catch (error) {
    return {
      name: 'Mock server',
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkRiverpodObserver(driver: FliwrightDriver): Promise<CheckResult> {
  try {
    const status = await driver.sendRequest('ext.fliwright.riverpod.status') as {
      observerInstalled?: boolean;
      containerReady?: boolean;
      providerCount?: number;
    };
    return {
      name: 'Riverpod observer',
      passed: status.observerInstalled === true || status.containerReady === true,
      message: `observerInstalled=${status.observerInstalled === true}, containerReady=${status.containerReady === true}, providers=${status.providerCount ?? 0}`,
    };
  } catch (error) {
    return {
      name: 'Riverpod observer',
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function toWebSocketUrl(url: string): string {
  const converted = url
    .replace('http://', 'ws://')
    .replace('https://', 'wss://');
  return converted.endsWith('/ws') ? converted : converted.replace(/\/?$/, '/ws');
}

function execAsync(command: string, args: string[], cwd?: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000, cwd, signal }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
