import type { FailureContext } from './types.js';
import type { AssertionError } from './Assertion.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class FailureCollector {
  constructor(private sendRequest: SendRequest) {}

  async collect(error: AssertionError, timeout: number): Promise<FailureContext> {
    const [screenshot, widgetTree, source] = await Promise.all([
      this._takeScreenshot(),
      this._collectWidgetTree(),
      Promise.resolve(this._extractSource(error)),
    ]);
    return {
      assertion: { matcher: error.matcher, expected: error.expected, actual: error.actual, timeout },
      screenshot,
      widgetTree,
      source,
      timestamp: new Date().toISOString(),
    };
  }

  private async _takeScreenshot(): Promise<Buffer | null> {
    try {
      const result = await this.sendRequest('ext.flutter.driver.screenshot', {});
      if (result && typeof result === 'object' && 'screenshot' in result) {
        const data = (result as { screenshot?: string }).screenshot;
        if (data) return Buffer.from(data, 'base64');
      }
      return null;
    } catch { return null; }
  }

  private async _collectWidgetTree(): Promise<object> {
    try {
      return (await this.sendRequest('ext.fliwright.inspect', { selector: '' })) as object;
    } catch { return { error: 'Failed to collect widget tree' }; }
  }

  private _extractSource(error: AssertionError): { file: string; line: number; snippet: string } {
    const stack = error.stack ?? '';
    const match = stack.match(/at\s+.*\(([^)]+):(\d+):\d+\)/);
    if (match) {
      return { file: match[1], line: parseInt(match[2], 10), snippet: error.message };
    }
    return { file: '<unknown>', line: 0, snippet: error.message };
  }
}
