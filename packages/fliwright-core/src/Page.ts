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
