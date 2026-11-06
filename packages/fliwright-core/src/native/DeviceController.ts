import type { NativeRuntime } from './NativeRuntime.js';
import type { NativeOperationOptions, DeviceCapabilities, DeviceEventResult } from './types.js';

/** Device test controls; acknowledgements are not application assertions. */
export class DeviceController {
  constructor(private readonly runtime: NativeRuntime) {}
  capabilities(options: NativeOperationOptions = {}): Promise<DeviceCapabilities> {
    return this.runtime.run('capabilities', 'raw', options, context => this.runtime.adapter.capabilities(context));
  }
  readonly biometrics = {
    match: (options?: NativeOperationOptions) => this.biometric('match', options),
    reject: (options?: NativeOperationOptions) => this.biometric('reject', options),
  };
  private biometric(result: 'match' | 'reject', options: NativeOperationOptions = {}): Promise<DeviceEventResult> {
    return this.runtime.run(`biometrics.${result}`, 'action', options, async context => {
      await this.runtime.requireCapability(`biometrics.${result}`, context);
      await this.runtime.write({ kind: 'biometric', result }, context);
      return { eventId: context.requestId, acknowledged: true };
    });
  }
  readonly permissions = {
    set: (input: { permission: string; state: 'granted' | 'denied' | 'prompt' }, options: NativeOperationOptions = {}): Promise<void> =>
      this.runtime.run('permissions.set', 'action', options, async context => {
        await this.runtime.requireCapability(`permissions.${input.permission}.${input.state}`, context);
        await this.runtime.write({ kind: 'permission', ...input }, context);
      }),
  };
  readonly media = {
    importImage: (path: string, options: NativeOperationOptions = {}): Promise<unknown> =>
      this.runtime.run('media.importImage', 'action', options, async context => {
        await this.runtime.requireCapability('media.import', context);
        return this.runtime.write({ kind: 'importImage', path }, context);
      }),
  };
}
