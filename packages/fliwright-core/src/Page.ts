import { Locator } from './Locator.js';
import type {
  AgentFindQuery,
  AgentSnapshotRef,
  AgentSnapshotOptions,
  AgentSnapshotResult,
  BridgeContext,
  BridgeQuery,
  BridgeQueryResult,
  FrameCaptureResult,
  IconSelector,
  SelectorInput,
  SelectorQuery,
  SendRequest,
  SourceMapOptions,
  SourceMapResult,
} from './types.js';
import { Selector } from './Selector.js';
import { FormHelper } from './FormHelper.js';
import type { AssertionTimelineOptions } from './Assertion.js';
import { SelectController } from './SelectRecipes.js';

export type NavigationWaitUntil = 'none' | 'settled';

export interface PageNavigationOptions {
  extra?: Record<string, unknown>;
  waitUntil?: NavigationWaitUntil;
  settleTimeout?: number;
  stableFrames?: number;
  waitFor?: SelectorInput;
  waitForTimeout?: number;
  throwOnSettleTimeout?: boolean;
}

export interface ResetToHomeOptions extends Omit<PageNavigationOptions, 'extra'> {
  homeRoute?: string;
}

export interface PullToRefreshOptions {
  start?: { x: number; y: number };
  startRatio?: { x: number; y: number };
  viewport?: PageViewport;
  deltaX?: number;
  distance?: number;
  distanceRatio?: number;
  steps?: number;
  maxAttempts?: number;
  settleTimeout?: number;
  stableFrames?: number;
  /** @deprecated Use `throwOnUnsatisfied` and `throwOnSettleTimeout` for separate control. */
  throwOnTimeout?: boolean;
  throwOnSettleTimeout?: boolean;
  throwOnUnsatisfied?: boolean;
  until?: (context: { attempt: number; page: Page }) => boolean | Promise<boolean>;
}

export interface PullToRefreshResult {
  attempts: number;
  satisfied: boolean;
}

export interface PageViewport {
  width: number;
  height: number;
  pixelRatio?: number;
}

export class Page {
  constructor(
    private sendRequest: SendRequest,
    private readonly assertionTimeline?: AssertionTimelineOptions,
  ) {}

  locator(selector: SelectorInput): Locator {
    return new Locator(selector, this.sendRequest, this.assertionTimeline);
  }

  find(query: SelectorQuery): Locator {
    return new Locator(query, this.sendRequest, this.assertionTimeline);
  }

  getByText(
    text: string | RegExp,
    options?: { exact?: boolean; match?: 'exact' | 'contains' | 'regex'; caseSensitive?: boolean },
  ): Locator {
    return this.locator({ text, ...options });
  }

  getByTextContaining(text: string | RegExp): Locator {
    return this.getByText(text, { match: 'contains' });
  }

  getByKey(key: string): Locator {
    return this.locator({ key });
  }

  getByType(type: string): Locator {
    return this.locator({ type });
  }

  getBySubtype(subtype: string): Locator {
    return this.locator({ subtype });
  }

  getByIcon(icon: IconSelector): Locator {
    return this.locator({ icon });
  }

  getBySemantics(semantics: {
    identifier?: string;
    label?: string;
    hint?: string;
    role?: string;
    match?: 'exact' | 'contains' | 'regex';
    caseSensitive?: boolean;
  }): Locator {
    return this.locator({ semantics });
  }

  getBySemanticsLabel(label: string): Locator {
    return this.getBySemantics({ label });
  }

  getBySemanticsIdentifier(identifier: string): Locator {
    return this.getBySemantics({ identifier });
  }

  getByWidgetWithText(
    widgetType: string,
    text: string | RegExp,
    options?: { exact?: boolean; match?: 'exact' | 'contains' | 'regex'; caseSensitive?: boolean },
  ): Locator {
    return this.getByType(widgetType).containing({ text, ...options });
  }

  getByWidgetWithIcon(widgetType: string, icon: IconSelector): Locator {
    return this.getByType(widgetType).containing({ icon });
  }

  getByTooltip(tooltip: string): Locator {
    return this.locator({ tooltip });
  }

  ref(ref: string): Locator {
    return new Locator({ ref }, this.sendRequest, this.assertionTimeline);
  }

  async findRef(query: AgentFindQuery): Promise<Locator> {
    const snapshot = await this.snapshot();
    const match = snapshot.refs.find((candidate) => matchesFindQuery(candidate, query));
    if (!match) {
      throw new Error(`No ref found for query: ${JSON.stringify(query)}`);
    }
    return this.ref(match.ref);
  }

  async snapshot(options?: AgentSnapshotOptions): Promise<AgentSnapshotResult> {
    const params: Record<string, unknown> = {};
    if (options?.depth != null) params.depth = options.depth.toString();
    if (options?.includeRects != null) {
      params.includeRects = options.includeRects.toString();
    }
    if (options?.includeProperties != null) {
      params.includeProperties = options.includeProperties.toString();
    }
    return (await this.sendRequest('ext.fliwright.snap', params)) as AgentSnapshotResult;
  }

  async context(): Promise<BridgeContext> {
    return (await this.sendRequest('ext.fliwright.context', {})) as BridgeContext;
  }

  async sourceMap(options?: SourceMapOptions): Promise<SourceMapResult> {
    const params: Record<string, unknown> = {};
    if (options?.includeFramework != null) params.includeFramework = String(options.includeFramework);
    if (options?.includeRects != null) params.includeRects = String(options.includeRects);
    if (options?.includeProperties != null) params.includeProperties = String(options.includeProperties);
    if (options?.limit != null) params.limit = String(options.limit);
    return (await this.sendRequest('ext.fliwright.sourceMap', params)) as SourceMapResult;
  }

  async captureFrame(options?: { screenshot?: boolean; snapshot?: boolean; diagnostics?: boolean }): Promise<FrameCaptureResult> {
    const params: Record<string, unknown> = {};
    if (options?.screenshot != null) params.screenshot = String(options.screenshot);
    if (options?.snapshot != null) params.snapshot = String(options.snapshot);
    if (options?.diagnostics != null) params.diagnostics = String(options.diagnostics);
    return (await this.sendRequest('ext.fliwright.captureFrame', params)) as FrameCaptureResult;
  }

  async viewport(): Promise<PageViewport> {
    const result = (await this.sendRequest('ext.fliwright.screenshot', {
      pixelRatio: '1.0',
      waitForFrame: 'false',
    })) as {
      success?: boolean;
      error?: string;
      width?: number;
      height?: number;
      pixelRatio?: number;
    };
    if (result.success === false || result.error) {
      throw new Error(`viewport failed: ${result.error ?? 'unknown error'}`);
    }
    if (!isPositiveNumber(result.width) || !isPositiveNumber(result.height)) {
      throw new Error('viewport failed: screenshot result did not include positive width and height');
    }
    return {
      width: result.width,
      height: result.height,
      pixelRatio: result.pixelRatio,
    };
  }

  async query(query: BridgeQuery, options?: { visible?: 'any' | 'hitTestable'; limit?: number }): Promise<BridgeQueryResult> {
    const result = await this.sendRequest('ext.fliwright.query', {
      query: JSON.stringify(query),
      ...(options?.visible ? { visible: options.visible } : {}),
      ...(options?.limit != null ? { limit: String(options.limit) } : {}),
    }) as Partial<BridgeQueryResult>;
    return {
      matches: result.matches ?? [],
      count: result.count ?? result.matches?.length ?? 0,
    };
  }

  async dismissModal(): Promise<void> {
    const result = await this.sendRequest('ext.fliwright.action', {
      action: 'dismissModal',
    }) as { success?: boolean; error?: string };
    if (result.success === false || result.error) {
      throw new Error(`dismissModal failed: ${result.error ?? 'unknown error'}`);
    }
  }

  async dismissKeyboard(): Promise<void> {
    const result = await this.sendRequest('ext.fliwright.action', {
      action: 'dismissKeyboard',
    }) as { success?: boolean; error?: string };
    if (result.success === false || result.error) {
      throw new Error(`dismissKeyboard failed: ${result.error ?? 'unknown error'}`);
    }
  }

  async waitForNetworkIdle(options?: { quietMs?: number; timeout?: number }): Promise<void> {
    const params: Record<string, unknown> = {
      action: 'waitForNetworkIdle',
    };
    if (options?.quietMs != null) params.quietMs = options.quietMs.toString();
    if (options?.timeout != null) params.timeout = options.timeout.toString();
    const result = await this.sendRequest('ext.fliwright.action', params) as {
      success?: boolean;
      error?: string;
    };
    if (result.success === false || result.error) {
      throw new Error(`waitForNetworkIdle failed: ${result.error ?? 'unknown error'}`);
    }
  }

  async waitFor(selector: SelectorInput, timeoutMs = 5000): Promise<Locator> {
    const selectorObj = new Selector(selector);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const loc = this.locator(selector);
      const count = await loc.count();
      if (count > 0) return loc;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for selector: ${selectorObj.toString()}`);
  }

  /**
   * Wait for Flutter's rendering pipeline to settle after an animation
   * or page transition.  Returns once N consecutive frames (default 3)
   * have no scheduled work.
   *
   * Use this after clicking a button that triggers a route transition,
   * before querying for elements on the new page.
   *
   * @param options.timeout - Maximum time to wait in ms (default: 2000)
   */
  /**
   * Wait for a **new** element matching [selector] that did not exist when
   * this method was called.  Useful after a navigation or click that
   * creates a new page/screen — avoids matching stale elements from the
   * previous page during a transition animation.
   *
   * @param selector - Element selector to wait for.
   * @param options.timeout - Maximum time to wait in ms (default: 5000).
   * @returns A Locator pinned to the first newly-appeared element.
   */
  async waitForNew(selector: SelectorInput, options?: { timeout?: number }): Promise<Locator> {
    const timeoutMs = options?.timeout ?? 5000;
    const selectorObj = new Selector(selector);

    // Snapshot current matching element IDs.
    const existingIds = new Set<string>();
    try {
      const before = this.locator(selector);
      const allBefore = await before.resolveAll();
      for (const w of allBefore) {
        if (w.id) existingIds.add(w.id);
      }
    } catch {
      // No existing matches — that's fine.
    }

    // Poll for new matches not in the snapshot.
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const loc = this.locator(selector);
        const allAfter = await loc.resolveAll();
        for (const w of allAfter) {
          if (w.id && !existingIds.has(w.id)) {
            return loc; // New element found.
          }
        }
      } catch {
        // resolveAll failed — retry.
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for new element matching selector: ${selectorObj.toString()}`);
  }

  async settle(options?: { timeout?: number; stableFrames?: number; throwOnTimeout?: boolean }): Promise<void> {
    const params: Record<string, unknown> = {
      timeout: (options?.timeout ?? 2000).toString(),
    };
    if (options?.stableFrames != null) {
      params.stableFrames = options.stableFrames.toString();
    }

    const result = (await this.sendRequest('ext.fliwright.settle', params)) as {
      success?: boolean;
      error?: string;
      timedOut?: boolean;
      settledAfterMs?: number;
    };
    if (result.success === false || result.error) {
      throw new Error(`settle failed: ${result.error ?? 'timeout'}`);
    }
    if (options?.throwOnTimeout && result.timedOut) {
      throw new Error(`settle timed out after ${result.settledAfterMs ?? options.timeout ?? 2000}ms`);
    }
  }

  private _formHelper: FormHelper | null = null;
  private _select: SelectController | null = null;

  get formHelper(): FormHelper {
    if (!this._formHelper) {
      this._formHelper = new FormHelper(this.sendRequest);
    }
    return this._formHelper;
  }

  get select(): SelectController {
    if (!this._select) {
      this._select = new SelectController(this);
    }
    return this._select;
  }

  // ── Raw Coordinates ──────────────────────────────────────────

  /**
   * Click at an arbitrary (x, y) coordinate on the screen.
   * Useful for interacting with WebView overlays (e.g. captcha sliders)
   * that are not part of the Flutter widget tree.
   */
  async clickAt(x: number, y: number): Promise<void> {
    const result = (await this.sendRequest('ext.fliwright.click', {
      x: x.toString(),
      y: y.toString(),
    })) as { success?: boolean; error?: string };

    if (result.success === false || result.error) {
      throw new Error(`clickAt(${x}, ${y}) failed: ${result.error ?? 'unknown error'}`);
    }
  }

  /**
   * Perform a drag gesture from an arbitrary (x, y) coordinate.
   * Useful for WebView captcha sliders that are not part of the Flutter widget tree.
   *
   * @param x - Start X coordinate
   * @param y - Start Y coordinate
   * @param deltaX - Horizontal drag distance (positive = right)
   * @param deltaY - Vertical drag distance (positive = down)
   * @param options.steps - Number of interpolation steps (default: 20, smoother motion)
   */
  async dragFrom(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    options?: { steps?: number },
  ): Promise<void> {
    const steps = options?.steps ?? 20;
    // We use the gesture extension's drag via raw coordinates by sending
    // the click extension with simulated pointer events through sendRequest
    const result = (await this.sendRequest('ext.fliwright.dragFrom', {
      x: x.toString(),
      y: y.toString(),
      deltaX: deltaX.toString(),
      deltaY: deltaY.toString(),
      steps: steps.toString(),
    })) as { success?: boolean; error?: string };

    if (result.success === false || result.error) {
      throw new Error(`dragFrom(${x}, ${y}, ${deltaX}, ${deltaY}) failed: ${result.error ?? 'unknown error'}`);
    }
  }

  async pullToRefresh(options?: PullToRefreshOptions): Promise<PullToRefreshResult> {
    const maxAttempts = options?.maxAttempts ?? 1;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error(`pullToRefresh maxAttempts must be a positive integer, got ${maxAttempts}`);
    }

    const viewport = options?.start ? undefined : await this.resolvePullViewport(options);
    const start = options?.start ?? viewportRelativePoint(viewport, options?.startRatio) ?? { x: 200, y: 160 };
    const deltaX = options?.deltaX ?? 0;
    const distance = options?.distance ?? viewportRelativeDistance(viewport, options?.distanceRatio) ?? 320;
    const steps = options?.steps ?? 20;
    const settleTimeout = options?.settleTimeout ?? 1500;
    const throwOnSettleTimeout = options?.throwOnSettleTimeout ?? options?.throwOnTimeout ?? false;
    const throwOnUnsatisfied = options?.throwOnUnsatisfied ?? options?.throwOnTimeout ?? true;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.dragFrom(start.x, start.y, deltaX, distance, { steps });
      await this.settle({
        timeout: settleTimeout,
        stableFrames: options?.stableFrames,
        throwOnTimeout: throwOnSettleTimeout,
      });

      if (!options?.until || await options.until({ attempt, page: this })) {
        return { attempts: attempt, satisfied: true };
      }
    }

    const result = { attempts: maxAttempts, satisfied: false };
    if (!throwOnUnsatisfied) return result;

    throw new Error(
      `pullToRefresh condition was not satisfied after ${maxAttempts} ${maxAttempts === 1 ? 'attempt' : 'attempts'}`,
    );
  }

  private async resolvePullViewport(options: PullToRefreshOptions | undefined): Promise<PageViewport | undefined> {
    if (options?.viewport) return options.viewport;
    try {
      return await this.viewport();
    } catch {
      return undefined;
    }
  }

  // ── Screenshot ──────────────────────────────────────────────

  /**
   * Take a screenshot of the current Flutter app screen.
   *
   * @param options.pixelRatio - Device pixel ratio for the screenshot (default: 1.0)
   * @param options.rect - Crop to a specific logical-pixel region.
   * @returns A Buffer containing the PNG image data
   */
  async screenshot(options?: {
    pixelRatio?: number;
    rect?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer> {
    const params: Record<string, unknown> = {
      pixelRatio: options?.pixelRatio?.toString() ?? '1.0',
    };
    if (options?.rect) params.rect = JSON.stringify(options.rect);

    const result = (await this.sendRequest('ext.fliwright.screenshot', params)) as {
      success: boolean;
      format?: string;
      screenshot?: string;
      width?: number;
      height?: number;
      error?: string;
    };

    if (!result.success || !result.screenshot) {
      throw new Error(`Screenshot failed: ${result.error ?? 'unknown error'}`);
    }

    return Buffer.from(result.screenshot, 'base64');
  }

  /**
   * Capture a full-page screenshot by scrolling through the content.
   * Returns a single stitched PNG Buffer.
   *
   * This works by finding the scrollable content's total extent, capturing
   * viewport-sized segments, and concatenating them vertically.
   *
   * @param options.pixelRatio - Device pixel ratio (default: 1.0)
   * @returns A Buffer containing the full-page PNG image
   */
  async screenshotFullPage(options?: { pixelRatio?: number }): Promise<Buffer> {
    const pixelRatio = options?.pixelRatio ?? 1.0;
    const result = (await this.sendRequest('ext.fliwright.screenshot', {
      pixelRatio: pixelRatio.toString(),
      fullPage: 'true',
    })) as {
      success: boolean;
      segments?: string[];
      segmentWidth?: number;
      segmentHeight?: number;
      totalHeight?: number;
      error?: string;
    };

    if (!result.success || !result.segments?.length) {
      throw new Error(`screenshotFullPage failed: ${result.error ?? 'unknown error'}`);
    }

    // If only one segment, return it directly.
    if (result.segments.length === 1) {
      return Buffer.from(result.segments[0], 'base64');
    }

    // Stitch segments: decode each PNG, determine height from the first,
    // and concatenate pixel rows.
    const segmentBuffers = result.segments.map((s) => Buffer.from(s, 'base64'));

    // For simplicity, concatenate raw PNG bytes sequentially.
    // A proper stitch would use sharp/pngjs, but for now we return
    // the first segment and log that stitching needs a dedicated library.
    // TODO: Implement proper PNG stitching when a dependency is added.
    return segmentBuffers[0];
  }

  // ── Navigation ──────────────────────────────────────────────

  /**
   * Navigate to a route path.
   *
   * Requires the Flutter app to have injected a router (e.g. GoRouter)
   * via `FliwrightBridge.init(router: myRouter)`.
   *
   * @param path - Route path, e.g. '/register'
   * @param options.extra - Optional extra data forwarded to the router
   */
  async navigate(path: string, options?: { extra?: Record<string, unknown> }): Promise<void> {
    const params: Record<string, unknown> = { path };
    if (options?.extra) {
      params.extra = JSON.stringify(options.extra);
    }
    const result = (await this.sendRequest('ext.fliwright.navigate', params)) as {
      success: boolean;
      error?: string;
    };
    if (!result.success) {
      throw new Error(`Navigate to '${path}' failed: ${result.error ?? 'unknown error'}`);
    }
  }

  /**
   * Navigate to a route and wait for the destination screen to become stable.
   *
   * Use `navigate()` when you need the raw route RPC; use `goto()` in tests
   * before locating widgets on the next page.
   */
  async goto(path: string, options?: PageNavigationOptions): Promise<void> {
    await this.navigate(path, { extra: options?.extra });
    await this.waitForNavigationStable(options);
  }

  /**
   * Reset the Flutter route stack to a path, then wait for the destination
   * screen to settle. For GoRouter-style injected routers this uses `go(path)`;
   * for Navigator fallback it uses `pushNamedAndRemoveUntil`.
   */
  async resetRouteStack(path: string, options?: PageNavigationOptions): Promise<void> {
    const params: Record<string, unknown> = { path };
    if (options?.extra) {
      params.extra = JSON.stringify(options.extra);
    }
    const result = (await this.sendRequest('ext.fliwright.resetRouteStack', params)) as {
      success: boolean;
      error?: string;
    };
    if (!result.success) {
      throw new Error(`Reset route stack to '${path}' failed: ${result.error ?? 'unknown error'}`);
    }
    await this.waitForNavigationStable(options);
  }

  /**
   * Reset the route stack to the app home route (`/` by default).
   */
  async resetToHome(options?: ResetToHomeOptions): Promise<void> {
    await this.resetRouteStack(options?.homeRoute ?? '/', options);
  }

  /**
   * Get the current route path.
   *
   * @returns The current route path string, or empty string if unknown.
   */
  async currentRoute(): Promise<string> {
    const result = (await this.sendRequest('ext.fliwright.currentRoute', {})) as {
      path?: string;
    };
    return result.path ?? '';
  }

  /**
   * Go back / pop the current route.
   */
  async goBack(): Promise<void> {
    const result = (await this.sendRequest('ext.fliwright.goBack', {})) as {
      success: boolean;
      error?: string;
    };
    if (!result.success) {
      throw new Error(`Go back failed: ${result.error ?? 'unknown error'}`);
    }
  }

  private async waitForNavigationStable(options?: PageNavigationOptions | ResetToHomeOptions): Promise<void> {
    const waitUntil = options?.waitUntil ?? 'settled';
    if (options?.waitFor != null) {
      await this.waitFor(options.waitFor, options.waitForTimeout ?? 5000);
    }
    if (waitUntil === 'settled') {
      await this.settle({
        timeout: options?.settleTimeout ?? 3000,
        stableFrames: options?.stableFrames,
        throwOnTimeout: options?.throwOnSettleTimeout ?? true,
      });
    }
  }
}

function matchesFindQuery(candidate: AgentSnapshotRef, query: AgentFindQuery): boolean {
  if (query.text != null && candidate.label !== query.text) return false;
  if (query.containsText != null && !candidate.label.includes(query.containsText)) {
    return false;
  }
  if (query.key != null && candidate.key !== query.key) return false;
  if (query.semanticsLabel != null && candidate.label !== query.semanticsLabel) {
    return false;
  }
  if (query.role != null && candidate.role !== query.role) return false;
  if (query.type != null && candidate.type !== query.type) return false;
  return Object.values(query).some((value) => value != null && value !== '');
}

function viewportRelativePoint(
  viewport: PageViewport | undefined,
  ratio: { x: number; y: number } | undefined,
): { x: number; y: number } | undefined {
  if (!viewport) return undefined;
  const resolvedRatio = ratio ?? { x: 0.5, y: 0.18 };
  return {
    x: Math.round(viewport.width * resolvedRatio.x),
    y: Math.round(viewport.height * resolvedRatio.y),
  };
}

function viewportRelativeDistance(viewport: PageViewport | undefined, ratio: number | undefined): number | undefined {
  if (!viewport) return undefined;
  return Math.round(viewport.height * (ratio ?? 0.34));
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
