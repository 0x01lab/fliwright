import { EndpointLeaseManager, FliwrightDriver } from '@fliwright/core';
import { resolveProjectConfig } from '../config.js';
import { resolveVmUrl } from '../vm-discovery.js';

export interface AppSessionOptions {
  cwd?: string;
  vmUrl?: string;
  signal?: AbortSignal;
}

export interface AppSession {
  driver: FliwrightDriver;
  vmServiceUrl: string;
}

export interface AppSessionDeps {
  resolveVmUrl?: typeof resolveVmUrl;
  sessionProvider?: () => Promise<AppSession>;
  driverFactory?: () => FliwrightDriver | Promise<FliwrightDriver>;
}

export async function connectAppSession(
  options: AppSessionOptions = {},
  deps: AppSessionDeps = {},
): Promise<AppSession> {
  options.signal?.throwIfAborted();
  const cwd = options.cwd ?? process.cwd();
  const config = await resolveProjectConfig(cwd);
  const vmServiceUrl = await (deps.resolveVmUrl ?? resolveVmUrl)({
    cliFlag: options.vmUrl,
    configUrl: config.vmServiceUrl,
    cwd,
    verify: false,
  });
  if (!vmServiceUrl) {
    throw new Error('Could not find a running Flutter VM Service. Pass --vm-url or start the app with the Fliwright bridge enabled.');
  }
  const driver = deps.driverFactory ? await deps.driverFactory() : new FliwrightDriver({ cacheRoot: config.cacheRoot });
  const abort = () => { void driver.dispose({ signal: AbortSignal.abort(options.signal?.reason) }).catch(() => {}); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try { await driver.connect(vmServiceUrl); options.signal?.throwIfAborted(); } catch (error) { await driver.dispose().catch(() => {}); throw error; }
  finally { options.signal?.removeEventListener('abort', abort); }
  return { driver, vmServiceUrl };
}

export async function withAppSession<T>(
  options: AppSessionOptions,
  operation: (session: AppSession) => Promise<T>,
  deps: AppSessionDeps = {},
): Promise<T> {
  const session = deps.sessionProvider ? await deps.sessionProvider() : await connectAppSession(options, deps);
  try {
    const lease = await endpointLeases.acquire(session.vmServiceUrl, { signal: options.signal });
    const abort = () => { void session.driver.dispose({ signal: AbortSignal.abort(options.signal?.reason) }).catch(() => {}); };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      options.signal?.throwIfAborted();
      const result = await lease.run(() => operation(session));
      options.signal?.throwIfAborted();
      return result;
    } finally { options.signal?.removeEventListener('abort', abort); await lease.release(); }
  } finally {
    if (!deps.sessionProvider) await session.driver.dispose();
  }
}

const endpointLeases = new EndpointLeaseManager();
