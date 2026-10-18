import { inspectionOutput } from '../InspectionOutput.js';
import { CliError } from '../CommandRegistry.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  actionInteraction,
  dragInteraction,
  navigateInteraction,
  observeInteraction,
  tapInteraction,
  typeInteraction,
  waitInteraction,
  type ActionName,
  type NavigationAction,
  type NavigationOptions,
} from '../capabilities/interaction.js';
import { withAppSession, type AppSessionDeps, type AppSessionOptions } from '../capabilities/session.js';

export interface AppObserveOptions extends AppSessionOptions {
  intent?: string;
  roles?: string;
  limit?: number;
  includeDiagnostics?: boolean;
}

export interface AppInteractOptions extends AppSessionOptions, NavigationOptions {
  operation: 'tap' | 'type' | 'navigate' | 'wait' | 'drag' | 'action';
  ref?: string;
  key?: string;
  text?: string;
  type?: string;
  value?: string | number;
  replace?: boolean;
  path?: string;
  homeRoute?: string;
  navigationAction?: NavigationAction;
  timeout?: number;
  deltaX?: number;
  deltaY?: number;
  steps?: number;
  x?: number;
  y?: number;
  action?: ActionName;
  keyboardKey?: string;
  checked?: boolean;
  quietMs?: number;
  includeSnapshot?: boolean;
}

export async function appStatusCommand(options: AppSessionOptions, deps: AppSessionDeps = {}) {
  return withAppSession(options, async ({ driver, vmServiceUrl }) => ({
    connected: true,
    vmServiceUrl,
    dartSdkVersion: driver.sdkVersion,
  }), deps);
}

export async function appObserveCommand(options: AppObserveOptions, deps: AppSessionDeps = {}) {
  return withAppSession(options, ({ driver }) => observeInteraction(driver, options), deps);
}

export async function appInteractCommand(options: AppInteractOptions, deps: AppSessionDeps = {}): Promise<unknown> {
  if (!['tap', 'type', 'navigate', 'wait', 'drag', 'action'].includes(options.operation)) {
    throw new CliError('INVALID_INPUT', `Unknown interaction operation: ${options.operation}`, 2);
  }
  if (options.operation === 'type' && typeof options.value !== 'string') throw new CliError('INVALID_INPUT', 'app interact type requires --value', 2);
  if (options.operation === 'drag' && (options.deltaX === undefined || options.deltaY === undefined)) {
    throw new CliError('INVALID_INPUT', 'app interact drag requires --delta-x and --delta-y', 2);
  }
  if (options.operation === 'action' && !options.action) throw new CliError('INVALID_INPUT', 'app interact action requires --action', 2);
  const targetCount = [options.ref, options.key, options.text, options.type].filter((value) => value !== undefined).length;
  const globalAction = options.operation === 'action' && ['dismissModal', 'dismissKeyboard', 'waitForNetworkIdle'].includes(options.action ?? '');
  const coordinates = (options.operation === 'drag' || options.action === 'drag') && options.x !== undefined && options.y !== undefined;
  if (options.operation !== 'navigate' && !globalAction && !coordinates && targetCount !== 1) throw new CliError('INVALID_INPUT', 'Choose exactly one target: ref, key, text, or type.', 2);
  if (options.operation === 'navigate' && (options.navigationAction ?? 'goto') !== 'resetToHome' && !options.path) throw new CliError('INVALID_INPUT', 'Navigation requires path.', 2);
  if (options.action === 'pressKey' && !options.keyboardKey) throw new CliError('INVALID_INPUT', 'pressKey requires keyboardKey.', 2);
  if (options.action === 'setCheckbox' && options.checked === undefined) throw new CliError('INVALID_INPUT', 'setCheckbox requires checked.', 2);
  if (options.action === 'selectOption' && options.value === undefined) throw new CliError('INVALID_INPUT', 'selectOption requires value.', 2);
  return withAppSession(options, async ({ driver }) => {
    const target = {
      ref: options.ref,
      key: options.key,
      text: options.text,
      type: options.type,
      includeSnapshot: options.includeSnapshot,
    };
    switch (options.operation) {
      case 'tap': return tapInteraction(driver, target);
      case 'type':
        if (typeof options.value !== 'string') throw new CliError('INVALID_INPUT', 'app interact type requires --value', 2);
        return typeInteraction(driver, { ...target, value: options.value, replace: options.replace });
      case 'navigate':
        return navigateInteraction(driver, {
          ...options,
          action: options.navigationAction,
          path: options.path,
          homeRoute: options.homeRoute,
          includeSnapshot: options.includeSnapshot,
        });
      case 'wait': return waitInteraction(driver, { ...target, timeout: options.timeout });
      case 'drag':
        if (options.deltaX === undefined || options.deltaY === undefined) {
          throw new CliError('INVALID_INPUT', 'app interact drag requires --delta-x and --delta-y', 2);
        }
        return dragInteraction(driver, {
          ...target,
          deltaX: options.deltaX,
          deltaY: options.deltaY,
          steps: options.steps,
          x: options.x,
          y: options.y,
        });
      case 'action':
        if (!options.action) throw new CliError('INVALID_INPUT', 'app interact action requires --action', 2);
        return actionInteraction(driver, {
          ...target,
          action: options.action,
          quietMs: options.quietMs,
          keyboardKey: options.keyboardKey,
          checked: options.checked,
          value: options.value,
          deltaX: options.deltaX,
          deltaY: options.deltaY,
          steps: options.steps,
          x: options.x,
          y: options.y,
          timeout: options.timeout,
        });
    }
  }, deps);
}

export async function appScreenshotCommand(
  options: AppSessionOptions & { output?: string; pixelRatio?: number },
  deps: AppSessionDeps = {},
) {
  return withAppSession(options, async ({ driver }) => {
    const output = await inspectionOutput(options, 'screenshot');
    const screenshot = await driver.page.screenshot({ pixelRatio: options.pixelRatio });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, screenshot);
    return { path: output, bytes: screenshot.byteLength };
  }, deps);
}
