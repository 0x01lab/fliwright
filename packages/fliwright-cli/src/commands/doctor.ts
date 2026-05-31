import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

export async function doctorCommand(projectDir: string): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  checks.push(await checkNodeVersion());
  checks.push(await checkFlutterSdk());
  checks.push(await checkPackageInstalled('@fliwright/core'));
  checks.push(await checkConfigFile(projectDir));
  checks.push(await checkVmService());

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
    const resolved = import.meta.resolve(`${pkg}/package.json`);
    const url = typeof resolved === 'string' ? resolved : resolved.href;
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
      message: 'not installed (run: pnpm add -D @fliwright/core)',
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

async function checkVmService(): Promise<CheckResult> {
  const { discoverVmServiceUrl } = await import('../vm-discovery.js');
  const url = await discoverVmServiceUrl();
  if (url) {
    return {
      name: 'VM Service',
      passed: true,
      message: `detected at ${url}`,
    };
  }
  return {
    name: 'VM Service',
    passed: false,
    message: 'no Flutter app detected (run `flutter run` to start one)',
  };
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
