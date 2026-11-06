---
name: write-fliwright-mock-rules
description: Create or edit contract-backed Fliwright HTTP Mock endpoint JSON in shared or Item-local mocks directories. Use for response body design, named rules, baseRule inheritance, removeBodyFields, and rule registration.
---

# 编写 Fliwright Mock 规则文件

## 职责与加载模式

本技能负责生成符合业务契约的 Mock JSON。一个文件描述一个 method/endpoint，含
一条或多条具名响应 `rules[]`；不要自创 `scenarios`、`routes` 或 `mocks[]` 结构。
共享文件放 `.fliwright/mocks/api/*.json`，Item 差异放
`.fliwright/test-plans/<iid>/mocks/api/*.json`，两者 schema 相同。

按任务选择加载方式：

| 模式 | 注册与选择 |
| --- | --- |
| 命名场景（Item 验收优先） | `sources` 声明 `{ name, directory, files }`，`rules` 显式选择 `{ source, method, endpoint, rule, replace? }`，只激活所选响应，不读 index。替换父场景相同 method/endpoint 时必须写 `replace: true`；跨来源替换完整响应，不合并 body。 |
| 单目录工具 | `loadRules()` 加载目录默认响应，`switchRule()` 切换已加载规则；使用下述 index。 |

不要混用两种模式模拟覆盖。场景组合细节见
[共享与 Item 规则组合](../write-fliwright-tests/references/mock-rule-sets.md)；运行时 API 与清理约定见
[HTTP Mock](../write-fliwright-tests/references/mocks.md)。

单目录的 `.fliwright/mocks/mock-index.json` 示例：

```json
{
  "version": 1,
  "defaultRule": "success",
  "files": ["api/user-profile.example.json", "api/login.example.json"]
}
```

`files` 相对 mocks 目录，按项目约定用 `api/` 前缀并匹配磁盘文件名。使用已有 index
时，新增端点必须加入 `files`；sources 模式则加入对应 source 的文件列表。
无 index 时自动扫描 `api/*.json`，默认规则名为 `"success"`。
`defaultRule` 未匹配某个文件的规则名时会回退到该文件第一条规则，应核对实际选择。

## 数据依据

新增或修改业务响应前，先核对目标 App 契约与本次目标；单独调用本技能也须完成。
规则 schema 不定义业务 body；`sources` 是加载文件的位置，不是业务数据的依据。

- 沿 API client、响应 model/parser、repository、controller/provider 确认请求和解析契约，必要时结合适用版本的 API 文档或已确认响应样本。客户端默认值不代表后端一定返回该字段。
- 优先复用符合契约及目标分支的共享响应；需求与验收条件决定业务状态，不能用来猜接口结构。本技能示例仅演示格式。
- 在已确认结构内构造确定性数据，保留所需字段，只修改场景差异。真实样本脱敏后仍须保持类型、格式及跨端点 ID、权限和状态的关联。
- 契约缺失或来源冲突时，列明依据与缺口，完成可确认部分，受影响响应保持待确认；不编造字段、枚举或业务 code，不修改业务代码迎合 Mock。仅从客户端推导时说明尚未核实的后端语义。

需要推导测试分支时，读取
[从业务分支构建正确 Mock](../write-fliwright-tests/references/scenario-design.md#从业务分支构建正确-mock)。

## Schema

端点文件：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `version` | 是 | 固定 `1` |
| `name` | 是 | 端点的人类可读名 |
| `method` | 是 | 大写 HTTP method，如 `"GET"`、`"POST"` |
| `endpoint` | 是 | 路径，如 `/api/v1/user` |
| `baseRule` | 否 | 共享响应字段 `{ status?, delay?, headers?, body? }` |
| `rules` | 是 | 至少一条具名响应 |
| `description` | 否 | 文件说明 |

`rules[]` 每一条：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `name` | 是 | snake_case，如 `success`、`validation_error`；用于选择响应 |
| `status` | 合并后必需 | HTTP 状态码，可继承 `baseRule.status` |
| `delay` | 否 | 延迟毫秒数 |
| `headers` | 否 | 响应头 |
| `body` | 否 | object、array 或标量（含 null） |
| `description` | 否 | 仅给人看，不进入最终响应 |
| `removeBodyFields` | 否 | 合并后删除的顶层字段名数组，仅对 object body 生效 |

## 合并语义

`MockRuleStore` 加载时展开 `baseRule`，各入口使用展开后的响应：

| 字段 | 合并方式 |
| --- | --- |
| `status` / `delay` | 规则值覆盖 base |
| `headers` | 浅合并，规则同名 header 覆盖 base |
| `body` | 两者均为 object 时浅合并一层；数组、标量或 null 整体替换；嵌套对象不递归合并 |
| `removeBodyFields` | body 合并后删除指定顶层字段；本字段不进入最终响应 |

只把共享字段放入 `baseRule`。status 不同时优先逐条声明；放入 base 时必须覆盖
所有例外。body 结构差异大时，各规则独立写 body，不设置 `baseRule.body`。

独立 body 直接省略不应存在的字段；删除继承字段用 `removeBodyFields`。
缺失、null、空字符串、0 和空数组不能互换，按真实契约表达。
特别注意：base 为用户对象时，规则 body 写 `{ "error": "..." }` 仍会继承用户字段；
须删除这些字段，或将不共享的 body 移出 base。完整例子见下文。

## 校验与交付

按加载模式做离线校验：

- **sources 模式**：调用 `resolveMockRuleSet`，检查所有声明文件、规则名及覆盖冲突；目录相对执行工作目录。传入完整组合，不能单独校验带 `replace: true` 的子选择。`scenario resolve` 只检查场景声明，不读取端点 JSON。
- **单目录模式**：用 `normalizeMockEndpointConfig` 检查文件及展开结果。`loadRules()` 遇坏文件会 warn 后跳过，不能以其返回作为校验通过。合并后缺 status 会使 normalizer 抛错，sources 准备失败。

```typescript
import { resolveMockRuleSet } from '@fliwright/core';

await resolveMockRuleSet({
  sources: [{
    name: 'item-437', directory: '.fliwright/test-plans/437/mocks',
    files: ['api/user.json'],
  }],
  rules: [{ source: 'item-437', method: 'POST', endpoint: '/api/user/info', rule: 'review' }],
});
```

将示例替换为实际来源与选择。解析结果包含 body，勿直接作为不含业务数据的审核元信息发布。

单文件校验可在 Fliwright 仓库根执行（先 `pnpm --filter @fliwright/core build`）：

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { normalizeMockEndpointConfig } from "./packages/fliwright-core/dist/index.js";
const cfg = JSON.parse(readFileSync(process.argv[1], "utf8"));
console.log(JSON.stringify(normalizeMockEndpointConfig(cfg).rules, null, 2));
' .fliwright/mocks/api/user-profile.example.json
```

下游项目从已安装的 `@fliwright/core` 导入。没有运行环境时，至少检查 JSON 合法及
合并后各规则均有 status，并说明未完成的校验。

检查最终响应是否符合已确认契约及目标分支：HTTP 状态、业务 code、信封、必需字段、
类型、枚举、缺失/null、分页及跨端点关联。schema 合法或名为 `success` 不代表业务正确。

交付时说明文件/规则名、业务状态、依据的源码/文档/样本位置及关键字段差异，分别报告
格式/组合校验、契约核对和真实 App 验证结果与缺口。回复或现有 `description` 中说明
即可，不新增来源 schema 字段或专门文档。仅编写规则时不自动新增测试或运行 App；
涉及实际测试时按 [验证与交付](../write-fliwright-tests/references/scenario-design.md#验证与交付)
核对真实请求及 UI 结果。

## 完整示例

一个端点、多条规则，覆盖 `baseRule` 继承、字段覆盖、字段删除、status 覆盖四种情况：

```json
{
  "version": 1,
  "name": "User Profile",
  "description": "GET /api/v1/user/profile 的成功 / 隐私裁剪 / 404 场景",
  "method": "GET",
  "endpoint": "/api/v1/user/profile",
  "baseRule": {
    "status": 200,
    "delay": 0,
    "headers": { "Content-Type": "application/json" },
    "body": {
      "id": 42,
      "name": "Ada",
      "email": "ada@example.com",
      "phone": "+85267889900",
      "role": "admin"
    }
  },
  "rules": [
    { "name": "success", "description": "完整资料，继承 baseRule 全部字段" },
    {
      "name": "partial",
      "description": "phone 字段不返回，role 降级为 guest",
      "removeBodyFields": ["phone"],
      "body": { "role": "guest" }
    },
    {
      "name": "not_found",
      "description": "只返回错误信封，不泄露任何用户字段",
      "status": 404,
      "removeBodyFields": ["id", "name", "email", "phone", "role"],
      "body": { "error": "not found" }
    }
  ]
}
```

展开后：`success` → 完整 body（200）；`partial` → 去掉 phone、role 变 guest（200）；
`not_found` → `{ "error": "not found" }`（404）。
