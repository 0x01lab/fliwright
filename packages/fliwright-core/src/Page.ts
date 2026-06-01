import { Locator } from './Locator.js';
import type { SelectorInput, SendRequest } from './types.js';
import { Selector } from './Selector.js';
import { FormHelper } from './FormHelper.js';

export class Page {
  constructor(private sendRequest: SendRequest) {}

  locator(selector: SelectorInput): Locator {
    return new Locator(selector, this.sendRequest);
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
    throw new Error(`Timeout waiting for selector: ${selectorObj.toWireFormat()}`);
  }

  private _formHelper: FormHelper | null = null;

  get formHelper(): FormHelper {
    if (!this._formHelper) {
      this._formHelper = new FormHelper(this.sendRequest);
    }
    return this._formHelper;
  }
}
