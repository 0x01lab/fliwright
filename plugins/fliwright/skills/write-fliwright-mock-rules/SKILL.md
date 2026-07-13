---
name: write-fliwright-mock-rules
description: Use when creating or editing Fliwright HTTP mock rule files (`.fliwright/mocks/api/*.json`) or the `.fliwright/mocks/mock-index.json` registry — adding an endpoint, defining named response scenarios (success / error / empty / timeout), using `baseRule` inheritance, making a response field absent with `removeBodyFields`, or wiring a mock file into the index for `loadRules()` / `switchRule()`.
---

# 编写 Fliwright Mock 规则文件（Write Fliwright Mock Rule Files）

## 概述

Fliwright 的 HTTP mock 用**一套固定 schema** 描述端点。一个 JSON 文件 = 一个端点，
内含一条或多条**具名响应规则**（`rules[]`），由 `MockRuleStore` 在 `loadRules()` 时
加载、用 `switchRule(endpoint, ruleName)` 切换。

**核心原则：照 schema 写，不要自创结构。** 这套格式是 fliwright 专有的，靠猜会得到
看似合理但完全错误的文件（`scenarios`/`routes`/`mocks[]` 之类），加载时会被静默
跳过（`console.warn`）或在缺 `status` 时抛错。

> 一个端点一个文件。规则名用 snake_case（`success`、`validation_error`、`server_error`）。
> 默认激活规则在 `mock-index.json` 的 `defaultRule` 里指定，回退值是 `"success"`。

## 文件骨架（必需字段）

文件放在 `.fliwright/mocks/api/<name>.json`（示例文件习惯加 `.example`）：

| 字段 | 必需 | 类型 / 说明 |
| --- | --- | --- |
| `version` | 是 | 固定 `1` |
| `name` | 是 | 端点的人类可读名 |
| `method` | 是 | HTTP method，如 `"GET"`、`"POST"`（大写） |
| `endpoint` | 是 | 路径，如 `/api/v1/user` |
| `baseRule` | 否 | 所有规则继承的共享字段 `{ status?, delay?, headers?, body? }` |
| `rules` | 是 | ≥1 条具名响应规则（见下） |
| `description` | 否 | 整个文件的说明 |

`rules[]` 每一条：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `name` | 是 | 规则名，snake_case；被 `defaultRule` / `switchRule` 引用 |
| `status` | 视情况 | **合并后每条规则都必须有 `status`**，否则 `loadRules()` 抛 `rules[i].status is required when baseRule.status is not set` |
| `delay` | 否 | 延迟响应的毫秒数 |
| `headers` | 否 | 响应头（如 `Content-Type`） |
| `body` | 否 | 响应体（object / array / 标量均可） |
| `description` | 否 | 仅给人看，**不进最终响应** |
| `removeBodyFields` | 否 | 合并后要删除的字段名数组；用于让字段“不存在” |

## baseRule 继承与合并语义

把多条规则**共享**的 `status` / `delay` / `headers` / `body` 放进 `baseRule`，每条规则只
写差异。`MockRuleStore` 在加载时把 `baseRule` 展开进每条规则，因此 `loadRules()`、
`switchRule()`、VS Code Mock APIs 树、Flutter route 同步看到的都是最终响应。

合并规则（来自 `mergeMockRule`）：

- **`status` / `delay`**：规则值覆盖 base（标量替换）。
- **`headers`**：浅合并——base 在前，规则同名 header 覆盖。
- **`body`**：当 `baseRule.body` 与规则 `body` **都是 object** 时浅合并（一层）；当规则的
  `body` 是**数组 / 字符串 / 数字 / 布尔 / null** 时，**整体替换** base body（不会按元素合并）。
- **`removeBodyFields`**：在 body 合并**之后**执行，只对 object body 生效。
- **`description` 与 `removeBodyFields`** 不会出现在最终响应里。

### 决策点：baseRule 放什么

- 多条规则共享 status / headers / 大部分 body → 用 `baseRule`，规则只写差异。
- 各规则 status 不同（200 / 401 / 500）→ **不要**把 `status` 放 baseRule（否则容易忘覆盖）；
  每条规则自己写 `status`，或把最常见的放 base 再让其余覆盖。
- body 大相径庭 → 别用 `baseRule.body`，每条规则独立写 body。

## 字段“不存在”用 `removeBodyFields`，绝不用 `null`

真实 API 有时会**省略**某个字段（key 不出现）。表达“字段不存在”**只能**用：

```json
"removeBodyFields": ["phone"]
```

不要用 `null` / `""` / `0` 伪装“字段不存在”——它们仍会作为键出现在响应里。除非真实 API
确实返回 `null`，否则不要写 `null`。

**关键陷阱：错误响应体会泄露继承字段。** 当 `baseRule.body` 是 object、某条规则想返回
`{ "error": "..." }` 时，object body 会**浅合并**——继承的用户字段会泄露出来。必须用
`removeBodyFields` 把继承的字段删掉（或让 base body 不是 object）：

```json
{
  "name": "not_found",
  "status": 404,
  "removeBodyFields": ["id", "name", "email", "phone", "role"],
  "body": { "error": "not found" }
}
```

## `mock-index.json`（注册表）

`.fliwright/mocks/mock-index.json` 列出默认激活规则与文件清单：

```json
{
  "version": 1,
  "defaultRule": "success",
  "files": ["api/user-profile.example.json", "api/login.example.json"]
}
```

- `files` 是**相对 mocks 目录**的路径，必须带 `api/` 前缀，且与磁盘文件名完全一致。
- `defaultRule` 应指向真实存在的规则名；不匹配时会**静默回退**到该文件的第一条规则。
- 新增端点文件后，记得把它追加进 `files`，否则不会被加载。
- `mock-index.json` 缺失时，`MockRuleStore` 会自动扫描 `api/*.json`、`defaultRule` 回退
  `"success"`——但显式写 index 更稳，避免漏文件或默认规则不符预期。

## 校验

加载坏文件**只会 `console.warn` 后跳过**，不会让测试失败——所以写完一定要校验。最可靠的
办法是跑一次真正的 normalizer（`@fliwright/core` 导出了 `normalizeMockEndpointConfig`），
它会抛出 status 缺失 / 结构错误并打印展开后的规则：

```bash
# 在 fliwright 仓库根目录运行（指向已构建的 dist）
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { normalizeMockEndpointConfig } from "./packages/fliwright-core/dist/index.js";
const cfg = JSON.parse(readFileSync(process.argv[1], "utf8"));
console.log(JSON.stringify(normalizeMockEndpointConfig(cfg).rules, null, 2));
' .fliwright/mocks/api/user-profile.example.json
```

> 仓库内用上面的相对 `dist` 路径（先 `pnpm --filter @fliwright/core build` 确保 `dist/` 存在）；
> 在把 `@fliwright/core` 列为依赖的下游项目里，可改成 `from "@fliwright/core"`。
> 实在没有运行环境，至少 `JSON.parse` 确认是合法 JSON，并逐条确认合并后都有 `status`。

## 示例

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

## 常见错误

| 错误 | 后果 / 正确做法 |
| --- | --- |
| 自创 `scenarios` / `routes` / `mocks[]` 结构 | `MockRuleStore` 跳过文件（warn）或抛错。必须用 `rules[]` + 扁平 `method` / `endpoint`。 |
| 用 `null` / `""` 表示字段不存在 | 字段仍作为键出现。用 `removeBodyFields`。 |
| 错误体 `{ "error": "..." }` 直接当 body | object body 会浅合并，泄露继承的用户字段。用 `removeBodyFields` 删掉继承字段，或让 base body 不是 object。 |
| 期望数组 / 嵌套 object body 按元素合并 | object body 只浅合并一层；数组 / 标量 body 整体替换。要让数组变空就在该规则里重写整个数组。 |
| 某条规则没 `status` 且 `baseRule` 也没 `status` | `loadRules()` 抛 `status is required`。共享就放 `baseRule.status`，否则每条规则都写 `status`。 |
| `mock-index` 的 `files` 写绝对路径或漏 `api/` 前缀 | 加载不到。用 `api/<file>.json` 相对路径，且与磁盘文件名一致。 |
| 文件放在 `.fliwright/mocks/` 根目录而非 `api/` 下 | 自动扫描只看 `api/*.json`。放进 `api/`。 |
| 新增端点文件后忘了更新 `mock-index.json` | 文件不会被加载。新增后追加进 `files`。 |

## 参考

mock 运行时 API（`mock.route` / `mock.loadRules` / `mock.switchRule` / `mock.findCalls`）
与“先清后设”等约定见 [write-fliwright-tests](../write-fliwright-tests/SKILL.md) 的
[references/mocks.md](../write-fliwright-tests/references/mocks.md)。本技能只负责
**生成正确的 mock 规则 JSON 文件**。
