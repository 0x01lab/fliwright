export type DevicePlatform = 'ios' | 'android';
export type DeviceState = 'online' | 'offline' | 'unauthorized' | 'shutdown' | 'unavailable' | 'unknown';
export type DiscoverySource = 'adb' | 'android-emulator' | 'ios-simulator' | 'ios-device';

/** A host device, independent of any app, VM Service or cloud execution slot. */
export interface DiscoveredDevice {
  /** Native device ID; stopped Android AVDs use avd:<name> and cannot launch an app with this ID. */
  id: string;
  name: string;
  platform: DevicePlatform;
  kind: 'physical' | 'simulator';
  state: DeviceState;
  osVersion?: string;
  model?: string;
  avdName?: string;
  detail?: string;
}
export interface DiscoveryDiagnostic {
  source: DiscoverySource;
  code: 'missing-tool' | 'command-failed' | 'invalid-output' | 'unsupported-host';
  message: string;
}
/** A completed scan; diagnostics distinguish partial detection from an empty host. */
export interface DeviceInventory {
  scannedAt: string;
  devices: DiscoveredDevice[];
  diagnostics: DiscoveryDiagnostic[];
}
export interface DeviceDiscoveryOptions {
  /** Override native executable paths. Android SDK environment variables and standard SDK locations are detected. */
  tools?: Partial<Record<'adb' | 'emulator' | 'xcrun', string>>;
  hostPlatform?: NodeJS.Platform;
}
export interface DeviceScanOptions {
  /** Defaults to Android plus iOS on macOS, and Android on other hosts. */
  platforms?: DevicePlatform[];
  /** Timeout for each native command, in milliseconds. Defaults to 8000. */
  timeoutMs?: number;
  signal?: AbortSignal;
}
