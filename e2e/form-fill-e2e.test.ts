/**
 * E2E Test: Form Fill with Real Flutter App
 *
 * Prerequisites:
 *   1. cd examples/form_demo && fvm flutter run -d macos --debug
 *   2. Copy the VM Service URL from the output
 *   3. FLIWRIGHT_VM_URL="http://127.0.0.1:54321/.../" pnpm --filter @fliwright/e2e-tests test:form
 */
import { expect } from 'vitest';
import { test } from '@fliwright/vitest';

test('extracts all form fields via bridge', async ({ page }) => {
    const analysis = await page.formHelper.analyze();

    console.log('\n📋 Extracted Fields:');
    for (const f of analysis.fields) {
      console.log(`  ${f.semanticType.padEnd(10)} | hintText="${f.hintText?.padEnd(12) ?? '(none)'}" | selector="${f.selector}" → "${f.generatedValue}"`);
    }

    // Should find at least 6 editable fields
    expect(analysis.fields.length).toBeGreaterThanOrEqual(6);

    // Verify semantic types — use selector for precise matching to avoid
    // hintText substring collisions (e.g. "邮箱地址".includes("地址") is true)
    const phone = analysis.fields.find(f => f.selector === 'text=请输入手机号');
    expect(phone).toBeDefined();
    expect(phone!.semanticType).toBe('phone');

    const email = analysis.fields.find(f => f.selector === 'text=邮箱地址');
    expect(email).toBeDefined();
    expect(email!.semanticType).toBe('email');

    const password = analysis.fields.find(f => f.selector === 'text=密码');
    expect(password).toBeDefined();
    expect(password!.semanticType).toBe('password');

    const idCard = analysis.fields.find(f => f.selector === 'text=身份证号');
    expect(idCard).toBeDefined();
    expect(idCard!.semanticType).toBe('idCard');

    const name = analysis.fields.find(f => f.selector === 'text=真实姓名');
    expect(name).toBeDefined();
    expect(name!.semanticType).toBe('fullName');

    const address = analysis.fields.find(f => f.selector === 'text=地址');
    expect(address).toBeDefined();
    expect(address!.semanticType).toBe('address');

    const captcha = analysis.fields.find(f => f.selector === 'text=验证码');
    expect(captcha).toBeDefined();
    expect(captcha!.semanticType).toBe('captcha');

    // Verify generated values format
    expect(phone!.generatedValue).toMatch(/^1[3-9]\d{9}$/);
    expect(email!.generatedValue).toContain('@');
    expect(idCard!.generatedValue).toMatch(/^\d{17}[\dX]$/);
    expect(captcha!.generatedValue).toMatch(/^\d{4,6}$/);
});

test('fills all non-obscure fields and skips password', async ({ page }) => {
    const result = await page.formHelper.fill({ skipObscureFields: true });

    console.log('\n📝 Fill Results:');
    console.log(`  Filled: ${result.filled}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
    for (const f of result.fields) {
      console.log(`  [${f.status.padEnd(7)}] ${f.semanticType.padEnd(10)} → "${f.generatedValue}"`);
    }

    // Password should be skipped
    const passwordField = result.fields.find(f => f.semanticType === 'password');
    expect(passwordField).toBeDefined();
    expect(passwordField!.status).toBe('skipped');

    // All other fields should be filled (no errors)
    expect(result.errors).toHaveLength(0);
    expect(result.filled).toBeGreaterThanOrEqual(5);
});

test('clicks submit and verifies success message', async ({ page }) => {
    // Click the submit button
    const submitBtn = page.locator({ text: '提交' });
    await submitBtn.click();

    // Wait for success message
    const success = await page.waitFor('text=注册成功', 5000);
    const visible = await success.isVisible();
    expect(visible).toBe(true);

    console.log('\n✅ Submit successful — "注册成功" is visible');
});

test('fills specific fields only via fillFields()', async ({ page }) => {
    const result = await page.formHelper.fillFields(
      ['手机号', '验证码'],
      { skipObscureFields: true },
    );

    console.log('\n🎯 fillFields(["手机号", "验证码"]) results:');
    for (const f of result.fields) {
      console.log(`  [${f.status.padEnd(7)}] ${f.semanticType.padEnd(10)}`);
    }

    const phone = result.fields.find(f => f.semanticType === 'phone');
    const captcha = result.fields.find(f => f.semanticType === 'captcha');
    const email = result.fields.find(f => f.semanticType === 'email');

    // Phone and captcha should be filled
    expect(phone?.status).toBe('filled');
    expect(captcha?.status).toBe('filled');

    // Email should be skipped (not in the hints list)
    expect(email?.status).toBe('skipped');
});
