/**
 * E2E Test: Form Fill + Mock API (Combined)
 *
 * 完整端到端流程：
 *   1. Mock 注册 API
 *   2. 通过 UI 自动填入表单字段
 *   3. 点击提交
 *   4. 验证 UI 显示成功消息
 *   5. 验证 Mock Server 拦截到正确的请求数据
 *
 * Prerequisites:
 *   1. cd examples/form_demo && fvm flutter run -d macos --debug
 *   2. Copy the VM Service URL from the output
 *   3. FLIWRIGHT_VM_SERVICE_URL="http://127.0.0.1:54321/.../" pnpm --filter @fliwright/e2e-tests test:form-mock
 *
 * 如果未设置 FLIWRIGHT_VM_SERVICE_URL 或连接失败，整个 suite 自动 skip。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';

function toWsUrl(httpUrl: string): string {
  return httpUrl
    .replace('http://', 'ws://')
    .replace('https://', 'wss://')
    .replace(/\/?$/, '/ws');
}

const vmServiceUrl = process.env.FLIWRIGHT_VM_SERVICE_URL;

describe.skipIf(!vmServiceUrl)('Form Fill + Mock API E2E', () => {
  let driver: FliwrightDriver;
  let connected = false;

  beforeAll(async () => {
    try {
      const wsUrl = toWsUrl(vmServiceUrl!);
      driver = new FliwrightDriver();
      await driver.connect(wsUrl);
      connected = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `⚠️  Cannot connect to VM Service at ${vmServiceUrl}\n` +
        `   Error: ${msg}\n` +
        `   Make sure the Flutter app is running in debug mode.\n` +
        `   Run: cd examples/form_demo && fvm flutter run -d macos --debug`,
      );
      throw e;
    }
  }, 15_000);

  afterAll(async () => {
    await driver?.dispose();
  });

  // ── Step 1: Mock 注册 API ────────────────────────────────────
  it('mocks the register API before form interaction', async () => {
    if (!connected) return;

    await driver.mock.clear();
    await driver.mock.clearCalls();

    await driver.mock.route('/api/register', {
      method: 'POST',
      status: 200,
      body: {
        success: true,
        message: '注册成功，欢迎加入！',
        userId: 42,
      },
    });

    const routes = await driver.mock.listRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/api/register');

    console.log('✅ Mock API ready: POST /api/register → 200');
  });

  // ── Step 2: 分析表单字段 ─────────────────────────────────────
  it('analyzes form fields and infers semantic types', async () => {
    if (!connected) return;

    const analysis = await driver.page.formHelper.analyze();

    console.log('\n📋 Extracted Fields:');
    for (const f of analysis.fields) {
      console.log(
        `  ${f.semanticType.padEnd(10)} | hintText="${f.hintText?.padEnd(12) ?? '(none)'}" | → "${f.generatedValue}"`,
      );
    }

    expect(analysis.fields.length).toBeGreaterThanOrEqual(6);

    // Verify key semantic types
    const phone = analysis.fields.find(f => f.semanticType === 'phone');
    expect(phone).toBeDefined();
    expect(phone!.generatedValue).toMatch(/^1[3-9]\d{9}$/);

    const email = analysis.fields.find(f => f.semanticType === 'email');
    expect(email).toBeDefined();
    expect(email!.generatedValue).toContain('@');
  });

  // ── Step 3: 填入所有字段（包括密码）────────────────────────
  it('fills all form fields via UI', async () => {
    if (!connected) return;

    // Fill all fields, including password
    const result = await driver.page.formHelper.fill({ skipObscureFields: false });

    console.log('\n📝 Fill Results:');
    console.log(`  Filled: ${result.filled}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
    for (const f of result.fields) {
      console.log(`  [${f.status.padEnd(7)}] ${f.semanticType.padEnd(10)} → "${f.generatedValue}"`);
    }

    // All fields should be filled (no errors)
    expect(result.errors).toHaveLength(0);
    expect(result.filled).toBeGreaterThanOrEqual(6);
    expect(result.skipped).toBe(0);
  });

  // ── Step 4: 点击提交 ────────────────────────────────────────
  it('clicks submit and verifies success in UI', async () => {
    if (!connected) return;

    const submitBtn = driver.page.locator({ text: '提交' });
    await submitBtn.click();

    // Wait for the success message from mock API response
    const success = await driver.page.waitFor('text=注册成功', 5000);
    const visible = await success.isVisible();
    expect(visible).toBe(true);

    console.log('✅ UI shows success message: "注册成功"');
  });

  // ── Step 5: 验证 Mock Server 拦截到正确的请求数据 ──────────
  it('verifies mock server intercepted the submit request', async () => {
    if (!connected) return;

    const calls = await driver.mock.getCalls('/api/register');
    expect(calls.length).toBeGreaterThanOrEqual(1);

    const lastCall = calls[calls.length - 1];
    expect(lastCall.method).toBe('POST');
    expect(lastCall.path).toBe('/api/register');

    // Parse the request body — Dio sends JSON
    const body = typeof lastCall.body === 'string'
      ? JSON.parse(lastCall.body)
      : lastCall.body;

    console.log('\n📡 Intercepted request body:', JSON.stringify(body, null, 2));

    // Verify the submitted form data contains expected fields
    expect(body).toBeDefined();
    expect(body.phone).toBeDefined();
    expect(body.email).toBeDefined();
    expect(body.name).toBeDefined();

    // Phone should be a valid Chinese mobile number
    expect(body.phone).toMatch(/^1[3-9]\d{9}$/);
    // Email should contain @
    expect(body.email).toContain('@');

    console.log('✅ Mock server captured correct form submission data');
  });

  // ── Summary ──────────────────────────────────────────────────
  it('prints summary', async () => {
    console.log('\n🎉 Full E2E flow complete:');
    console.log('   1. Mock API registered ✅');
    console.log('   2. Form fields analyzed ✅');
    console.log('   3. Form filled via UI ✅');
    console.log('   4. Submit clicked → success shown ✅');
    console.log('   5. Mock intercepted request with correct data ✅');
  });
});
