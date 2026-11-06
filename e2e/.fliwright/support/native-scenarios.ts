import type { TestScenario } from '@fliwright/core';

/** Screen reset only; system permission prompt baselines are prepared externally. */
export const nativeScenarios = {
  'native.screen': {
    name: 'native.screen',
    layers: [{ kind: 'app', capability: 'nativeDemo', method: 'reset' }],
  },
  'native.ready': {
    name: 'native.ready',
    extends: ['native.screen'],
    layers: [
      { kind: 'device', requiredCapabilities: ['native.query', 'native.click'] },
    ],
  },
  'native.input': {
    name: 'native.input',
    extends: ['native.screen'],
    layers: [{ kind: 'device', requiredCapabilities: ['native.query', 'native.click', 'native.fill.basic'] }],
  },
} satisfies Record<string, TestScenario>;
