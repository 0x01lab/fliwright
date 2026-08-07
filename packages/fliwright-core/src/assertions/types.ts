import type { Locator } from '../Locator.js';

export interface RuntimeAssertionOptions {
  timeout?: number;
  interval?: number;
  includeScreenshot?: boolean;
  includeSnapshot?: boolean;
}

export interface AssertionMetadata extends Record<string, unknown> {
  matcher: string;
  target?: string;
  expected?: unknown;
  actual?: unknown;
  aiAssisted?: boolean;
}

export interface AssertRuntimeOptions {
  recorder?: import('../timeline/TimelineRecorder.js').TimelineRecorder;
  artifactStore?: import('../timeline/TimelineArtifactStore.js').TimelineArtifactStore;
  page?: import('../Page.js').Page;
  mock?: import('../mocks/MockRuntime.js').MockRuntime;
}
