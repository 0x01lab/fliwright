import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
} from '../capabilities/interaction.js';
import { withAppSession, type AppSessionDeps, type AppSessionOptions } from '../capabilities/session.js';

export interface AppObserveOptions extends AppSessionOptions {
  intent?: string;
  roles?: string;
  limit?: number;
  includeDiagnostics?: boolean;
}

export interface AppInteractOptions extends AppSessionOptions {
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
        if (typeof options.value !== 'string') throw new Error('app interact type requires --value');
        return typeInteraction(driver, { ...target, value: options.value, replace: options.replace });
      case 'navigate':
        return navigateInteraction(driver, {
          action: options.navigationAction,
          path: options.path,
          homeRoute: options.homeRoute,
          includeSnapshot: options.includeSnapshot,
        });
      case 'wait': return waitInteraction(driver, { ...target, timeout: options.timeout });
      case 'drag':
        if (options.deltaX === undefined || options.deltaY === undefined) {
          throw new Error('app interact drag requires --delta-x and --delta-y');
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
        if (!options.action) throw new Error('app interact action requires --action');
        return actionInteraction(driver, {
          ...target,
          action: options.action,
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
    const output = resolve(options.cwd ?? process.cwd(), options.output ?? '.fliwright/artifacts/screenshot.png');
    const screenshot = await driver.page.screenshot({ pixelRatio: options.pixelRatio });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, screenshot);
    return { path: output, bytes: screenshot.byteLength };
  }, deps);
}
