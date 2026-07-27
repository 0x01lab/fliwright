import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_REDIRECTS = 5;

export async function resolveDesignQaVmServiceUrl(value, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;
  let url = parseVmServiceUrl(value);

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return toWebSocketUrl(url);
  }

  for (let attempt = 0; attempt < MAX_REDIRECTS; attempt += 1) {
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    const location = response.headers.get('location');
    if (!isRedirect(response.status) || !location) {
      return toWebSocketUrl(url);
    }

    url = ensureWebSocketPath(new URL(location, url));
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      return toWebSocketUrl(url);
    }
  }

  throw new Error(`VM Service URL redirected more than ${MAX_REDIRECTS} times.`);
}

export function parseArguments(args) {
  const options = { capture: false, openPairing: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--capture') {
      options.capture = true;
      continue;
    }
    if (argument === '--open-pairing') {
      options.openPairing = true;
      continue;
    }
    if (argument === '--vm-url') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --vm-url.');
      options.vmUrl = value;
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

export function buildSmokeEnvironment(environment, vmServiceUrl, capture, openPairing) {
  return {
    ...environment,
    FLIWRIGHT_VM_SERVICE_URL: vmServiceUrl,
    FLIWRIGHT_VM_URL: vmServiceUrl,
    ...(capture ? { FLIWRIGHT_DESIGN_QA_CAPTURE: '1' } : {}),
    ...(openPairing ? { FLIWRIGHT_DESIGN_QA_OPEN_PAIRING: '1' } : {}),
  };
}

export async function main({ args = process.argv.slice(2), environment = process.env } = {}) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }

  const inputUrl = options.vmUrl
    ?? environment.FLIWRIGHT_VM_SERVICE_URL
    ?? environment.FLIWRIGHT_VM_URL;
  if (!inputUrl) {
    throw new Error(
      'Missing VM Service URL. Pass --vm-url <Flutter DDS or VM URL>, or set FLIWRIGHT_VM_SERVICE_URL.',
    );
  }

  const vmServiceUrl = await resolveDesignQaVmServiceUrl(inputUrl);
  console.log(`[Design QA] Using VM Service: ${vmServiceUrl}`);
  if (!environment.FLIWRIGHT_DESIGN_QA_QR_PAYLOAD) {
    console.log('[Design QA] No QR payload supplied: extension availability will be checked, pairing is skipped.');
  }

  await runCommand('pnpm', ['--filter', '@fliwright/e2e-tests', 'test:design-qa'], {
    env: buildSmokeEnvironment(environment, vmServiceUrl, options.capture, options.openPairing),
  });
}

function parseVmServiceUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error('VM Service URL is empty.');

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('VM Service URL must use http(s) or ws(s).');
  }

  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !url.host) {
    throw new Error('VM Service URL must use http(s) or ws(s) and include a host.');
  }
  url.hash = '';
  return ensureWebSocketPath(url);
}

function ensureWebSocketPath(url) {
  const normalized = new URL(url);
  const path = normalized.pathname.replace(/\/+$/, '');
  normalized.pathname = path.endsWith('/ws') ? path : `${path || ''}/ws`;
  return normalized;
}

function toWebSocketUrl(url) {
  const normalized = ensureWebSocketPath(url);
  normalized.protocol = normalized.protocol === 'https:' || normalized.protocol === 'wss:' ? 'wss:' : 'ws:';
  normalized.search = '';
  normalized.hash = '';
  return normalized.toString();
}

function isRedirect(status) {
  return status >= 300 && status < 400;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  try {
    return await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to query the Flutter DDS URL: ${detail}`);
  }
}

function runCommand(command, commandArgs, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      env: options.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`Design QA smoke failed (${signal ? `signal ${signal}` : `exit ${code}`}).`));
    });
  });
}

function printUsage() {
  console.log(`Usage:
  pnpm --filter @fliwright/e2e-tests test:design-qa:auto -- --vm-url <DDS-or-VM-URL> [--open-pairing] [--capture]

The script accepts Flutter's printed DDS URL, follows its redirect, and runs the
existing Design QA smoke. --open-pairing opens the in-app QR scanner.
Set FLIWRIGHT_DESIGN_QA_QR_PAYLOAD to include non-interactive pairing.
--capture additionally runs the manual capture branch for simulators.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[Design QA] ${error.message}`);
    process.exitCode = 1;
  });
}
