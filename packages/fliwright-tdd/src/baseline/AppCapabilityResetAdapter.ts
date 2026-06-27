import type { ResetAdapter, ResetContext } from './BaselineManager.js';
import type { ResetCategory } from '../types.js';

const RESET_CAPABILITY = 'fliwright.reset';
const RESET_METHOD = 'reset';

export const WebviewResetAdapter = createAppCapabilityResetAdapter('webview');
export const TimersResetAdapter = createAppCapabilityResetAdapter('timers');
export const IsolatesResetAdapter = createAppCapabilityResetAdapter('isolates');
export const PermissionsResetAdapter = createAppCapabilityResetAdapter('permissions');

export const AppCapabilityResetAdapters: ResetAdapter[] = [
  WebviewResetAdapter,
  TimersResetAdapter,
  IsolatesResetAdapter,
  PermissionsResetAdapter,
];

type AppCapabilityResetCategory = Extract<ResetCategory, 'webview' | 'timers' | 'isolates' | 'permissions'>;

function createAppCapabilityResetAdapter(category: AppCapabilityResetCategory): ResetAdapter {
  return {
    category,
    async reset(ctx: ResetContext): Promise<'ok' | 'unsupported'> {
      const app = ctx.driver.app;
      if (!app) return 'unsupported';

      const supported = await supportsResetCapability(app);
      if (!supported) return 'unsupported';

      await app.invoke(RESET_CAPABILITY, RESET_METHOD, {
        category,
        full: ctx.full,
      });
      return 'ok';
    },
  };
}

async function supportsResetCapability(app: NonNullable<ResetContext['driver']['app']>): Promise<boolean> {
  if (app.hasCapability) {
    return await app.hasCapability(RESET_CAPABILITY);
  }
  if (app.listCapabilities) {
    const capabilities = await app.listCapabilities();
    return capabilities.some((capability) => (
      capability.name === RESET_CAPABILITY &&
      capability.methods.includes(RESET_METHOD)
    ));
  }
  return false;
}
