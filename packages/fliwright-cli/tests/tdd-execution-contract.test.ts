import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/index.js';

describe('agent-driven TDD commands', () => {
  it('exposes execution primitives without a second agent workflow', () => {
    const registry = createRegistry();
    for (const path of ['tdd.start', 'tdd.focus', 'tdd.cycle', 'tdd.sync', 'tdd.scenario', 'tdd.reconnect', 'tdd.stop']) {
      expect(registry.definitions.has(path), path).toBe(true);
    }
    for (const path of ['tdd.prepare', 'tdd.validate-spec', 'tdd.repair', 'devassist.cycle']) {
      expect(registry.definitions.has(path), path).toBe(false);
    }
  });

  it('requires an explicit focused file and rejects automatic repair options', () => {
    const registry = createRegistry();
    expect(registry.definitions.get('tdd.focus')!.input.strict().safeParse({}).success).toBe(false);
    expect(registry.definitions.get('tdd.cycle')!.input.strict().safeParse({ repair: { mode: 'safe-apply' } }).success).toBe(false);
  });

  it('keeps ordinary draft generation separate from TDD intent orchestration', () => {
    const schema = createRegistry().definitions.get('generate-test')!.input.strict();
    expect(schema.safeParse({ source: "Text('Hello')" }).success).toBe(true);
    expect(schema.safeParse({ mode: 'red-first', spec: { elements: [], flows: [] } }).success).toBe(false);
  });
});
