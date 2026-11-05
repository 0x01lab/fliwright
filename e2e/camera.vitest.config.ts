import { defineConfig } from 'vitest/config';
import { fliwrightPreset } from '@fliwright/vitest/preset';
import projectConfig from './fliwright.config.js';

export default defineConfig({
  ...fliwrightPreset(projectConfig),
  test: { ...fliwrightPreset(projectConfig).test, include: ['.fliwright/tests/camera.test.ts'], maxWorkers: 1 },
});
