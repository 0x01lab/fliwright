/**
 * E2E Test: go_router Navigation + Form Fill
 *
 * Prerequisites:
 *   1. cd examples/go_router_demo && fvm flutter run -d macos --debug
 *   2. Copy the VM Service URL from the output
 *   3. FLIWRIGHT_VM_URL="http://127.0.0.1:54321/.../" pnpm --filter @fliwright/e2e-tests test:go-router
 */
import { expect } from 'vitest';
import { test } from '@fliwright/vitest';

test('navigates to /login route', async ({ page }) => {
    await page.navigate('/login');

    // Wait for the login page to render
    const loginField = await page.waitFor('text=请输入手机号', 5000);
    expect(await loginField.isVisible()).toBe(true);

    console.log('✅ Navigated to /login');
});

test('reports current route', async ({ page }) => {
    const route = await page.currentRoute();
    expect(route).toContain('login');

    console.log(`📍 Current route: ${route}`);
});

test('navigates between routes', async ({ page }) => {
    // Go to register page
    await page.navigate('/register');
    const registerField = await page.waitFor('text=请输入手机号', 5000);
    expect(await registerField.isVisible()).toBe(true);

    // Go to profile edit page
    await page.navigate('/profile/edit');
    const profileField = await page.waitFor('text=输入昵称', 5000);
    expect(await profileField.isVisible()).toBe(true);

    // Go back
    await page.goBack();

    console.log('✅ Multi-route navigation works');
});

test('navigates to /register and fills the form', async ({ page }) => {
    await page.navigate('/register');
    await page.waitFor('text=请输入手机号', 5000);

    // Analyze form fields
    const analysis = await page.formHelper.analyze();

    console.log('\n📋 Register page fields:');
    for (const f of analysis.fields) {
      console.log(`  ${f.semanticType.padEnd(10)} | hintText="${f.hintText?.padEnd(12) ?? '(none)'}" → "${f.generatedValue}"`);
    }

    // Register page should have 7 fields (same as form_demo)
    expect(analysis.fields.length).toBeGreaterThanOrEqual(5);

    // Fill all non-obscure fields
    const result = await page.formHelper.fill({ skipObscureFields: true });

    console.log('\n📝 Fill Results:');
    console.log(`  Filled: ${result.filled}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
    for (const f of result.fields) {
      console.log(`  [${f.status.padEnd(7)}] ${f.semanticType.padEnd(10)} → "${f.generatedValue}"`);
    }

    expect(result.errors).toHaveLength(0);
    expect(result.filled).toBeGreaterThanOrEqual(3);
});

test('fills specific fields on login page', async ({ page }) => {
    await page.navigate('/login');
    await page.waitFor('text=请输入手机号', 5000);

    const result = await page.formHelper.fillFields(
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

test('filters form fields by scope', async ({ page }) => {
    await page.navigate('/register');
    await page.waitFor('text=请输入手机号', 5000);

    // Extract with scope = 'RegisterPage'
    const scoped = await page.formHelper.analyze({ scope: 'RegisterPage' });

    console.log(`\n🔍 Scoped analysis (RegisterPage): ${scoped.fields.length} fields`);
    for (const f of scoped.fields) {
      console.log(`  ${f.semanticType.padEnd(10)} | "${f.hintText ?? '(none)'}"`);
    }

    // Should find the register page fields
    expect(scoped.fields.length).toBeGreaterThanOrEqual(5);
});

test('navigates to ShellRoute and fills form in settings', async ({ page }) => {
    await page.navigate('/shell/settings');

    // Wait for the settings page to render
    const settingsLabel = await page.waitFor('text=设置', 5000);
    expect(await settingsLabel.isVisible()).toBe(true);

    // Fill form fields inside ShellRoute
    const result = await page.formHelper.fill({ skipObscureFields: true });

    console.log(`\n📝 ShellRoute settings fill: ${result.filled} filled, ${result.skipped} skipped`);
    expect(result.filled).toBeGreaterThanOrEqual(1);
});
