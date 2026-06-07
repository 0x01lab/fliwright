import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import { FliwrightDriver } from '@fliwright/core';

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

export interface DoctorOptions {
  vmServiceUrl?: string;
}

export async function doctorCommand(
  projectDir: string,
  options: DoctorOptions = {},
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  checks.push(await checkNodeVersion());
  checks.push(await checkFlutterSdk());
  checks.push(await checkPackageInstalled('@fliwright/core'));
  checks.push(await checkPackageInstalled('@fliwright/vitest'));
  checks.push(await checkConfigFile(projectDir));
  const vmService = await checkVmService(options.vmServiceUrl);
  checks.push(vmService.check);
  checks.push(...await checkRuntimeDiagnostics(vmService.url));

  const output = checks.map((check) => {
    const icon = check.passed ? chalk.green('✅') : chalk.yellow('⚠️ ');
    return `${icon} ${check.name}: ${check.message}`;
  }).join('\n');

  console.log(output);
  return checks;
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.version;
  const major = Number.parseInt(version.slice(1).split('.')[0], 10);
  return {
    name: 'Node.js',
    passed: major >= 18,
    message: `${version}${major < 18 ? ' (requires >= 18)' : ''}`,
  };
}

async function checkFlutterSdk(): Promise<CheckResult> {
  try {
    const output = await execAsync('flutter', ['--version']);
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
    const url = import.meta.resolve(`${pkg}/package.json`);
    const { default: mod } = await import(url, { assert: { type: 'json' } });
    const version = (mod as { version?: string })?.version ?? 'unknown';
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

async function checkVmService(providedUrl?: string): Promise<{
  check: CheckResult;
  url?: string;
}> {
  if (providedUrl) {
    return {
      check: {
        name: 'VM Service',
        passed: true,
        message: `provided at ${providedUrl}`,
      },
      url: providedUrl,
    };
  }
  const { discoverVmServiceUrl } = await import('../vm-discovery.js');
  const url = await discoverVmServiceUrl();
  if (url) {
    return {
      check: {
        name: 'VM Service',
        passed: true,
        message: `detected at ${url}`,
      },
      url,
    };
  }
  return {
    check: {
      name: 'VM Service',
      passed: false,
      message: 'no Flutter app detected (run `flutter run` to start one)',
    },
  };
}

async function checkRuntimeDiagnostics(vmServiceUrl?: string): Promise<CheckResult[]> {
  if (!vmServiceUrl) {
    return [
      skippedRuntimeCheck('Bridge extensions'),
      skippedRuntimeCheck('Mock server'),
      skippedRuntimeCheck('Riverpod observer'),
    ];
  }

  const driver = new FliwrightDriver();
  try {
    await driver.connect(toWebSocketUrl(vmServiceUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        name: 'Bridge extensions',
        passed: false,
        message: `could not connect to VM Service: ${message}`,
      },
      skippedRuntimeCheck('Mock server'),
      skippedRuntimeCheck('Riverpod observer'),
    ];
  }

  try {
    return [
      await checkBridgeExtensions(driver),
      await checkMockServer(driver),
      await checkRiverpodObserver(driver),
    ];
  } finally {
    await driver.dispose();
  }
}

function skippedRuntimeCheck(name: string): CheckResult {
  return {
    name,
    passed: false,
    message: 'skipped (no VM Service URL)',
  };
}

async function checkBridgeExtensions(driver: FliwrightDriver): Promise<CheckResult> {
  try {
    const ping = await driver.sendRequest('ext.fliwright.ping') as { status?: string };
    const handshake = await driver.sendRequest('ext.fliwright.handshake', {
      protocolVersion: '1',
    }) as {
      compatible?: boolean;
      protocolVersion?: number;
      debugMode?: boolean;
      initialized?: boolean;
    };
    const passed = ping.status === 'ok' && handshake.compatible === true;
    return {
      name: 'Bridge extensions',
      passed,
      message: passed
        ? `installed (protocol ${handshake.protocolVersion}, debugMode=${handshake.debugMode}, initialized=${handshake.initialized})`
        : 'bridge ping/handshake did not return compatible status',
    };
  } catch (error) {
    return {
      name: 'Bridge extensions',
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    };
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

function execAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}
