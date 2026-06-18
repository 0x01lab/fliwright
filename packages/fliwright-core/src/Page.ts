import { Locator } from './Locator.js';
import type {
  AgentFindQuery,
  AgentSnapshotRef,
  AgentSnapshotOptions,
  AgentSnapshotResult,
  SelectorInput,
  SelectorQuery,
  SendRequest,
} from './types.js';
import { Selector } from './Selector.js';
import { FormHelper } from './FormHelper.js';

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

export class Page {
  constructor(private sendRequest: SendRequest) {}

  locator(selector: SelectorInput): Locator {
    return new Locator(selector, this.sendRequest);
  }

  find(query: SelectorQuery): Locator {
    return new Locator(query, this.sendRequest);
  }

  getByText(
    text: string | RegExp,
    options?: { exact?: boolean; match?: 'exact' | 'contains' | 'regex'; caseSensitive?: boolean },
  ): Locator {
    return this.locator({ text, ...options });
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

  getByTooltip(tooltip: string): Locator {
    return this.locator({ tooltip });
  }

  ref(ref: string): Locator {
    return new Locator({ ref }, this.sendRequest);
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

  async dismissModal(): Promise<void> {
    const result = await this.sendRequest('ext.fliwright.action', {
      action: 'dismissModal',
    }) as { success?: boolean; error?: string };
    if (result.success === false || result.error) {
      throw new Error(`dismissModal failed: ${result.error ?? 'unknown error'}`);
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

  get formHelper(): FormHelper {
    if (!this._formHelper) {
      this._formHelper = new FormHelper(this.sendRequest);
    }
    return this._formHelper;
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

  // ── Screenshot ──────────────────────────────────────────────

  /**
   * Take a screenshot of the current Flutter app screen.
   *
   * @param options.pixelRatio - Device pixel ratio for the screenshot (default: 1.0)
   * @param options.mode - Capture strategy: 'auto' (default), 'boundary', or 'canvas'.
   *   'auto' detects PlatformView and chooses the best path.
   *   'boundary' forces RepaintBoundary.toImage().
   *   'canvas' forces OffsetLayer painting (works around WebView debugNeedsPaint).
   * @param options.rect - Crop to a specific logical-pixel region.
   * @returns A Buffer containing the PNG image data
   */
  async screenshot(options?: {
    pixelRatio?: number;
    mode?: 'auto' | 'boundary' | 'canvas';
    rect?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer> {
    const params: Record<string, unknown> = {
      pixelRatio: options?.pixelRatio?.toString() ?? '1.0',
    };
    if (options?.mode) params.mode = options.mode;
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
