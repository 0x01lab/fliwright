import { Locator } from './Locator.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class Page {
  constructor(private sendRequest: SendRequest) {}

  locator(selector: string): Locator {
    return new Locator(selector, this.sendRequest);
  }

  async waitFor(selector: string, timeoutMs = 5000): Promise<Locator> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const loc = this.locator(selector);
      const count = await loc.count();
      if (count > 0) return loc;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }
}
