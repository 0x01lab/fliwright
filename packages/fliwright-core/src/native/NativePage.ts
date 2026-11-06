import type { NativeRuntime } from './NativeRuntime.js';
import { NativeLocator } from './NativeLocator.js';
import { NativeError, type NativeOperationOptions, type NativeQueryOptions, type NativeQuery } from './types.js';

/** Native application and explicitly scoped system UI, independent of Flutter. */
export class NativePage {
  constructor(private readonly runtime: NativeRuntime) {}
  private locate(field: NativeQuery['field'], value: string, options: NativeQueryOptions = {}): NativeLocator {
    if (!value || value.includes('\0')) throw new NativeError('precondition_failed', 'A nonempty native selector without NUL is required.');
    return new NativeLocator(this.runtime, { field, value, exact: options.exact ?? true, scope: options.scope ?? 'app' });
  }
  getById(id: string, options: Omit<NativeQueryOptions, 'exact'> = {}): NativeLocator { return this.locate('resourceId', id, options); }
  getByText(text: string, options?: NativeQueryOptions): NativeLocator { return this.locate('text', text, options); }
  getByLabel(label: string, options?: NativeQueryOptions): NativeLocator { return this.locate('label', label, options); }
  snapshot(options: NativeOperationOptions & { query?: NativeQuery } = {}) {
    return this.runtime.run('snapshot', 'raw', options, context => this.runtime.readSnapshot(context, options.query), { query: options.query });
  }
  screenshot(options: NativeOperationOptions = {}): Promise<Buffer> {
    return this.runtime.run('screenshot', 'raw', options, async context => {
      await this.runtime.requireCapability('screen.capture', context);
      return this.runtime.adapter.screenshot(context);
    });
  }
  back(options: NativeOperationOptions = {}): Promise<void> {
    return this.runtime.run('back', 'action', options, async context => {
      await this.runtime.requireCapability('native.back', context);
      await this.runtime.write({ kind: 'back' }, context);
    });
  }
  swipe(gesture: { from: { x: number; y: number }; to: { x: number; y: number }; durationMs?: number }, options: NativeOperationOptions = {}): Promise<void> {
    const durationMs = gesture.durationMs ?? 300;
    return this.runtime.run('swipe', 'action', options, async context => {
      if (![gesture.from.x, gesture.from.y, gesture.to.x, gesture.to.y, durationMs].every(Number.isFinite) || durationMs <= 0) {
        throw new NativeError('precondition_failed', 'Swipe coordinates and duration must be finite; duration must be positive.');
      }
      await this.runtime.requireCapability('native.swipe', context);
      await this.runtime.write({ kind: 'swipe', ...gesture, durationMs }, context);
    });
  }
}
