# 命名组合场景（TestScenario）

把可复用的 mock、storage、auth、业务 state、app capability 和 navigation 前置状态声明为命名 `TestScenario`。不要把同一套环境散落在登录 helper、fixture 和 `beforeEach` 中。

## 认证与隔离约定

- 已登录业务测试通过 app-owned `auth.seedLoggedIn` 建立真实的客户端会话状态，协调器随后调用 `auth.getStatus` 验证结果。访客场景通过 `auth.clearSession` 清理，再验证状态。
- app 必须注册这些测试专用能力；能力缺失应修复 app 的测试入口。不要用真实登录、登录接口 mock、CAPTCHA 绕过或通用 Riverpod auth override 代替。
- 普通业务 provider 可以使用 `kind: 'state'` layer；Riverpod 是可选适配器，不负责认证。
- `run --scenario` 和 `test.scenario(name)` 都会在每次 attempt（包括 retry）前准备场景。探索时执行 `scenario apply` 不替代测试的场景声明。

## 项目配置

在现有 `fliwright.config.ts` 中合并 `scenarios`。下面的 mock 目录、规则名、用户 preset、路由和 Key 都是示例，必须换成目标 app 已实现的契约。`base` 使用的 mock 文件应已注册，并且包含 `success` 规则；规则文件格式见 [mocks.md](./mocks.md)。

```typescript
// fliwright.config.ts
import { defineConfig } from '@fliwright/cli';
import type { TestScenario } from '@fliwright/core';

const scenarios = {
  base: {
    name: 'base',
    layers: [
      { kind: 'mocks', directory: '.fliwright/mocks', profile: 'success' },
    ],
  },
  'home.logged-in': {
    name: 'home.logged-in',
    extends: ['base'],
    layers: [
      { kind: 'auth', state: 'authenticated', preset: 'member' },
      { kind: 'navigation', route: '/home' },
    ],
    ready: [
      { kind: 'auth', state: 'authenticated' },
      { kind: 'route', equals: '/home' },
    ],
  },
} satisfies Record<string, TestScenario>;

export default defineConfig({ scenarios });
```

`extends` 先展开父场景，再合并当前 layers；协调器按 mocks → storage → auth → state → app → navigation 的固定顺序应用。不要通过重复声明 auth、mocks、storage 或 navigation layer 覆盖父场景；重复的单例资源会被拒绝。拆出共享基线，再分别组合不同业务分支。

## 测试选择

先按 [runner 配置](./getting-started.md) 将 `fliwrightPreset(projectConfig)` 接入 Vitest。默认 `test` fixture 会从 runner 配置读取场景；项目扩展 fixture 则从 support module 导入。

```typescript
// .fliwright/tests/home.test.ts
import { test, expect } from '@fliwright/vitest';

test.scenario('home.logged-in')('已登录用户看到首页', async ({ page }) => {
  await expect(page.getByKey('home.accountButton'), '账户入口可见').toBeVisible();
});
```

也可以在 CLI 为整次运行选择一个场景：

```sh
fliwright scenario resolve home.logged-in --json
fliwright run --test .fliwright/tests/home.test.ts --scenario home.logged-in --json
```

`scenario resolve` 只检查声明及组合，不连接 app。CLI 的场景选择与测试中的显式选择必须一致；混合多个场景的套件应让各测试自行选择，避免全局 `--scenario` 冲突。自定义 `createFliwrightTest` 时将同一份 `scenarios` 传入配置，不要维护另一套环境模型。

## 首帧隔离

只有要求在首帧前准备环境时才设 `startupIsolation: 'required'`。目标 app 的测试入口需要先注册能力、初始化 bridge、等待 `FliwrightTestBootstrap.awaitScenario()`，再执行 `runApp`；调用方使用 managed launch（`run --device-id`）。已运行 app 的 attach 模式会拒绝必需首帧隔离的场景。普通 attach 测试可省略该字段。

完整命令与前置条件见 [scenario apply](../../fliwright-cli-workflows/references/commands/command-scenario.apply.md) 和 [run](../../fliwright-cli-workflows/references/commands/command-run.md)。
