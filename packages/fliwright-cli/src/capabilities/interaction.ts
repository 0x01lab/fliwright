export interface InteractionDriver {
  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>;
  reloadSources?(): Promise<unknown>;
  listenToDiagnostics?(streamIds?: string[]): Promise<void>;
  getDiagnostics?(options?: DiagnosticsFilterOptions): DiagnosticEvent[];
  clearDiagnostics?(): void;
  page: InteractionPage;
}

export interface InteractionPage {
  snapshot(options?: SnapshotOptions): Promise<SnapshotResult>;
  screenshot?(options?: { pixelRatio?: number }): Promise<Buffer>;
  waitFor?(selector: Record<string, unknown>, timeout?: number): Promise<unknown>;
  dismissModal?(): Promise<void>;
  waitForNetworkIdle?(options?: { quietMs?: number; timeout?: number }): Promise<void>;
  getByKey?(key: string): InteractionLocator;
  getByText?(text: string): InteractionLocator;
  getByType?(type: string): InteractionLocator;
}

export interface InteractionLocator {
  click?(): Promise<void>;
  fill?(value: string): Promise<void>;
  type?(value: string): Promise<void>;
  doubleClick?(): Promise<void>;
  tripleClick?(): Promise<void>;
  rightClick?(): Promise<void>;
  hover?(): Promise<void>;
  focus?(): Promise<void>;
  blur?(): Promise<void>;
  clear?(): Promise<void>;
  pressKey?(key: string): Promise<void>;
  setCheckbox?(checked: boolean): Promise<void>;
  selectOption?(value: string | number): Promise<void>;
}

export interface SnapshotOptions {
  depth?: number;
  includeRects?: boolean;
  includeProperties?: boolean;
}

export interface SnapshotRef {
  ref: string;
  role: string;
  label: string;
  type: string;
  key?: string;
  selector?: string;
  enabled?: boolean;
  textField?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  properties?: Record<string, unknown>;
}

export interface SnapshotResult {
  snapshot: string;
  groupId: string;
  refs: SnapshotRef[];
  count: number;
  error?: string;
}

export interface FindQuery {
  text?: string;
  containsText?: string;
  key?: string;
  semanticsLabel?: string;
  role?: string;
  type?: string;
}

export interface ObserveOptions {
  intent?: string;
  roles?: string;
  limit?: number;
  includeDiagnostics?: boolean;
}

export interface ActionOptions {
  action: ActionName;
  ref?: string;
  key?: string;
  text?: string;
  type?: string;
  keyboardKey?: string;
  checked?: boolean;
  value?: string | number;
  quietMs?: number;
  timeout?: number;
  includeSnapshot?: boolean;
}

export interface DiagnosticEvent {
  kind: string;
  timestamp: number;
  data: unknown;
  streamId?: string;
}

export interface DiagnosticsFilterOptions {
  limit?: number;
  kinds?: string[];
  streams?: string[];
}

export interface DiagnosticsOptions extends DiagnosticsFilterOptions {
  listen?: boolean;
  clear?: boolean;
}

export interface DiagnosticsResult {
  listening: boolean;
  cleared: boolean;
  events: DiagnosticEvent[];
  count: number;
}

export type ActionName =
  | 'doubleClick'
  | 'tripleClick'
  | 'rightClick'
  | 'hover'
  | 'focus'
  | 'blur'
  | 'clear'
  | 'pressKey'
  | 'setCheckbox'
  | 'selectOption'
  | 'dismissModal'
  | 'waitForNetworkIdle';

export async function snapInteraction(
  driver: InteractionDriver,
  options: SnapshotOptions = {},
): Promise<SnapshotResult> {
  return driver.page.snapshot(options);
}

export async function findInteraction(
  driver: InteractionDriver,
  query: FindQuery,
): Promise<{ matches: SnapshotRef[]; count: number }> {
  const snapshot = await driver.page.snapshot();
  const matches = snapshot.refs.filter((candidate) => matchesFindQuery(candidate, query));
  return { matches, count: matches.length };
}

export async function observeInteraction(
  driver: InteractionDriver,
  options: ObserveOptions = {},
): Promise<{ candidates: Array<SnapshotRef & { diagnostics?: Record<string, unknown> }>; count: number }> {
  const roles = parseRoles(options.roles);
  const includeDiagnostics = options.includeDiagnostics ?? false;
  const snapshot = await driver.page.snapshot({
    includeRects: true,
    includeProperties: includeDiagnostics,
  });

  const candidates = snapshot.refs
    .filter((candidate) => roles.size === 0 || roles.has(candidate.role))
    .slice(0, options.limit ?? 20)
    .map((candidate) => ({
      ...candidate,
      ...(includeDiagnostics
        ? {
            diagnostics: {
              intent: options.intent,
              selector: candidate.selector,
              enabled: candidate.enabled,
            },
          }
        : {}),
    }));

  return { candidates, count: candidates.length };
}

export async function tapInteraction(
  driver: InteractionDriver,
  target: TargetOptions,
): Promise<{ success: boolean; snapshot?: SnapshotResult }> {
  if (target.ref) {
    assertActionSuccess(await driver.sendRequest('ext.fliwright.action', {
      action: 'tap',
      ref: target.ref,
    }), 'tap');
  } else {
    const locator = resolveLocator(driver.page, target);
    await requireMethod(locator, 'click')();
  }
  return withOptionalSnapshot(driver.page, target.includeSnapshot);
}

export async function typeInteraction(
  driver: InteractionDriver,
  target: TargetOptions & { value: string; replace?: boolean },
): Promise<{ success: boolean; filled: string; snapshot?: SnapshotResult }> {
  if (target.ref) {
    const action = target.replace === false ? 'type' : 'fill';
    assertActionSuccess(await driver.sendRequest('ext.fliwright.action', {
      action,
      ref: target.ref,
      text: target.value,
      replaceAll: target.replace === false ? 'false' : 'true',
    }), action);
  } else {
    const locator = resolveLocator(driver.page, target);
    if (target.replace === false) {
      await requireMethod(locator, 'type')(target.value);
    } else {
      await requireMethod(locator, 'fill')(target.value);
    }
  }
  const result = await withOptionalSnapshot(driver.page, target.includeSnapshot);
  return { ...result, filled: target.value };
}

export async function actionInteraction(
  driver: InteractionDriver,
  options: ActionOptions,
): Promise<{ success: boolean; action: ActionName; snapshot?: SnapshotResult }> {
  if (options.action === 'dismissModal') {
    if (driver.page.dismissModal) {
      await driver.page.dismissModal();
    } else {
      assertActionSuccess(await driver.sendRequest('ext.fliwright.action', { action: options.action }), options.action);
    }
    return { ...(await withOptionalSnapshot(driver.page, options.includeSnapshot)), action: options.action };
  }

  if (options.action === 'waitForNetworkIdle') {
    if (driver.page.waitForNetworkIdle) {
      await driver.page.waitForNetworkIdle({
        quietMs: options.quietMs,
        timeout: options.timeout,
      });
    } else {
      assertActionSuccess(await driver.sendRequest('ext.fliwright.action', stringifyDefined({
        action: options.action,
        quietMs: options.quietMs,
        timeout: options.timeout,
      })), options.action);
    }
    return { ...(await withOptionalSnapshot(driver.page, options.includeSnapshot)), action: options.action };
  }

  if (options.ref) {
    const payload = stringifyDefined({
      action: options.action,
      ref: options.ref,
      key: options.keyboardKey,
      checked: options.checked,
      value: options.value,
      quietMs: options.quietMs,
      timeout: options.timeout,
    });
    assertActionSuccess(await driver.sendRequest('ext.fliwright.action', payload), options.action);
    return { ...(await withOptionalSnapshot(driver.page, options.includeSnapshot)), action: options.action };
  }

  const locator = resolveLocator(driver.page, options);
  await invokeLocatorAction(locator, options);
  return { ...(await withOptionalSnapshot(driver.page, options.includeSnapshot)), action: options.action };
}

export async function waitInteraction(
  driver: InteractionDriver,
  target: TargetOptions & { timeout?: number },
): Promise<{ found: boolean }> {
  if (target.ref) {
    await waitForRef(driver.page, target.ref, target.timeout);
    return { found: true };
  }
  if (!driver.page.waitFor) {
    throw new Error('Connected page does not support waitFor');
  }
  await driver.page.waitFor(selectorFromTarget(target), target.timeout);
  return { found: true };
}

export async function hotReloadAndSnapInteraction(
  driver: InteractionDriver,
  options: SnapshotOptions & { pixelRatio?: number } = {},
): Promise<{
  reloaded: boolean;
  durationMs: number;
  reloadResult?: unknown;
  snapshot?: SnapshotResult;
  screenshot?: string;
  exceptions: Array<{ kind: 'reload' | 'snapshot' | 'screenshot'; message: string }>;
}> {
  const startedAt = Date.now();
  const exceptions: Array<{ kind: 'reload' | 'snapshot' | 'screenshot'; message: string }> = [];

  let reloadResult: unknown;
  try {
    if (!driver.reloadSources) throw new Error('Connected driver does not support hot reload');
    reloadResult = await driver.reloadSources();
  } catch (error) {
    exceptions.push({ kind: 'reload', message: errorMessage(error) });
    return { reloaded: false, durationMs: Date.now() - startedAt, exceptions };
  }

  let snapshot: SnapshotResult | undefined;
  try {
    snapshot = await driver.page.snapshot({
      depth: options.depth,
      includeRects: options.includeRects,
      includeProperties: options.includeProperties,
    });
  } catch (error) {
    exceptions.push({ kind: 'snapshot', message: errorMessage(error) });
  }

  let screenshot: string | undefined;
  try {
    if (driver.page.screenshot) {
      screenshot = (await driver.page.screenshot({ pixelRatio: options.pixelRatio })).toString('base64');
    }
  } catch (error) {
    exceptions.push({ kind: 'screenshot', message: errorMessage(error) });
  }

  return {
    reloaded: true,
    durationMs: Date.now() - startedAt,
    reloadResult,
    snapshot,
    screenshot,
    exceptions,
  };
}

export async function diagnosticsInteraction(
  driver: InteractionDriver,
  options: DiagnosticsOptions = {},
): Promise<DiagnosticsResult> {
  const streams = options.streams;
  let listening = false;
  let cleared = false;

  if (options.clear) {
    if (!driver.clearDiagnostics) throw new Error('Connected driver does not support diagnostics clearing');
    driver.clearDiagnostics();
    cleared = true;
  }

  if (options.listen) {
    if (!driver.listenToDiagnostics) throw new Error('Connected driver does not support diagnostics listening');
    await driver.listenToDiagnostics(streams);
    listening = true;
  }

  if (!driver.getDiagnostics) throw new Error('Connected driver does not support diagnostics retrieval');
  const events = driver.getDiagnostics({
    limit: options.limit,
    kinds: options.kinds,
    streams: options.streams,
  });
  return { listening, cleared, events, count: events.length };
}

export interface TargetOptions {
  ref?: string;
  key?: string;
  text?: string;
  type?: string;
  includeSnapshot?: boolean;
}

function resolveLocator(page: InteractionPage, target: TargetOptions): InteractionLocator {
  if (target.key && page.getByKey) return page.getByKey(target.key);
  if (target.text && page.getByText) return page.getByText(target.text);
  if (target.type && page.getByType) return page.getByType(target.type);
  throw new Error('At least one of ref, key, text, or type must be provided');
}

function selectorFromTarget(target: TargetOptions): Record<string, unknown> {
  if (target.key) return { key: target.key };
  if (target.text) return { text: target.text };
  if (target.type) return { type: target.type };
  throw new Error('At least one of ref, key, text, or type must be provided');
}

function requireMethod<T extends keyof InteractionLocator>(
  locator: InteractionLocator,
  method: T,
): NonNullable<InteractionLocator[T]> {
  const fn = locator[method];
  if (typeof fn !== 'function') {
    throw new Error(`Locator does not support ${String(method)}`);
  }
  return fn.bind(locator) as NonNullable<InteractionLocator[T]>;
}

async function invokeLocatorAction(
  locator: InteractionLocator,
  options: ActionOptions,
): Promise<void> {
  switch (options.action) {
    case 'pressKey':
      await requireMethod(locator, 'pressKey')(required(options.keyboardKey, 'keyboardKey'));
      return;
    case 'setCheckbox':
      await requireMethod(locator, 'setCheckbox')(required(options.checked, 'checked'));
      return;
    case 'selectOption':
      await requireMethod(locator, 'selectOption')(required(options.value, 'value'));
      return;
    case 'doubleClick':
    case 'tripleClick':
    case 'rightClick':
    case 'hover':
    case 'focus':
    case 'blur':
    case 'clear':
      await requireMethod(locator, options.action)();
      return;
    default:
      throw new Error(`Action ${options.action} requires ref or page-level handling`);
  }
}

async function waitForRef(page: InteractionPage, ref: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snapshot = await page.snapshot();
    if (snapshot.refs.some((entry) => entry.ref === ref)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for ref: ${ref}`);
}

async function withOptionalSnapshot(
  page: InteractionPage,
  includeSnapshot?: boolean,
): Promise<{ success: boolean; snapshot?: SnapshotResult }> {
  if (!includeSnapshot) return { success: true };
  return { success: true, snapshot: await page.snapshot() };
}

function matchesFindQuery(candidate: SnapshotRef, query: FindQuery): boolean {
  if (query.text != null && candidate.label !== query.text) return false;
  if (query.containsText != null && !candidate.label.includes(query.containsText)) return false;
  if (query.key != null && candidate.key !== query.key) return false;
  if (query.semanticsLabel != null && candidate.label !== query.semanticsLabel) return false;
  if (query.role != null && candidate.role !== query.role) return false;
  if (query.type != null && candidate.type !== query.type) return false;
  return true;
}

function parseRoles(input?: string): Set<string> {
  if (!input) return new Set();
  return new Set(input.split(',').map((role) => role.trim()).filter(Boolean));
}

function stringifyDefined(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    if (typeof value === 'boolean' || typeof value === 'number') {
      output[key] = String(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function assertActionSuccess(result: unknown, action: string): void {
  if (!result || typeof result !== 'object') return;
  const actionResult = result as { success?: boolean; error?: unknown };
  if (actionResult.success === false || actionResult.error != null) {
    throw new Error(`${action} failed: ${String(actionResult.error ?? 'unknown error')}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
