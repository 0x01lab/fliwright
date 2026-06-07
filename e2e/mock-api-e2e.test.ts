/**
 * E2E Test: Mock API with Real Flutter App
 *
 * 验证 Mock API 端到端工作流：
 *   1. 直接通过 VM Service 发 HTTP 请求（不依赖 UI/Dio）验证代理拦截
 *   2. 验证请求记录
 *
 * Prerequisites:
 *   1. cd examples/form_demo && fvm flutter run -d macos --debug
 *   2. Copy the VM Service URL from output
 *   3. FLIWRIGHT_VM_URL="http://127.0.0.1:54321/.../" pnpm --filter @fliwright/e2e-tests test:mock-e2e
 *
 * 如果未设置 FLIWRIGHT_VM_URL 或连接失败，整个 suite 自动 skip。
 */
import { describe, expect } from 'vitest';
import { test } from '@fliwright/vitest';

const hasVmUrl = Boolean(process.env.FLIWRIGHT_VM_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL);
const liveTest = test.skipIf(!hasVmUrl);

describe('Mock API E2E', () => {
  liveTest('registers mock route via MockManager', async ({ driver, page: _page }) => {
    await driver.mock.clear();
    await driver.mock.clearCalls();

    await driver.mock.route('/api/ping', {
      method: 'GET',
      status: 200,
      body: { message: 'pong', timestamp: 12345 },
    });

    const routes = await driver.mock.listRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/api/ping');
    console.log('✅ Mock route registered: GET /api/ping');
  });

  liveTest('intercepts HttpClient request through HttpOverrides proxy', async ({ driver, page: _page }) => {
    // Use the testRequest extension to make an HTTP request from the Dart side.
    // This goes through the normal HttpClient → HttpOverrides → mock server path.
    const result = await driver.sendRequest(
      'ext.fliwright.mock.testRequest',
      { url: 'http://test.local/api/ping', method: 'GET' },
    ) as { status?: number; body?: string; error?: string };

    console.log('\n🔍 testRequest result:', JSON.stringify(result));

    // If the proxy works, mock server should respond with our mock data
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);

    const body = JSON.parse(result.body!);
    expect(body.message).toBe('pong');
    expect(body.timestamp).toBe(12345);

    console.log('✅ HttpOverrides proxy intercepted the request and mock server responded');
  });

  liveTest('records the intercepted call', async ({ driver, page: _page }) => {
    const calls = await driver.mock.getCalls('/api/ping');
    expect(calls.length).toBeGreaterThanOrEqual(1);

    const lastCall = calls[calls.length - 1];
    expect(lastCall.method).toBe('GET');
    expect(lastCall.path).toBe('/api/ping');

    console.log(`✅ Call recorded: ${lastCall.method} ${lastCall.path}`);
  });

  liveTest('mocks POST with body and verifies request body in call record', async ({ driver, page: _page }) => {
    await driver.mock.clear();
    await driver.mock.clearCalls();

    await driver.mock.route('/api/register', {
      method: 'POST',
      status: 200,
      body: { success: true, userId: 42, message: '注册成功，用户ID: 42' },
    });

    // Make a POST request through the test extension
    const result = await driver.sendRequest(
      'ext.fliwright.mock.testRequest',
      {
        url: 'http://test.local/api/register',
        method: 'POST',
        body: JSON.stringify({ phone: '13800138000', name: 'Test' }),
      },
    ) as { status?: number; body?: string; error?: string };

    console.log('\n🔍 POST result:', JSON.stringify(result));
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);

    const body = JSON.parse(result.body!);
    expect(body.success).toBe(true);
    expect(body.userId).toBe(42);

    // Verify call record contains request body
    const calls = await driver.mock.getCalls('/api/register');
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('POST');

    const reqBody = typeof calls[0].body === 'string' ? JSON.parse(calls[0].body) : calls[0].body;
    expect(reqBody.phone).toBe('13800138000');
    expect(reqBody.name).toBe('Test');

    console.log('✅ POST mock + body recording verified');
  });

  liveTest('mocks error response', async ({ driver, page: _page }) => {
    await driver.mock.clear();
    await driver.mock.clearCalls();

    await driver.mock.route('/api/fail', {
      method: 'GET',
      status: 500,
      body: { error: '服务器内部错误' },
    });

    const result = await driver.sendRequest(
      'ext.fliwright.mock.testRequest',
      { url: 'http://test.local/api/fail', method: 'GET' },
    ) as { status?: number; body?: string; error?: string };

    expect(result.status).toBe(500);
    const body = JSON.parse(result.body!);
    expect(body.error).toBe('服务器内部错误');

    console.log('✅ Error mock (500) verified');
  });

  liveTest('returns 404 for unmatched route (no passthrough)', async ({ driver, page: _page }) => {
    await driver.mock.clear();
    await driver.mock.clearCalls();

    const result = await driver.sendRequest(
      'ext.fliwright.mock.testRequest',
      { url: 'http://test.local/api/nonexistent', method: 'GET' },
    ) as { status?: number; body?: string; error?: string };

    expect(result.status).toBe(404);
    console.log('✅ 404 for unmatched route verified');
  });
});
