import type { TestScenario } from '@fliwright/core';

export const cameraScenarios = {
  'camera.empty': {
    name: 'camera.empty',
    layers: [{ kind: 'app', capability: 'cameraDemo', method: 'reset' }],
  },
} satisfies Record<string, TestScenario>;
