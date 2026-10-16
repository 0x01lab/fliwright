import { FliwrightDriver } from '@fliwright/core';
import { loadConfig } from '../config.js';
import { resolveVmUrl } from '../vm-discovery.js';

export interface AppSessionOptions {
  cwd?: string;
  vmUrl?: string;
}

export interface AppSession {
  driver: FliwrightDriver;
  vmServiceUrl: string;
}

export interface AppSessionDeps {
  resolveVmUrl?: typeof resolveVmUrl;
  driverFactory?: () => FliwrightDriver | Promise<FliwrightDriver>;
}

export async function connectAppSession(
  options: AppSessionOptions = {},
  deps: AppSessionDeps = {},
): Promise<AppSession> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(cwd);
  const vmServiceUrl = await (deps.resolveVmUrl ?? resolveVmUrl)({
    cliFlag: options.vmUrl,
    configUrl: config.vmServiceUrl,
    cwd,
    verify: false,
  });
  if (!vmServiceUrl) {
    throw new Error('Could not find a running Flutter VM Service. Pass --vm-url or start the app with the Fliwright bridge enabled.');
  }
  const driver = deps.driverFactory ? await deps.driverFactory() : new FliwrightDriver();
  await driver.connect(vmServiceUrl);
  return { driver, vmServiceUrl };
}

export async function withAppSession<T>(
  options: AppSessionOptions,
  operation: (session: AppSession) => Promise<T>,
  deps: AppSessionDeps = {},
): Promise<T> {
  const session = await connectAppSession(options, deps);
  try {
    return await operation(session);
  } finally {
    await session.driver.dispose();
  }
}
