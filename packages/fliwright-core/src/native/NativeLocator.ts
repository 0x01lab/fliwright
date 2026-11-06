import type { NativeRuntime } from './NativeRuntime.js';
import { NativeAssertion } from './NativeAssertion.js';
import { NativeError, type NativeOperationContext, type NativeOperationOptions, type NativeQuery, type NativeSnapshot } from './types.js';

export type NativeWaitState = 'attached' | 'detached' | 'visible' | 'hidden';

/** Lazy query. Actions resolve a fresh, unique and interactable native target. */
export class NativeLocator {
  constructor(readonly runtime: NativeRuntime, readonly query: NativeQuery) {}
  async observe(context: NativeOperationContext) {
    const snapshot = await this.runtime.readSnapshot(context, this.query);
    return { snapshot, nodes: this.runtime.matches(snapshot, this.query) };
  }
  count(options: NativeOperationOptions = {}): Promise<number> {
    return this.runtime.run('count', 'raw', options, async context => (await this.observe(context)).nodes.length, { query: this.query });
  }
  isVisible(options: NativeOperationOptions = {}): Promise<boolean> {
    return this.runtime.run('isVisible', 'raw', options, async context => {
      const { nodes } = await this.observe(context);
      this.assertUnique(nodes);
      return nodes[0]?.visible ?? false;
    }, { query: this.query });
  }
  assertUnique(nodes: NativeSnapshot['nodes']): void {
    if (nodes.length > 1) throw new NativeError('strict_mode_violation', `Native selector matched ${nodes.length} elements; use a unique ID or scope.`);
  }
  click(options: NativeOperationOptions = {}): Promise<void> { return this.act('click', options); }
  fill(text: string, options: NativeOperationOptions = {}): Promise<void> { return this.act('fill', options, text); }
  private act(kind: 'click' | 'fill', options: NativeOperationOptions, text?: string): Promise<void> {
    return this.runtime.run(kind, 'action', options, async context => {
      const capability = kind === 'click' ? 'native.click' : /[^\x20-\x7e]/.test(text ?? '') ? 'native.fill.unicode' : 'native.fill.basic';
      await this.runtime.requireCapability(capability, context);
      while (true) {
        const { snapshot, nodes } = await this.observe(context);
        this.assertUnique(nodes);
        const node = nodes[0];
        if (node?.visible && node.enabled && node.hittable !== false && node.frame.width > 0 && node.frame.height > 0) {
          await this.runtime.write(kind === 'click' ? { kind, node, snapshotId: snapshot.id } : { kind, node, snapshotId: snapshot.id, text: text! }, context);
          return;
        }
        await this.runtime.pause(context);
      }
    }, { query: this.query, sensitiveValues: text === undefined ? undefined : [text] });
  }
  waitFor(options: NativeOperationOptions & { state: NativeWaitState }): Promise<void> {
    return this.runtime.run('waitFor', 'raw', options, async context => {
      while (true) {
        const { nodes } = await this.observe(context);
        this.assertUnique(nodes);
        const state = options.state;
        if ((state === 'attached' && nodes.length === 1) || (state === 'detached' && nodes.length === 0)
          || (state === 'visible' && nodes[0]?.visible) || (state === 'hidden' && !nodes[0]?.visible)) return;
        await this.runtime.pause(context);
      }
    }, { query: this.query });
  }
  expect(title?: string): NativeAssertion { return new NativeAssertion(this, false, title); }
}
