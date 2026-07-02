import type { MockCall, MockRouteResponse } from '../types.js';

export type MockBackend = 'flutter' | 'dio' | 'tool-server';

export interface MockTimelineMetadata {
  operation:
    | 'activateRules'
    | 'loadRules'
    | 'switchRule'
    | 'route'
    | 'routeFlutter'
    | 'removeRoute'
    | 'clearRoutes'
    | 'clearCalls'
    | 'setPassthrough'
    | 'getCalls'
    | 'waitForCall'
    | 'listRoutes'
    | 'listRules';
  endpoint?: string;
  method?: string;
  ruleName?: string;
  mockDir?: string;
  routeCount?: number;
  callCount?: number;
  backend?: MockBackend;
}

export interface NormalizedRequestMatcher {
  path?: string | RegExp;
  url?: string | RegExp;
  method?: string;
  headers?: Record<string, string | RegExp>;
  body?: unknown;
}

export interface WaitForMockCallOptions {
  count?: number;
  timeout?: number;
  interval?: number;
}

export interface ActivateMockRule {
  path: string;
  method?: string;
  rule: string;
}

export interface ActivateMockRulesOptions {
  mockDir?: string;
  routes: ActivateMockRule[];
  clearRoutes?: boolean;
  clearCalls?: boolean;
  assertApplied?: boolean;
}

export type TimelineMockResponse = MockRouteResponse & {
  method?: string;
  id?: string;
};

export type NormalizedMockCall = MockCall & {
  url?: string;
  query?: Record<string, string | string[]>;
  status?: number;
  response?: unknown;
};
