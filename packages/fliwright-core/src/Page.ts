import { Locator } from './Locator.js';
import type { SelectorInput, SelectorQuery, SendRequest } from './types.js';
import { Selector } from './Selector.js';
import { FormHelper } from './FormHelper.js';

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
   * @returns A Buffer containing the PNG image data
   */
  async screenshot(options?: { pixelRatio?: number }): Promise<Buffer> {
    const result = (await this.sendRequest('ext.fliwright.screenshot', {
      pixelRatio: options?.pixelRatio?.toString() ?? '1.0',
    })) as {
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
}
