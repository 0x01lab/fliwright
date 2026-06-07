/**
 * Real Exio app E2E exercise: connect, point-click, input, and click.
 *
 * Prerequisites:
 *   1. Start Exio app with FliwrightBridge initialized in debug mode.
 *   2. Copy the Flutter VM Service URL from `flutter run`.
 *   3. Run:
 *      EXIO_VM_SERVICE_URL="ws://127.0.0.1:54321/xxxx=/ws" pnpm --filter @fliwright/e2e-tests test:exio
 *
 * This test intentionally supports the older bridge currently embedded in
 * Exio: it uses `ext.fliwright.extractForm` and legacy snapshot data when
 * `ext.fliwright.snap` is not available.
 *
 * Optional target overrides:
 *   EXIO_AVATAR_X=30
 *   EXIO_AVATAR_Y=90
 *   EXIO_AUTH_ENTRY_X=114
 *   EXIO_AUTH_ENTRY_Y=204
 *   EXIO_USERNAME="test@example.com"
 *   EXIO_PASSWORD="Password123!"
 *   EXIO_SUBMIT_X=220
 *   EXIO_SUBMIT_Y=442
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FliwrightDriver, type FormFieldMeta } from '@fliwright/core';

type LegacyWidget = {
  id: string;
  type: string;
  key?: string;
  rect?: Rect;
  parentType?: string;
  adjacentText?: string[];
  description?: string;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const vmServiceUrl = process.env.EXIO_VM_SERVICE_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL;

describe.skipIf(!vmServiceUrl)('Exio app live E2E', () => {
  let driver: FliwrightDriver;

  beforeAll(async () => {
    driver = new FliwrightDriver();
    await driver.connect(toWsUrl(vmServiceUrl!));
  });

  afterAll(async () => {
    await driver?.dispose();
  });

  it('opens login from avatar, fills credentials, and taps login', async () => {
    const fields = await openLoginPage(driver);
    const usernameField = requiredLoginField(fields, 'username');
    const passwordField = requiredLoginField(fields, 'password');

    const usernamePoint = centerOfRect(requiredRect(usernameField, 'username'));
    const passwordPoint = centerOfRect(requiredRect(passwordField, 'password'));

    // Coordinate clicks validate raw point events and focus the real Flutter
    // input before filling through the precise selector extracted by the bridge.
    await driver.page.clickAt(usernamePoint.x, usernamePoint.y);
    await fillLegacyField(driver, usernameField, process.env.EXIO_USERNAME ?? 'test@example.com');

    await driver.page.clickAt(passwordPoint.x, passwordPoint.y);
    await fillLegacyField(driver, passwordField, process.env.EXIO_PASSWORD ?? 'Password123!');

    const submitPoint = await resolveSubmitPoint(driver, passwordField);
    await driver.page.clickAt(submitPoint.x, submitPoint.y);
    await settle(1200);

    const afterSubmitFields = await safeExtractForm(driver);
    expect(afterSubmitFields.length).toBeGreaterThan(0);
    console.log(`[Exio] completed login interaction; visible fields after submit: ${afterSubmitFields.length}`);
  });
});

async function openLoginPage(driver: FliwrightDriver): Promise<FormFieldMeta[]> {
  let fields = await waitForForm(driver, { timeoutMs: 800 });
  if (!isLoginForm(fields)) {
    const avatar = pointFromEnv('EXIO_AVATAR', { x: 30, y: 90 });
    await driver.page.clickAt(avatar.x, avatar.y);
    await settle(1000);

    fields = await waitForForm(driver, { timeoutMs: 800 });
  }

  if (fields.length === 0) {
    const authEntry = pointFromEnv('EXIO_AUTH_ENTRY', { x: 114, y: 204 });
    await driver.page.clickAt(authEntry.x, authEntry.y);
    await settle(1800);

    fields = await waitForForm(driver, { timeoutMs: 2500 });
  }

  if (!isLoginForm(fields)) {
    await switchRegisterToLogin(driver);
    fields = await waitForForm(driver, { timeoutMs: 2500 });
  }

  if (!isLoginForm(fields)) {
    throw new Error(
      `Expected Exio login fields, got:\n${fields.map(describeField).join('\n') || '(no fields)'}`,
    );
  }

  console.log('\n[Exio login fields]');
  for (const field of fields) {
    console.log(`  ${describeField(field)}`);
  }

  return fields;
}

async function switchRegisterToLogin(driver: FliwrightDriver): Promise<void> {
  try {
    await driver.page.getByKey('loginButton').click();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[Exio] getByKey('loginButton') failed, falling back to top-right coordinate: ${message}`);
    const point = pointFromEnv('EXIO_LOGIN_TAB', { x: 395, y: 90 });
    await driver.page.clickAt(point.x, point.y);
  }
  await settle(1200);
}

function requiredLoginField(fields: FormFieldMeta[], kind: 'username' | 'password'): FormFieldMeta {
  const match = kind === 'username'
    ? fields.find((field) => (
      field.semanticsId === 'login.username'
      || field.name === 'username'
      || field.hintText === 'Username / Email'
    ))
    : fields.find((field) => (
      field.semanticsId === 'login.password'
      || (field.name === 'password' && field.obscureText === true)
      || field.hintText === 'Login password'
    ));

  if (!match) {
    throw new Error(`Cannot find Exio ${kind} field. Available fields:\n${fields.map(describeField).join('\n')}`);
  }
  return match;
}

async function resolveSubmitPoint(
  driver: FliwrightDriver,
  passwordField: FormFieldMeta,
): Promise<{ x: number; y: number }> {
  const override = envPoint('EXIO_SUBMIT');
  if (override) return override;

  const widgets = await safeLegacySnapshot(driver);
  const passwordRect = requiredRect(passwordField, 'password');
  const submit = widgets.find((widget) => {
    if (!widget.rect) return false;
    return widget.type === 'GestureDetector'
      && widget.rect.y > passwordRect.y + passwordRect.height
      && widget.rect.width >= 300
      && widget.rect.height >= 40
      && widget.rect.height <= 64;
  });

  if (submit?.rect) {
    return centerOfRect(submit.rect);
  }

  return pointFromEnv('EXIO_SUBMIT', { x: 220, y: 442 });
}

async function waitForForm(
  driver: FliwrightDriver,
  options: { timeoutMs: number },
): Promise<FormFieldMeta[]> {
  const start = Date.now();
  let fields: FormFieldMeta[] = [];
  while (Date.now() - start <= options.timeoutMs) {
    fields = await safeExtractForm(driver);
    if (fields.length > 0) return fields;
    await settle(150);
  }
  return fields;
}

async function safeExtractForm(driver: FliwrightDriver): Promise<FormFieldMeta[]> {
  try {
    const response = await driver.sendRequest('ext.fliwright.extractForm') as {
      fields?: FormFieldMeta[];
    };
    return response.fields ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Unknown method "ext.fliwright.extractForm"')) {
      return [];
    }
    throw error;
  }
}

async function safeLegacySnapshot(driver: FliwrightDriver): Promise<LegacyWidget[]> {
  try {
    const response = await driver.sendRequest('ext.fliwright.snapshot') as {
      widgets?: LegacyWidget[];
    };
    return response.widgets ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[Exio] legacy snapshot unavailable: ${message}`);
    return [];
  }
}

async function fillLegacyField(
  driver: FliwrightDriver,
  field: FormFieldMeta,
  text: string,
): Promise<void> {
  const result = await driver.sendRequest('ext.fliwright.type', {
    selector: field.selector,
    text,
    replaceAll: 'true',
  }) as { success?: boolean; error?: string };

  if (result.success === false || result.error) {
    throw new Error(`Failed to fill Exio field ${describeField(field)}: ${result.error ?? 'unknown error'}`);
  }
}

function isLoginForm(fields: FormFieldMeta[]): boolean {
  return fields.some((field) => field.semanticsId === 'login.username' || field.hintText === 'Username / Email')
    && fields.some((field) => field.semanticsId === 'login.password' || field.hintText === 'Login password');
}

function requiredRect(field: FormFieldMeta, name: string): Rect {
  if (!field.rect) {
    throw new Error(`Exio ${name} field does not include rect data: ${describeField(field)}`);
  }
  return field.rect;
}

function centerOfRect(rect: Rect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function pointFromEnv(prefix: string, fallback: { x: number; y: number }): { x: number; y: number } {
  return envPoint(prefix) ?? fallback;
}

function envPoint(prefix: string): { x: number; y: number } | null {
  const x = Number(process.env[`${prefix}_X`]);
  const y = Number(process.env[`${prefix}_Y`]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function toWsUrl(url: string): string {
  const converted = url
    .replace('http://', 'ws://')
    .replace('https://', 'wss://');
  return converted.endsWith('/ws') ? converted : converted.replace(/\/?$/, '/ws');
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeField(field: FormFieldMeta): string {
  return [
    `id=${field.id}`,
    `name=${field.name ?? '-'}`,
    `semanticsId=${field.semanticsId ?? '-'}`,
    `selector=${field.selector}`,
    `hint=${JSON.stringify(field.hintText ?? '')}`,
    `rect=${JSON.stringify(field.rect)}`,
  ].join(' ');
}
