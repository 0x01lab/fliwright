import { NativeError, type NativeConfig, type NativeOperationContext } from '@fliwright/core';
import { executeTool, type ToolExecutor } from '../ToolExecutor.js';

interface SimulatorDevice {
  udid: string;
  state: string;
  lastBootedAt: string;
}

/** Reads the boot generation reported by CoreSimulator for one exact booted UDID. */
export async function readSimulatorBootGeneration(config: NativeConfig, context: NativeOperationContext,
  executor: ToolExecutor = executeTool): Promise<string> {
  const output = await executor(config.tools?.xcrun ?? 'xcrun', ['simctl', 'list', '-j', 'devices', 'booted'], context);
  let value: unknown;
  try { value = JSON.parse(output.toString('utf8')); }
  catch { throw new NativeError('protocol_mismatch', 'CoreSimulator returned invalid boot identity data.'); }
  const devices = (value as { devices?: Record<string, unknown[]> } | null)?.devices;
  if (!devices || typeof devices !== 'object' || Array.isArray(devices)) {
    throw new NativeError('protocol_mismatch', 'CoreSimulator returned invalid boot identity data.');
  }
  const matching = Object.values(devices).flat().filter((item): item is SimulatorDevice => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const device = item as Record<string, unknown>;
    return typeof device.udid === 'string' && device.udid.toLowerCase() === config.deviceId.toLowerCase();
  });
  if (matching.length !== 1 || matching[0].state !== 'Booted' || !isTimestamp(matching[0].lastBootedAt)) {
    throw new NativeError('device_mismatch', 'The selected iOS Simulator has no unique, verifiable boot generation.');
  }
  return new Date(matching[0].lastBootedAt).toISOString();
}

/** Reads only the exact Runner labels from the selected Simulator launchd inventory. */
export async function readSimulatorRunnerPids(config: NativeConfig, context: NativeOperationContext,
  executor: ToolExecutor = executeTool): Promise<number[]> {
  const output = (await executor(config.tools?.xcrun ?? 'xcrun', ['simctl', 'spawn', config.deviceId, 'launchctl', 'list'], context)).toString('utf8');
  const lines = output.trim().split('\n');
  if (!/^PID\s+Status\s+Label$/.test(lines.shift() ?? '')) {
    throw new NativeError('protocol_mismatch', 'Simulator returned incomplete launchd process inventory.');
  }
  const pids: number[] = [];
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 3 || !/^(?:-|[1-9]\d*)$/.test(fields[0]) || !/^-?\d+$/.test(fields[1])) {
      throw new NativeError('protocol_mismatch', 'Simulator returned malformed launchd process inventory.');
    }
    if (!isRunnerLabel(fields.at(-1) ?? '') || fields[0] === '-') continue;
    if (!/^[1-9]\d*$/.test(fields[0]) || !Number.isSafeInteger(Number(fields[0]))) {
      throw new NativeError('protocol_mismatch', 'Simulator returned an invalid XCTest Runner process identity.');
    }
    pids.push(Number(fields[0]));
  }
  if (pids.length > 1) throw new NativeError('device_mismatch', 'Simulator reported multiple active XCTest Runner processes.');
  return pids;
}

function isRunnerLabel(label: string): boolean {
  const bundleId = 'dev.fliwright.NativeRunner.xctrunner';
  return label === bundleId || label === `application.${bundleId}`
    || new RegExp(`^UIKitApplication:${bundleId.replaceAll('.', '\\.')}\\[[A-Fa-f0-9]+\\]\\[rb-legacy\\]$`).test(label);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === canonical;
}
