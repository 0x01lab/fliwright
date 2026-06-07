/**
 * E2E Demo: Mock API
 *
 * 演示如何拦截 Flutter App 的 HTTP 请求并返回 mock 数据。
 *
 * Prerequisites:
 *   1. cd examples/form_demo && fvm flutter run -d macos --debug
 *   2. Copy the VM Service URL from output
 *   3. FLIWRIGHT_VM_URL="http://127.0.0.1:54321/.../" pnpm --filter @fliwright/e2e-tests test:mock
 */
import { describe, expect } from 'vitest';
import { test } from '@fliwright/vitest';

const hasVmUrl = Boolean(process.env.FLIWRIGHT_VM_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL);
const liveTest = test.skipIf(!hasVmUrl);

describe('Mock API Demo', () => {
  liveTest('registers a mock route', async ({ driver, page: _page }) => {
    // 1️⃣ 注册 mock 路由 — 拦截 GET /api/users 返回假数据
    await driver.mock.route('/api/users', {
      method: 'GET',
      status: 200,
      body: {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      },
    });

    console.log('✅ Mock route registered: GET /api/users → 200');
  });

  liveTest('registers multiple mock routes', async ({ driver, page: _page }) => {
    // 2️⃣ 注册登录接口 mock
    await driver.mock.route('/api/login', {
      method: 'POST',
      status: 200,
      body: {
        token: 'mock-jwt-token-12345',
        user: { id: 1, name: 'TestUser', role: 'admin' },
      },
    });

    // 3️⃣ 注册带延迟的接口 — 模拟慢网络
    await driver.mock.route('/api/slow', {
      method: 'GET',
      status: 200,
      body: { message: 'finally loaded' },
      delay: 2000, // 2 秒延迟
    });

    // 4️⃣ 注册错误响应 — 模拟服务器错误
    await driver.mock.route('/api/error', {
      method: 'GET',
      status: 500,
      body: { error: 'Internal Server Error' },
    });

    console.log('✅ Multiple mock routes registered');
  });

  liveTest('lists all registered routes', async ({ driver, page: _page }) => {
    // 5️⃣ 查看当前所有已注册的路由
    const routes = await driver.mock.listRoutes();

    console.log('\n📋 Registered mock routes:');
    for (const r of routes) {
      console.log(`  ${r.method ?? 'ANY'.padEnd(6)} ${r.path} (id: ${r.id})`);
    }

    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  liveTest('removes a specific mock route', async ({ driver, page: _page }) => {
    // 6️⃣ 移除单个路由
    await driver.mock.removeRoute('/api/error');

    const routes = await driver.mock.listRoutes();
    const errorRoute = routes.find(r => r.path === '/api/error');
    expect(errorRoute).toBeUndefined();

    console.log('✅ Removed /api/error route');
  });

  liveTest('enables passthrough for unmatched requests', async ({ driver, page: _page }) => {
    // 7️⃣ 开启 passthrough — 未匹配的请求转发到真实服务器
    await driver.mock.setPassthrough(true);

    console.log('✅ Passthrough enabled — unmatched requests go to real server');
  });

  liveTest('clears all mock routes and call logs', async ({ driver, page: _page }) => {
    // 8️⃣ 清空所有路由和调用记录
    await driver.mock.clear();
    await driver.mock.clearCalls();

    const routes = await driver.mock.listRoutes();
    expect(routes).toHaveLength(0);

    console.log('✅ All routes and call logs cleared');
  });

  liveTest('demonstrates full mock + verify workflow', async ({ driver, page: _page }) => {
    // 清理之前的状态
    await driver.mock.clear();
    await driver.mock.clearCalls();

    // Step 1: 注册登录 API
    await driver.mock.route('/api/auth/login', {
      method: 'POST',
      status: 200,
      body: { token: 'abc123', userId: 42 },
    });

    // Step 2: 注册用户信息 API
    await driver.mock.route('/api/users/42', {
      method: 'GET',
      status: 200,
      body: { id: 42, name: 'Test User', email: 'test@example.com' },
    });

    console.log('\n🎭 Full workflow: routes registered');

    // Step 3: (在真实场景中，这里会触发 app 发起 HTTP 请求)
    // 例如: await driver.page.locator({ text: '登录' }).click();
    // App 内部的 HttpClient 会自动被拦截到 mock server

    // Step 4: 验证请求记录
    const loginCalls = await driver.mock.getCalls('/api/auth/login');
    console.log(`  📞 Login API called: ${loginCalls.length} times`);

    const userCalls = await driver.mock.getCalls('/api/users/42');
    console.log(`  📞 User API called: ${userCalls.length} times`);

    // Step 5: 清理
    await driver.mock.clear();
    console.log('✅ Full workflow complete');
  });
});
