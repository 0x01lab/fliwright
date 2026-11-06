import type { FliwrightProjectConfig } from '@fliwright/core';
import { nativeScenarios } from './.fliwright/support/native-scenarios.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} for the dedicated Android native fixture host.`);
  return value;
}

export default {
  native: {
    enabled: true,
    platform: 'android',
    deviceId: required('FLIWRIGHT_NATIVE_DEVICE_ID'),
    targetAppId: required('FLIWRIGHT_NATIVE_APP_ID'),
    systemAppIds: [required('FLIWRIGHT_NATIVE_PERMISSION_APP_ID')],
    tools: { apkAnalyzer: process.env.FLIWRIGHT_NATIVE_APK_ANALYZER },
    timeoutMs: 20000,
  },
  scenarios: nativeScenarios,
} satisfies Partial<FliwrightProjectConfig>;
