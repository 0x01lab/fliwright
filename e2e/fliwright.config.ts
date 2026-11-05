import type { FliwrightProjectConfig } from '@fliwright/core';
import { cameraScenarios } from './.fliwright/support/camera-scenarios.js';

export default { scenarios: cameraScenarios } satisfies Partial<FliwrightProjectConfig>;
