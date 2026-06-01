/**
 * E2E Test: go_router Navigation + Form Fill
 *
 * Prerequisites:
 *   1. cd examples/go_router_demo && fvm flutter run -d macos --debug
 *   2. Copy the VM Service URL from the output
 *   3. FLIWRIGHT_VM_SERVICE_URL="http://127.0.0.1:54321/.../" pnpm --filter @fliwright/e2e-tests test:go-router
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';

function toWsUrl(httpUrl: string): string {
  return httpUrl
    .replace('http://', 'ws://')
    .replace('https://', 'wss://')
    .replace(/\/?$/, '/ws');
}

describe('E2E: go_router Navigation + Form Fill', () => {
  let driver: FliwrightDriver;
  const vmServiceUrl = process.env.FLIWRIGHT_VM_SERVICE_URL;

  beforeAll(async () => {
    if (!vmServiceUrl) {
      throw new Error(
        'Set FLIWRIGHT_VM_SERVICE_URL env var to the VM Service URI from `flutter run` output.\n' +
        'Example: FLIWRIGHT_VM_SERVICE_URL="http://127.0.0.1:54321/xxxxxxxxxxxxxx/" pnpm --filter @fliwright/e2e-tests test:go-router',
      );
    }

    const wsUrl = toWsUrl(vmServiceUrl);
    driver = new FliwrightDriver();
    await driver.connect(wsUrl);
  });

  afterAll(async () => {
    await driver?.dispose();
  });

  // ── Navigation ────────────────────────────────────────────

  it('navigates to /login route', async () => {
    await driver.page.navigate('/login');

    // Wait for the login page to render
    const loginField = await driver.page.waitFor('text=请输入手机号', 5000);
    expect(await loginField.isVisible()).toBe(true);

    console.log('✅ Navigated to /login');
  });

  it('reports current route', async () => {
    const route = await driver.page.currentRoute();
    expect(route).toContain('login');

    console.log(`📍 Current route: ${route}`);
  });

  it('navigates between routes', async () => {
    // Go to register page
    await driver.page.navigate('/register');
    const registerField = await driver.page.waitFor('text=请输入手机号', 5000);
    expect(await registerField.isVisible()).toBe(true);

    // Go to profile edit page
    await driver.page.navigate('/profile/edit');
    const profileField = await driver.page.waitFor('text=输入昵称', 5000);
    expect(await profileField.isVisible()).toBe(true);

    // Go back
    await driver.page.goBack();

    console.log('✅ Multi-route navigation works');
  });

  // ── Form filling on go_router pages ───────────────────────

  it('navigates to /register and fills the form', async () => {
    await driver.page.navigate('/register');
    await driver.page.waitFor('text=请输入手机号', 5000);

    // Analyze form fields
    const analysis = await driver.page.formHelper.analyze();

    console.log('\n📋 Register page fields:');
    for (const f of analysis.fields) {
      console.log(`  ${f.semanticType.padEnd(10)} | hintText="${f.hintText?.padEnd(12) ?? '(none)'}" → "${f.generatedValue}"`);
    }

    // Register page should have 7 fields (same as form_demo)
    expect(analysis.fields.length).toBeGreaterThanOrEqual(5);

    // Fill all non-obscure fields
    const result = await driver.page.formHelper.fill({ skipObscureFields: true });

    console.log('\n📝 Fill Results:');
    console.log(`  Filled: ${result.filled}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
    for (const f of result.fields) {
      console.log(`  [${f.status.padEnd(7)}] ${f.semanticType.padEnd(10)} → "${f.generatedValue}"`);
    }

    expect(result.errors).toHaveLength(0);
    expect(result.filled).toBeGreaterThanOrEqual(3);
  });

  it('fills specific fields on login page', async () => {
    await driver.page.navigate('/login');
    await driver.page.waitFor('text=请输入手机号', 5000);

    const result = await driver.page.formHelper.fillFields(
      ['手机号', '验证码'],
      { skipObscureFields: true },
    );

    console.log('\n🎯 fillFields(["手机号", "验证码"]) on login page:');
    for (const f of result.fields) {
      console.log(`  [${f.status.padEnd(7)}] ${f.semanticType.padEnd(10)}`);
    }

    const phone = result.fields.find(f => f.semanticType === 'phone');
    const captcha = result.fields.find(f => f.semanticType === 'captcha');

    expect(phone?.status).toBe('filled');
    expect(captcha?.status).toBe('filled');
  });

  // ── Scope filtering ──────────────────────────────────────

  it('filters form fields by scope', async () => {
    await driver.page.navigate('/register');
    await driver.page.waitFor('text=请输入手机号', 5000);

    // Extract with scope = 'RegisterPage'
    const scoped = await driver.page.formHelper.analyze({ scope: 'RegisterPage' });

    console.log(`\n🔍 Scoped analysis (RegisterPage): ${scoped.fields.length} fields`);
    for (const f of scoped.fields) {
      console.log(`  ${f.semanticType.padEnd(10)} | "${f.hintText ?? '(none)'}"`);
    }

    // Should find the register page fields
    expect(scoped.fields.length).toBeGreaterThanOrEqual(5);
  });

  // ── ShellRoute ────────────────────────────────────────────

  it('navigates to ShellRoute and fills form in settings', async () => {
    await driver.page.navigate('/shell/settings');

    // Wait for the settings page to render
    const settingsLabel = await driver.page.waitFor('text=设置', 5000);
    expect(await settingsLabel.isVisible()).toBe(true);

    // Fill form fields inside ShellRoute
    const result = await driver.page.formHelper.fill({ skipObscureFields: true });

    console.log(`\n📝 ShellRoute settings fill: ${result.filled} filled, ${result.skipped} skipped`);
    expect(result.filled).toBeGreaterThanOrEqual(1);
  });
});
