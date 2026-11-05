import type { NativeLocator } from './NativeLocator.js';
import type { NativeNode, NativeOperationOptions } from './types.js';

/** Native observations never translate transport failures into missing elements. */
export class NativeAssertion {
  constructor(private readonly locator: NativeLocator, private readonly negated = false, private readonly title?: string) {}
  get not(): NativeAssertion { return new NativeAssertion(this.locator, !this.negated, this.title); }
  toBeVisible(options: NativeOperationOptions = {}): Promise<void> {
    return this.check('toBeVisible', node => node?.visible ?? false, options);
  }
  toBeEnabled(options: NativeOperationOptions = {}): Promise<void> {
    return this.check('toBeEnabled', node => node?.enabled ?? false, options);
  }
  toHaveText(text: string, options: NativeOperationOptions = {}): Promise<void> {
    return this.check('toHaveText', node => node?.text === text, options);
  }
  private check(matcher: string, predicate: (node: NativeNode | undefined) => boolean, options: NativeOperationOptions): Promise<void> {
    const { runtime, query } = this.locator;
    return runtime.run(matcher, 'assertion', options, async context => {
      while (true) {
        const { nodes } = await this.locator.observe(context);
        this.locator.assertUnique(nodes);
        if (predicate(nodes[0]) !== this.negated) return;
        await runtime.pause(context);
      }
    }, { query, title: this.title ?? `Native ${this.negated ? 'not ' : ''}${matcher}` });
  }
}
