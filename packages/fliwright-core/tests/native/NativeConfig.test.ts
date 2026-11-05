import { writeFliwrightConfigSnapshot } from '@fliwright/core';
import { describe, expect, it } from 'vitest';
import { fliwrightConfigSchema, mergeFliwrightConfig, readFliwrightEnvironment } from '../../src/RecordingConfig.js';

const native = { enabled: true, platform: 'android' as const, deviceId: 'selected-device', targetAppId: 'dev.example.app', backend: 'adb' as const,
  systemAppIds: ['com.android.permissioncontroller'], timeoutMs: 9000, cleanupTimeoutMs: 12000,
  fingerprints: { enrolledId: 1, unenrolledId: 2 } };

describe('native configuration process boundary', () => {
  it('round-trips the explicitly selected Android APK analyzer and rejects invalid executables', () => {
    const configured = { ...native, tools: { adb: '/owned/adb', apkAnalyzer: '/owned tools/apkanalyzer' } };
    expect(readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: writeFliwrightConfigSnapshot({ native: configured }) }).native).toEqual(configured);
    for (const apkAnalyzer of ['', 'bad\0path', 42]) {
      expect(() => fliwrightConfigSchema.parse({ native: { ...native, tools: { apkAnalyzer } } })).toThrow();
    }
  });
  it('keeps native disabled by default and round-trips an explicitly selected device', () => {
    expect(mergeFliwrightConfig().native).toBeUndefined();
    const environment = readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: writeFliwrightConfigSnapshot({ native }) });
    expect(mergeFliwrightConfig({ environment }).native).toEqual(native);
    expect(mergeFliwrightConfig({ environment, explicit: { native: { ...native, enabled: false } } }).native?.enabled).toBe(false);
  });

  it.each([
    { ...native, fingerprints: { enrolledId: 1, unenrolledId: 2, baselineVerified: true } },
    { ...native, fingerprints: { enrolledId: 1, unenrolledId: 2, baselineVerified: false } },
    { ...native, backend: 'xctest' }, { ...native, deviceId: '' }, { ...native, timeoutMs: 0 },
    { ...native, cleanupTimeoutMs: Infinity }, { ...native, tools: { shell: 'bash' } },
    { ...native, fingerprints: { enrolledId: 1, unenrolledId: 1, baselineVerified: true } },
    { ...native, fingerprints: { enrolledId: -1, unenrolledId: 2, baselineVerified: true } },
    { ...native, targetAppId: 'dev.example.app\0oops' },
  ])('rejects invalid native settings before tools or leases can start: %j', value => {
    expect(() => fliwrightConfigSchema.parse({ native: value })).toThrow();
  });

  it('transports the explicit prepared iOS product and rejects unknown options', () => {
    const ios = { enabled: true, platform: 'ios', deviceId: 'selected-simulator', targetAppId: 'dev.example.app',
      ios: { xctestrunPath: '/cache/runner.xctestrun', startupTimeoutMs: 120000 } };
    expect(readFliwrightEnvironment({ FLIWRIGHT_CONFIG_PATH: writeFliwrightConfigSnapshot({ native: ios }) }).native).toEqual(ios);
    expect(() => fliwrightConfigSchema.parse({ native: { ...ios, ios: { ...ios.ios, secretToken: 'untrusted' } } })).toThrow();
  });
});
