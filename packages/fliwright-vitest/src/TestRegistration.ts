import type { RunnerTask, RunnerTestCase, TestAPI } from 'vitest';

const prepareKey = Symbol.for('@fliwright/vitest/prepare-task');
type PrepareTask = (task: RunnerTestCase, signal: AbortSignal) => Promise<void>;
type PreparedMeta = { [prepareKey]?: PrepareTask };

/** Bind preparation through public test metadata without wrapping the body.
 * Symbol keys stay within the worker and are omitted from reporter serialization.
 */
export function withTaskPreparation<T extends object>(test: TestAPI<T>, prepare: PrepareTask): TestAPI<T> {
  const proxies = new WeakMap<object, object>();
  const variants = new Set(['concurrent', 'skip', 'only', 'todo', 'fails']);
  const factories = new Set(['each', 'for', 'skipIf', 'runIf', 'extend']);
  const wrap = (target: (...args: unknown[]) => unknown): typeof target => {
    const existing = proxies.get(target);
    if (existing) return existing as typeof target;
    const proxy = new Proxy(target, {
      apply(fn, receiver, args: unknown[]) {
        const [name, optionsOrHandler, handlerOrTimeout] = args;
        // Let Vitest reject removed overloads and malformed handler pairs.
        if ((typeof handlerOrTimeout === 'object' && handlerOrTimeout !== null)
          || (typeof optionsOrHandler === 'function' && typeof handlerOrTimeout === 'function')) {
          return Reflect.apply(fn, receiver, args);
        }
        const options = typeof optionsOrHandler === 'object' && optionsOrHandler !== null
          ? optionsOrHandler as { meta?: PreparedMeta; timeout?: number }
          : typeof handlerOrTimeout === 'number' ? { timeout: handlerOrTimeout } : {};
        const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : handlerOrTimeout;
        return Reflect.apply(fn, receiver, [name, {
          ...options, meta: { ...options.meta, [prepareKey]: prepare },
        }, handler]);
      },
      get(fn, property, receiver) {
        const value = Reflect.get(fn, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        if (typeof property === 'string' && variants.has(property)) return wrap(value as typeof target);
        if (typeof property === 'string' && factories.has(property)) {
          return (...args: unknown[]) => {
            const result = Reflect.apply(value, fn, args) as unknown;
            return typeof result === 'function' ? wrap(result as typeof target) : result;
          };
        }
        return value;
      },
    });
    proxies.set(target, proxy);
    return proxy;
  };
  return wrap(test as unknown as (...args: unknown[]) => unknown) as unknown as TestAPI<T>;
}

export async function prepareRegisteredTask(task: RunnerTask, signal: AbortSignal): Promise<void> {
  if (task.type === 'test') await (task.meta as PreparedMeta)[prepareKey]?.(task, signal);
}
