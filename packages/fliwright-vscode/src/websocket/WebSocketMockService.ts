import type { FliwrightDriver, WebSocketMockCall, WebSocketMockPushResult, WebSocketMockRule } from '@fliwright/core';
import type { WebSocketMockProfileEntry, WebSocketMockPushTemplate } from '../types.js';

export class WebSocketMockService {
  async isSupported(driver: FliwrightDriver): Promise<boolean> {
    return driver.websocketMock.isSupported();
  }

  async applyProfile(driver: FliwrightDriver, profile: WebSocketMockProfileEntry): Promise<void> {
    await driver.websocketMock.setRules(profile.profile.rules);
  }

  async clearRules(driver: FliwrightDriver): Promise<void> {
    await driver.websocketMock.clearRules();
  }

  async sendPush(driver: FliwrightDriver, push: WebSocketMockPushTemplate): Promise<WebSocketMockPushResult> {
    return driver.websocketMock.push(push);
  }

  async getActiveRules(driver: FliwrightDriver): Promise<WebSocketMockRule[]> {
    return driver.websocketMock.getRules();
  }

  async getCalls(driver: FliwrightDriver): Promise<WebSocketMockCall[]> {
    return driver.websocketMock.getCalls();
  }

  async clearCalls(driver: FliwrightDriver): Promise<void> {
    await driver.websocketMock.clearCalls();
  }
}
