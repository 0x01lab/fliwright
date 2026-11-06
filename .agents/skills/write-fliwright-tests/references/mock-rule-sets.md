# 项目共享与 Item 专属 Mock

GitLab Item 验收使用命名 `TestScenario` 组合共享响应和 Item 数据。规则 JSON 的
schema 仍为 version 1；编写端点文件时读取
[write-fliwright-mock-rules](../../write-fliwright-mock-rules/SKILL.md)。

## 存放与复用

| 内容 | 位置与用法 |
| --- | --- |
| 项目共享响应 | `.fliwright/mocks/api/*.json`，按需显式引用 |
| Item 专属响应 | `.fliwright/test-plans/<iid>/mocks/api/*.json`，只保存该 Item 的差异 |
| Item 命名场景 | 可放 `.fliwright/test-plans/<iid>/scenarios.ts`，显式导入并注册到项目配置 |
| 持久验收测试 | `.fliwright/tests/*.test.ts`，通过 `test.scenario(name)` 选择前置状态 |

先找共享规则，满足要求则引用；没有合适数据才新增 Item 文件。用例之间可以共用
Item 文件里的不同具名响应，不为每条 case 复制目录。其他 Item 不直接引用当前
Item 的私有文件；确认可复用时再提升到共享目录，并调整显式引用。

## 组合示例

以下路径、规则、认证和 UI 标识均是示例，必须先核查目标 App 契约和安装版本。
目录相对执行进程的工作目录解析：从项目根执行，或提供绝对目录。

```typescript
import type { TestScenario } from '@fliwright/core';

export const scenarios = {
  'account.base': {
    name: 'account.base',
    layers: [{
      kind: 'mocks',
      sources: [{
        name: 'shared', directory: '.fliwright/mocks',
        files: ['api/user.json', 'api/positions.json'],
      }],
      rules: [
        { source: 'shared', method: 'POST', endpoint: '/api/user/info', rule: 'success' },
        { source: 'shared', method: 'GET', endpoint: '/api/positions', rule: 'empty' },
      ],
    }],
  },
  'item-437.review': {
    name: 'item-437.review', extends: ['account.base'],
    layers: [
      {
        kind: 'mocks',
        sources: [{
          name: 'item-437', directory: '.fliwright/test-plans/437/mocks',
          files: ['api/user.json'],
        }],
        rules: [{
          source: 'item-437', method: 'POST', endpoint: '/api/user/info',
          rule: 'review', replace: true,
        }],
      },
      { kind: 'auth', state: 'authenticated' },
      { kind: 'navigation', route: '/home' },
    ],
    ready: [{ kind: 'auth', state: 'authenticated' }],
  },
} satisfies Record<string, TestScenario>;
```

在已有 `fliwright.config.ts` 的 `scenarios` 中注册这些声明；使用项目现有 support
fixture 和 [runner 配置](./getting-started.md)。不要覆盖无关配置，也不要在子场景
重复声明父场景已有的 auth/navigation 单例层。

```typescript
// .fliwright/tests/account-review.test.ts
import { test, expect } from '@fliwright/vitest';

test.scenario('item-437.review')('review account shows status', async ({ page }) => {
  await expect(page.getByKey('account.reviewStatus'), '审核状态已显示').toBeVisible();
});
```

项目有扩展 fixture 时从 `.fliwright/support/` 导入 test/expect。混合多个命名场景的
测试文件由每条 test 选择，不给整次运行指定冲突的全局 `--scenario`。

## 解析与执行规则

- source 为 `{ name, directory, files }`。名字在展开后的场景中唯一，`files` 为来源
  目录内的非空相对路径列表。不自动扫描 Item 目录，不读 index 默认值。
- selection 为 `{ source, method, endpoint, rule, replace? }`。只激活选中的端点；
  GET/POST 独立。同一 source 内 method/endpoint 重复、同一文件的规则名重复均报错。
- 父 sources 和子 sources 先合并，再清理并应用一次。子层只引用父来源时可以写
  `sources: []`；不要重复声明同名 source。
- 后来的 selection 替换已有 method/endpoint 必须写 `replace: true`，没有被替换对象
  却写 replace 也报错。替换完整响应；不跨来源合并 JSON body。
- source 模式不可与 `directory/profile` 层混用。`baseRule` 仍只在一个端点文件内
  按既有浅合并规则工作，不是跨文件引用能力。
- 所有声明的文件和选择先校验。坏 JSON、缺失文件、规则或 status 都让 setup 失败。
  `scenario resolve` 只检查场景声明组合，不读取端点 JSON；需要离线校验文件时调用
  `resolveMockRuleSet({ sources, rules })`，它返回包含响应体的解析结果。
- 每次所选场景的 attempt/retry 都替换全部 App 路由（包含编辑器临时规则），
  清理请求记录和旧规则库。默认禁止未匹配请求；显式设置
  `denyUnmatchedRequests: false` 才允许真实网络。父子显式声明的策略必须一致。
- Flutter Mock bridge 缺失、注册失败或激活路由身份不符时失败，不回退工具侧镜像；
  应用中途失败会尝试清理部分路由。没有选择场景的测试不会因此自动准备 Mock。

`loadRules()/switchRule()` 仍用于单目录规则库。source 模式不建立供 `switchRule()`
切换的目录库，Item 文件无需加入共享 `mock-index.json`。用例中途变化时可在
`mock.rules(...)` 内调用 `mock.applyRuleSet(...)` 应用另一份**完整**选择，或使用
严格的 `mock.routeFlutter(...)` 改一个响应，然后触发并断言真实业务请求。
不要把多次 applyRuleSet 当作追加；每次都会替换并清理调用记录。

## 迁移和验收证据

从现有 helper 迁移时保留原有步骤和断言：把通用响应归入共享文件，把 Item
差异归入专属文件，抽出 sources 场景，再改为 test.scenario 选择。业务交互 helper
可以保留；删除重复的初始化清理/目录加载，避免在场景应用后再次覆盖数据。
认证始终用 App 自有 `auth.seedLoggedIn`，Mock 返回 KYC、余额等业务状态。

`driver.mock.applyRuleSet`、timeline-aware `mock.applyRuleSet` 返回
`MockRuleSetReport`，含选中的来源、目录、文件、method/endpoint、规则名、文件 SHA-256
和整体 fingerprint，不含响应体。Vitest 场景节点记录 `mockRuleSet`；直接调用
MockRuntime 时 Mock 节点记录 `ruleSet`。`scenarioFingerprint` 仍是声明指纹；
`mockRuleSet.fingerprint` 另含选中文件内容与来源信息，不能据此断言已通过验收。

`coverage.md` 可补充“用例 ID → 场景名 → 共享/Item 规则来源 → run/attempt”的对应关系，
实际来源以该 attempt 的 timeline 为准。保存规则文件及 Git revision 才能重建响应。
plan.json 保持既有前置条件、验收标准和 file/name binding schema，不添加自创
Mock 字段。静态解析、收集、绑定均不等于真实 App 通过；Mock 验收也不证明后端集成。
