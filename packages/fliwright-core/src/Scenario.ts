import { createHash } from 'node:crypto';
import type { StateAdapter } from './interfaces/StateAdapter.js';
import type { ScenarioDevicePreparation, ScenarioDeviceReport } from './ScenarioDevicePreparation.js';
import type { MockRuleSelection, MockRuleSet, MockRuleSetReport, MockRuleSource } from './mocks/MockRuleSet.js';

export type ScenarioStartupIsolation = 'required' | 'optional';
export type ScenarioExecutionMode = 'managed-start' | 'attach';

export interface TestScenario {
  name: string;
  extends?: string[];
  startupIsolation?: ScenarioStartupIsolation;
  layers: ScenarioLayer[];
  ready?: ScenarioReadyCheck[];
}

export type ScenarioLayer =
  | ScenarioDeviceLayer
  | ScenarioMocksLayer
  | ScenarioStorageLayer
  | ScenarioAuthLayer
  | ScenarioStateLayer
  | ScenarioAppLayer
  | ScenarioNavigationLayer;

/** Portable device requirements, prepared separately from the connected app. */
export interface ScenarioDeviceLayer {
  kind: 'device';
  requiredCapabilities?: string[];
  baseline?: string;
  biometricBaseline?: string;
  permissions?: Array<{ permission: string; state: 'granted' | 'denied' | 'prompt' }>;
  media?: Array<{ kind: 'image'; fixtureId: string }>;
  cameraSource?: { front?: ScenarioCameraSource; back?: ScenarioCameraSource };
}

export interface ScenarioCameraSource {
  kind: 'image' | 'video';
  fixtureId: string;
}

export interface ScenarioMocksLayer {
  kind: 'mocks';
  /** Explicit shared/Item sources. Inherited source layers are applied together once. */
  sources?: MockRuleSource[];
  profile?: string;
  directory?: string;
  denyUnmatchedRequests?: boolean;
  /** With sources, select only named responses; use replace for an inherited endpoint. */
  rules?: Array<{ endpoint: string; method: string; rule: string; source?: string; replace?: boolean }>;
}

export interface ScenarioStorageLayer {
  kind: 'storage';
  seed?: Record<string, unknown>;
}

export interface ScenarioAuthLayer {
  kind: 'auth';
  state: 'guest' | 'authenticated';
  preset?: string;
  userId?: string;
  roles?: string[];
  metadata?: Record<string, unknown>;
}

export interface ScenarioStateLayer {
  kind: 'state';
  adapter: string;
  key: string;
  value: unknown;
}

export interface ScenarioAppLayer {
  kind: 'app';
  capability: string;
  method: string;
  input?: unknown;
}

export interface ScenarioNavigationLayer {
  kind: 'navigation';
  route: string;
}

export type ScenarioReadyCheck =
  | { kind: 'auth'; state: 'guest' | 'authenticated' }
  | { kind: 'route'; equals: string }
  | { kind: 'capability'; capability: string; method: string; input?: unknown };

export interface ResolvedScenario extends TestScenario {
  extends?: never;
  layers: ScenarioLayer[];
}

export interface ScenarioApplicationReport {
  scenario: string;
  mode: ScenarioExecutionMode;
  appliedLayers: ScenarioLayer['kind'][];
  ready: true;
  device?: ScenarioDeviceReport;
  mocks?: MockRuleSetReport;
}

export interface ScenarioDriver {
  mock?: {
    applyRuleSet?(config: MockRuleSet): Promise<MockRuleSetReport>;
    clearFlutterRoutes?(): Promise<void>;
    clearCalls?(): Promise<void>;
    setPassthrough?(enabled: boolean): Promise<void>;
    loadRules?(directory?: string): Promise<void>;
    listRules?(): Array<{ endpoint: string; method: string; rules: string[]; activeRule: string }>;
    switchRule?(endpoint: string, ruleName: string, method?: string): Promise<void>;
  };
  storage?: {
    reset(seed?: Record<string, unknown>): Promise<{ status: 'ok' | 'unsupported'; message?: string }>;
  };
  app?: {
    invoke(capability: string, method: string, input?: unknown): Promise<unknown>;
  };
  getStateAdapter?(name: string): StateAdapter;
  page?: {
    resetToHome(options?: { homeRoute?: string }): Promise<void>;
    currentRoute?(): Promise<string>;
  };
  sendRequest?(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Return a stable identity for the resolved scenario used by a recording. */
export function fingerprintScenario(scenario: TestScenario | ResolvedScenario): string {
  // Hash the same JSON declaration that can cross a runner process boundary.
  const transported: unknown = JSON.parse(JSON.stringify(scenario));
  return createHash('sha256').update(stableScenarioJson(transported)).digest('hex');
}

function stableScenarioJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((item) => stableScenarioJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableScenarioJson(record[key])}`).join(',')}}`;
}

export class ScenarioResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioResolutionError';
  }
}

export class ScenarioPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioPreparationError';
  }
}

/** Resolves named scenario inheritance into a validated, ordered declaration. */
export class ScenarioResolver {
  constructor(private readonly scenarios: Record<string, TestScenario>) {}

  resolve(name: string): ResolvedScenario {
    const stack: string[] = [];
    const resolveOne = (currentName: string): ResolvedScenario => {
      const scenario = this.scenarios[currentName];
      if (!scenario) throw new ScenarioResolutionError(`Unknown test scenario '${currentName}'.`);
      if (stack.includes(currentName)) {
        throw new ScenarioResolutionError(`Test scenario inheritance cycle: ${[...stack, currentName].join(' -> ')}.`);
      }
      stack.push(currentName);
      const parents = (scenario.extends ?? []).map((parent) => resolveOne(parent));
      stack.pop();
      const { extends: _extends, ...ownDeclaration } = scenario;
      const resolved: ResolvedScenario = {
        ...ownDeclaration,
        startupIsolation: parents.some((parent) => parent.startupIsolation === 'required')
          ? 'required'
          : scenario.startupIsolation,
        layers: [...parents.flatMap((parent) => parent.layers), ...scenario.layers],
        ready: [...parents.flatMap((parent) => parent.ready ?? []), ...(scenario.ready ?? [])],
      };
      this.assertUniqueResources(resolved);
      return resolved;
    };
    return resolveOne(name);
  }

  private assertUniqueResources(scenario: ResolvedScenario): void {
    composeScenarioMocks(scenario.layers);
    const owners = new Set<string>();
    for (const layer of scenario.layers) {
      for (const resource of resourcesFor(layer)) {
        if (owners.has(resource)) {
          throw new ScenarioResolutionError(`Scenario '${scenario.name}' writes '${resource}' more than once.`);
        }
        owners.add(resource);
      }
    }
  }
}

/** Applies a resolved scenario through public Driver facades and verifies its postconditions. */
export class ScenarioCoordinator {
  constructor(private readonly driver: ScenarioDriver) {}

  async apply(
    scenario: ResolvedScenario | TestScenario,
    options: { mode: ScenarioExecutionMode; attemptId?: string; devicePreparation?: ScenarioDevicePreparation },
  ): Promise<ScenarioApplicationReport> {
    const mockConfig = composeScenarioMocks(scenario.layers);
    let device: ScenarioDeviceReport | undefined;
    if (scenario.layers.some(layer => layer.kind === 'device')) {
      if (!options.attemptId || typeof options.devicePreparation?.consume !== 'function') {
        throw new ScenarioPreparationError(`Scenario '${scenario.name}' requires device preparation before application setup.`);
      }
      device = await options.devicePreparation.consume(scenario, { mode: options.mode, attemptId: options.attemptId });
    }
    if (scenario.startupIsolation === 'required' && options.mode === 'attach') {
      throw new ScenarioPreparationError(`Scenario '${scenario.name}' requires startup isolation and cannot run in attach mode.`);
    }

    if (options.mode === 'managed-start' && scenario.startupIsolation === 'required') {
      const status = await this.sendBootstrapRequest('ext.fliwright.testBootstrap.status');
      if (!isRecord(status) || status.waiting !== true) {
        throw new ScenarioPreparationError(`Scenario '${scenario.name}' requires a waiting Fliwright test bootstrap.`);
      }
    }

    const appliedLayers: ScenarioLayer['kind'][] = device ? ['device'] : [];
    let mocks: MockRuleSetReport | undefined;
    const mockLayer = scenario.layers.find((layer) => layer.kind === 'mocks');
    if (mockLayer?.kind === 'mocks') {
      if (mockConfig) {
        if (!this.driver.mock?.applyRuleSet) throw new ScenarioPreparationError('Scenario mock sources require MockManager.applyRuleSet.');
        mocks = await this.driver.mock.applyRuleSet(mockConfig);
      } else {
        await this.applyMocks(mockLayer);
      }
      appliedLayers.push('mocks');
    }
    for (const kind of ['storage', 'auth', 'state', 'app', 'navigation'] as const) {
      for (const layer of scenario.layers.filter((candidate) => candidate.kind === kind)) {
        await this.applyLayer(layer);
        appliedLayers.push(layer.kind);
      }
    }

    for (const check of scenario.ready ?? []) {
      await this.assertReady(check);
    }

    if (options.mode === 'managed-start' && scenario.startupIsolation === 'required') {
      await this.sendBootstrapRequest('ext.fliwright.testBootstrap.release');
    }

    return { scenario: scenario.name, mode: options.mode, appliedLayers, ready: true, ...(device ? { device } : {}), ...(mocks ? { mocks } : {}) };
  }

  private async applyLayer(layer: ScenarioLayer): Promise<void> {
    switch (layer.kind) {
      case 'mocks':
        await this.applyMocks(layer);
        return;
      case 'storage':
        await this.applyStorage(layer);
        return;
      case 'auth':
        await this.applyAuth(layer);
        return;
      case 'state':
        await this.requireStateAdapter(layer.adapter).override(layer.key, layer.value);
        return;
      case 'app':
        await this.requireApp().invoke(layer.capability, layer.method, layer.input);
        return;
      case 'navigation':
        await this.requirePage().resetToHome({ homeRoute: layer.route });
    }
  }

  private async applyMocks(layer: ScenarioMocksLayer): Promise<void> {
    const mock = this.driver.mock;
    if (!mock?.clearFlutterRoutes || !mock.clearCalls || !mock.setPassthrough) {
      throw new ScenarioPreparationError('Scenario mocks require the Flutter-side MockManager bridge facade.');
    }
    await mock.clearFlutterRoutes();
    await mock.clearCalls();
    await mock.setPassthrough(layer.denyUnmatchedRequests !== false ? false : true);
    if (!layer.profile && !layer.directory && !layer.rules?.length) return;
    if (!mock.loadRules || !mock.listRules || !mock.switchRule) {
      throw new ScenarioPreparationError('Scenario mock selections require rule-profile support.');
    }
    await mock.loadRules(layer.directory);
    const endpoints = mock.listRules();
    const matching = layer.profile ? endpoints.filter((endpoint) => endpoint.rules.includes(layer.profile!)) : [];
    if (layer.profile && matching.length === 0) {
      throw new ScenarioPreparationError(`Scenario mock profile '${layer.profile}' was not found.`);
    }
    const selected = new Set<string>();
    for (const selection of layer.rules ?? []) {
      const method = selection.method.toUpperCase();
      const key = JSON.stringify([selection.endpoint, method]);
      const endpoint = endpoints.find((item) => item.endpoint === selection.endpoint && item.method.toUpperCase() === method);
      if (selected.has(key) || !endpoint?.rules.includes(selection.rule)) {
        throw new ScenarioPreparationError(`Invalid scenario mock rule selection: ${method} ${selection.endpoint} -> ${selection.rule}.`);
      }
      selected.add(key);
    }
    for (const endpoint of matching) {
      await mock.switchRule(endpoint.endpoint, layer.profile!, endpoint.method);
    }
    for (const selection of layer.rules ?? []) {
      await mock.switchRule(selection.endpoint, selection.rule, selection.method.toUpperCase());
    }
  }

  private async applyStorage(layer: ScenarioStorageLayer): Promise<void> {
    const storage = this.driver.storage;
    if (!storage) throw new ScenarioPreparationError('Scenario storage layer requires a registered storage-reset handler.');
    const result = await storage.reset(layer.seed ?? {});
    if (result.status !== 'ok') {
      throw new ScenarioPreparationError(result.message ?? 'Scenario storage reset is unsupported.');
    }
  }

  private async applyAuth(layer: ScenarioAuthLayer): Promise<void> {
    const app = this.requireApp();
    if (layer.state === 'authenticated') {
      await app.invoke('auth', 'seedLoggedIn', compactAuthInput(layer));
    } else {
      await app.invoke('auth', 'clearSession');
    }
    await this.assertAuthState(layer.state);
  }

  private async assertReady(check: ScenarioReadyCheck): Promise<void> {
    switch (check.kind) {
      case 'auth':
        await this.assertAuthState(check.state);
        return;
      case 'route': {
        const currentRoute = this.requirePage().currentRoute;
        if (!currentRoute) throw new ScenarioPreparationError('Scenario route readiness requires Page.currentRoute().');
        const actual = await currentRoute();
        if (actual !== check.equals) {
          throw new ScenarioPreparationError(`Scenario route readiness failed: expected '${check.equals}', got '${actual}'.`);
        }
        return;
      }
      case 'capability':
        await this.requireApp().invoke(check.capability, check.method, check.input);
    }
  }

  private async assertAuthState(expected: 'guest' | 'authenticated'): Promise<void> {
    const status = await this.requireApp().invoke('auth', 'getStatus');
    const actual = isRecord(status) && status.isAuthenticated === true ? 'authenticated' : 'guest';
    if (actual !== expected) {
      throw new ScenarioPreparationError(`Scenario authentication readiness failed: expected '${expected}', got '${actual}'.`);
    }
  }

  private requireApp(): NonNullable<ScenarioDriver['app']> {
    if (!this.driver.app) throw new ScenarioPreparationError('Scenario requires the app capability facade.');
    return this.driver.app;
  }

  private requirePage(): NonNullable<ScenarioDriver['page']> {
    if (!this.driver.page) throw new ScenarioPreparationError('Scenario requires the page facade.');
    return this.driver.page;
  }

  private requireStateAdapter(name: string): StateAdapter {
    if (!this.driver.getStateAdapter) {
      throw new ScenarioPreparationError(`Scenario state layer '${name}' requires a registered state adapter.`);
    }
    try {
      return this.driver.getStateAdapter(name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ScenarioPreparationError(`Scenario state adapter '${name}' is unavailable: ${message}`);
    }
  }

  private async sendBootstrapRequest(method: string): Promise<unknown> {
    if (!this.driver.sendRequest) {
      throw new ScenarioPreparationError('Scenario startup isolation requires a raw bridge request facade.');
    }
    return await this.driver.sendRequest(method, {});
  }
}

function resourcesFor(layer: ScenarioLayer): string[] {
  switch (layer.kind) {
    case 'device': return ['device'];
    case 'auth': return ['auth'];
    case 'navigation': return ['navigation'];
    case 'state': return [`state:${layer.adapter}:${layer.key}`];
    case 'app': return [`app:${layer.capability}:${layer.method}`];
    case 'storage': return Object.keys(layer.seed ?? {}).map((key) => `storage:${key}`);
    case 'mocks': return [];
  }
}

/** Compose declarations first: a parent and child must never clear each other's routes. */
function composeScenarioMocks(layers: ScenarioLayer[]): MockRuleSet | undefined {
  const mocks = layers.filter((layer): layer is ScenarioMocksLayer => layer.kind === 'mocks');
  if (!mocks.length) return undefined;
  if (mocks.every(layer => layer.sources === undefined)) {
    if (mocks.length > 1 || mocks.some(layer => layer.rules?.some(rule => rule.source !== undefined || rule.replace !== undefined))) {
      throw new ScenarioResolutionError('Composed mock layers require explicit sources and source-qualified rules.');
    }
    return undefined;
  }
  const sources: MockRuleSource[] = [];
  const rules: MockRuleSelection[] = [];
  const names = new Set<string>();
  let denyUnmatchedRequests: boolean | undefined;
  for (const layer of mocks) {
    if (!Array.isArray(layer.sources) || layer.directory !== undefined || layer.profile !== undefined) {
      throw new ScenarioResolutionError('Mock sources cannot be combined with directory/profile layers.');
    }
    for (const source of layer.sources) {
      if (names.has(source.name)) throw new ScenarioResolutionError(`Duplicate mock source '${source.name}'.`);
      names.add(source.name);
      sources.push(source);
    }
    if (layer.denyUnmatchedRequests !== undefined) {
      if (denyUnmatchedRequests !== undefined && denyUnmatchedRequests !== layer.denyUnmatchedRequests) {
        throw new ScenarioResolutionError('Composed mock layers disagree on denyUnmatchedRequests.');
      }
      denyUnmatchedRequests = layer.denyUnmatchedRequests;
    }
    for (const rule of layer.rules ?? []) {
      if (!rule.source || !names.has(rule.source)) throw new ScenarioResolutionError(`Unknown mock source '${rule.source}'.`);
      rules.push({ ...rule, source: rule.source });
    }
  }
  return { sources, rules, denyUnmatchedRequests };
}

function compactAuthInput(layer: ScenarioAuthLayer): Record<string, unknown> {
  return {
    ...(layer.preset ? { preset: layer.preset } : {}),
    ...(layer.userId ? { userId: layer.userId } : {}),
    ...(layer.roles ? { roles: layer.roles } : {}),
    ...(layer.metadata ? { metadata: layer.metadata } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
