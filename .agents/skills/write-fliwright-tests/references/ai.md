# AI 能力（AI Features）

> 本文是 `write-fliwright-tests` 技能的 AI 子系统参考。所有签名均取自当前源码（`packages/fliwright-core/src/ai/*`、`SelfHealingEngine.ts`、`Assertion.ts`、`FakerGenerator.ts` 等）；若与源码不一致，以源码为准。

Fliwright 不只是“驱动控件”的自动化框架，还内置了一整套 **AI 能力**，用来解决传统 UI 自动化最痛的几个问题：选择器一改就挂、长表单造数困难、断言难写、出错后难诊断。这些能力分四类：

| 能力 | 解决什么问题 | 典型入口 |
| --- | --- | --- |
| **AI 运行时（Runtime）** | 让脚本直接调用大模型：造数、分类、视觉断言、结构化抽取 | `aiRuntime` fixture、`ai` 命名空间 |
| **自愈（Self-Healing）** | 控件文案/位置变了，断言自动找到新控件并修复选择器 | `expect()`（自动触发）、`driver.healing` |
| **智能表单填充（AI Form Fill）** | 自动识别每个字段的语义类型并生成逼真假数据 | `page.formHelper`（详见 [forms.md](./forms.md)） |
| **辅助生成器** | 语义推断、假数据、断言建议，可独立使用 | `SemanticInferrer` / `FakerGenerator` / `AssertionSuggester` |

先记住一句话心智模型：**AI 能力默认是关闭或 mock 的，不会偷偷联网花钱**。要用真实模型，必须显式配置 provider（见下文）。这让 CI 永远确定性、本地调试才接真模型。

---

## 1. 配置 AI Provider

Fliwright 通过“适配器（adapter）”对接外部模型，统一抽象成 `AiAdapter`。当前支持的 provider：

```ts
type AiProviderName = 'mock' | 'claude' | 'codex' | 'custom-cli' | 'none';
```

| Provider | 含义 | 是否需要外部依赖 |
| --- | --- | --- |
| `mock` | 确定性假适配器，返回预设/兜底值 | ❌ 无，适合 CI 与单测 |
| `claude` | 调用本机 `claude` CLI（`ClaudeCliAdapter`） | ✅ 需安装 Claude CLI 并登录 |
| `codex` | 调用本机 `codex` CLI，默认参数 `exec --json`（`CodexCliAdapter`） | ✅ 需安装 Codex CLI |
| `custom-cli` | 任意遵循 JSON 契约的命令行工具（`CliJsonAdapter`） | ✅ 由你提供命令 |
| `none` | 显式禁用 AI（默认值） | ❌ |

> 注意：没有“原生 OpenAI HTTP 适配器”。要用 OpenAI/其它服务，包一层满足 `AiAdapter.invoke` 契约的自定义适配器，或用 `custom-cli` 调你自己的命令行封装。Claude/Codex 走的是它们各自的 CLI。

### 三种配置方式（优先级：代码 > 环境变量）

**方式 A：环境变量（推荐用于 CLI/MCP 运行）**

```bash
export FLIWRIGHT_AI_PROVIDER=mock          # mock | claude | codex | custom-cli | none
export FLIWRIGHT_AI_ENABLED=true           # 默认: provider !== 'none' 即开启
export FLIWRIGHT_AI_TIMEOUT_MS=60000       # 单次调用超时，默认 60_000ms
export FLIWRIGHT_AI_ARTIFACTS_DIR=.fliwright/ai   # 产物/调试输出目录
export FLIWRIGHT_AI_CACHE=off              # off | read | write | read-write，默认 off
# 仅 claude/codex/custom-cli 生效：
export FLIWRIGHT_AI_COMMAND=claude
export FLIWRIGHT_AI_ARGS="exec,--json"     # 逗号分隔的参数
```

**方式 B：在 `createFliwrightTest` 里配置（推荐用于 `.test.ts`）**

```ts
import { createFliwrightTest, defineConfig, expect } from '@fliwright/vitest';

const test = createFliwrightTest(defineConfig({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? '',
  ai: {                       // AiRuntimeConfig
    provider: 'mock',         // CI 用 mock；本地可改 'claude'
    timeoutMs: 60_000,
    artifactsDir: '.fliwright/ai',
    cache: 'read',            // 复用上次结果，省时省钱
  },
}));
```

`AiRuntimeConfig` 完整字段：`provider?`、`cache?`、`timeoutMs?`、`artifactsDir?`、`adapter?`（可直接传一个实现了 `invoke` 的对象，或 `{ command, args }`）、`maxConcurrency?`（默认 1）、`enabled?`、`defaultVisionContext?`。

**方式 C：`configureAi()` 配置共享运行时（用于不经过 fixture 的脚本）**

```ts
import { configureAi, ai } from '@fliwright/core';

configureAi({ provider: 'mock' });   // 会清掉旧的共享 runtime，下次 ai.* 重建
```

---

## 2. 两种调用入口

### 入口一：`aiRuntime` fixture（推荐，用于 `.test.ts`）

`@fliwright/vitest` 的 fixture 多提供了一个 `aiRuntime`，它是一个已经绑定了当前 `page`/`driver`/`testName` 的 `AiRuntime`，视觉类调用不用再手动塞 page：

```ts
import { test, expect } from '@fliwright/vitest';

test('登录后出现欢迎页', async ({ page, aiRuntime }) => {
  await page.getByKey('username').fill('alice');
  await page.getByKey('password').fill('pw');
  await page.getByKey('login').click();

  // 视觉断言：把当前屏幕交给模型判断
  await aiRuntime.visible('登录成功，可以看到「欢迎，alice」', { page });
});
```

### 入口二：`ai` 命名空间（用于脚本、脱离 fixture）

从 `@fliwright/core` 直接 import，背后是一个懒加载的共享 `AiRuntime`。视觉类方法需要在参数里显式传 `{ page }`：

```ts
import { ai, configureAi } from '@fliwright/core';

configureAi({ provider: 'mock' });

const user = await ai.generate<{ phone: string }>({
  prompt: '生成一个中国大陆注册用户的手机号',
  schema: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] },
  fallback: { phone: '13800138000' },     // 模型不可用/校验失败时的兜底
});

await ai.visible('注册成功提示已出现', { page });   // 必须传 page
```

### 五个核心方法（签名取自 `AiRuntime.ts` / `capability.ts`）

| 方法 | 签名 | 用途 |
| --- | --- | --- |
| `ask` | `ask(input: AiRequest, call?): Promise<AiResponse>` | 最底层的文本/JSON 请求 |
| `generate` | `generate<T>(input: AiGenerateRequest<T>, call?): Promise<T>` | 带 schema 校验 + `fallback` 兜底的结构化生成 |
| `classify` | `classify(input: AiClassifyRequest, call?): Promise<string>` | 在 `choices[]` 里做分类，返回选中项 |
| `visible` | `visible(prompt: string, options?: AiVisibleOptions, call?): Promise<void>` | 视觉断言：不满足时抛 `AiAssertionError` |
| `inspect` | `inspect<T>(input: AiInspectRequest, call?): Promise<T>` | 视觉抽取：看截图/快照返回结构化结果 |

- `AiRequest` 含 `prompt` 与可选 `schema?: JsonSchema`。
- `AiGenerateRequest<T>` 在 `AiRequest` 基础上加 `fallback?: T`：当模型结果缺字段或 schema 校验失败，用 `fallback` 兜底，**不会让测试直接红**。
- `AiClassifyRequest` 在 `AiRequest` 基础上加 `choices: string[]`，模型只能从中选。
- `AiVisibleOptions` / `AiInspectRequest` 继承 `AiVisionOptions`，可设 `includeScreenshot?`、`includeSnapshot?`，决定把截图还是控件树（或两者）喂给模型。

**`generate` 实战：给注册表单造一组数据**

```ts
test('注册成功', async ({ page, aiRuntime }) => {
  const user = await aiRuntime.generate<{ phone: string; code: string; email: string }>({
    prompt: '生成一组中国注册用户：手机号、6 位短信验证码、邮箱',
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', pattern: '^1[3-9]\\d{9}$' },
        code:  { type: 'string', pattern: '^\\d{6}$' },
        email: { type: 'string', format: 'email' },
      },
      required: ['phone', 'code', 'email'],
    },
    fallback: { phone: '13800138000', code: '123456', email: 'qa@example.com' },
  });

  await page.getByKey('phone').fill(user.phone);
  await page.getByKey('code').fill(user.code);
  await page.getByKey('email').fill(user.email);
  await page.getByKey('submit').click();
  await expect(page.getByText('注册成功')).toBeVisible();
});
```

**`classify` 实战：根据当前页面分类下一步**

```ts
const state = await aiRuntime.classify({
  prompt: '判断当前屏幕是登录页、注册页还是首页',
  choices: ['login', 'register', 'home'],
});
```

**`inspect` 实战：让模型读屏找错误**

```ts
const result = await aiRuntime.inspect<{ hasError: boolean; message?: string }>({
  prompt: '屏幕上是否有表单校验错误？如有，原样摘录错误文案',
  schema: {
    type: 'object',
    properties: { hasError: { type: 'boolean' }, message: { type: 'string' } },
    required: ['hasError'],
  },
  includeScreenshot: true,
});
```

---

## 3. 自愈（Self-Healing）

自愈解决“选择器脆”的老问题：你用 `text=提交` 做断言，UI 改成 `text=确认提交`，传统测试直接挂；Fliwright 会**自动**找到那个最像的控件，让断言通过，并记下“原选择器 → 建议选择器”的修复建议。

### 它是怎么自动工作的

只要用 `@fliwright/vitest` 的 `expect()`，自愈就自动挂上了（源码：`Assertion.ts` + `vitest/index.ts` 把 `driver.healing` 注入了断言）。流程：

1. **断言通过** → 记录一张“成功快照”（`SnapshotStore`，按 `testName + 选择器字符串` 存），作为日后比对基准。
2. **断言失败（且非 `.not` 否定）** → 调 `SelfHealingEngine.tryHeal`：
   - 取出之前存的快照；
   - 抓取当前屏幕的候选控件；
   - `MultiDimensionalHealingStrategy` 在 **4 个维度**上给每个候选打分并加权：

     | 维度 | 权重 | 比的是什么 |
     | --- | --- | --- |
     | text | 0.35 | 文案相似度（n-gram） |
     | context | 0.30 | 父级/相邻控件结构 |
     | position | 0.20 | 位置是否接近 |
     | codeBinding | 0.15 | 回调名/类型绑定 |

   - 加权分 ≥ **0.85**（`DEFAULT_THRESHOLD`）即认定命中 → 断言视为通过，并产出一份 `HealingReport`。
3. 若未达阈值，照常抛 `AssertionError`，并把建议写进失败上下文（MCP/CLI 报告里能看到）。

> `.not`（否定断言）**关闭**自愈——否则逻辑会自相矛盾。源码里对 `negated` 直接跳过记录与尝试。

### 查看与控制自愈

```ts
test('...', async ({ page, driver }) => {
  driver.healing.setEnabled(false);                 // 整个用例关闭自愈
  // ... 操作 + 断言 ...
  driver.healing.setEnabled(true);

  // 拿到本用例的所有自愈报告
  const reports = driver.healing.getReports();      // 不传 testName 取全部
  for (const r of reports) {
    console.log(`${r.originalSelector} → ${r.suggestedSelector} (置信度 ${r.confidence})`);
  }
});
```

`HealingReport` 字段：`testName`、`originalSelector`、`suggestedSelector`、`confidence`、`scores: { position, context, codeBinding, text, weighted }`、`originalSnapshot`、`matchedWidget`、`timestamp`。

> 自愈只是“让这次断言通过 + 给修复建议”，**不会改写你的 `.test.ts`**。你应当在 review 报告后，手动把 `originalSelector` 换成更稳的 `suggestedSelector`（或换成 `getByKey`），让测试长期稳定。

### 什么时候该关掉自愈

- 你**就是要验证**某个控件消失了（用 `.not`，自动关闭）。
- 调试选择器本身，不希望“假通过”掩盖问题（`setEnabled(false)`）。
- CI 想要严格语义、零容忍漂移时。

---

## 4. 智能表单填充（AI Form Fill）

详见 [forms.md](./forms.md)，这里只讲 **AI 视角**。`page.formHelper` 的填充管线天然结合了 AI/推断：

```
ext.fliwright.extractForm → 原始字段元信息
        │
   SemanticInferrer.infer()    → 推断 SemanticType（phone/email/password/idCard…）
        │
   SkillRegistry.match()       → 命中 .fliwright/forms/*.json 规则？
        │   ├─ 命中 PRESET_SKILL 规则        → 从 data[] 取值/轮换（单元素即固定值）
        │   ├─ 命中 REGEXP_MOCK 规则         → 按 pattern 正则造数
        │   └─ 命中 LLM_GENERATE 规则        → AI 生成（未配 AI 时回退到 data[]）
        │
   FakerGenerator.generate()   → 未命中规则时，按语义类型生成本地化假数据
        │
   SelectorResolver            → 选最稳的选择器（text > key > role > type）
        │
   通过 locator 写入
```

- **不需要 AI 也能用**：默认走 `SemanticInferrer` + `FakerGenerator`，完全确定性。
- **要让某个字段“问 AI”**：在 `.fliwright/forms/*.json` 里给它写一条 `LLM_GENERATE`（或带 `data` 数列的 PRESET）规则；当 AI provider 为 `none`/`mock` 时会走兜底。
- `FormHelperOptions` 里 `dataIndex?: number` 可指定取规则 `data` 数组里的第几行（默认自动轮换）。

> 规则 `type` 只有三种（见 `FormRule` / `JsonRuleLoader`）：`PRESET_SKILL`（从 `data: string[]` 取值并轮换，单元素数组即等价于固定值）、`REGEXP_MOCK`（按 `pattern` 正则造数）、`LLM_GENERATE`（AI 生成；未配 AI 时回退到 `data[]`）。`FormHelperOptions.dataIndex` 可指定取第几行，不传则自动轮换。

---

## 5. 可独立使用的辅助类

这三个类都从 `@fliwright/core` 导出，即便不接 AI 模型也能用，常用于自定义脚本或断言。

### `FakerGenerator` — 按语义类型造假数据

```ts
import { FakerGenerator } from '@fliwright/core';

const faker = new FakerGenerator({ locale: 'zh-CN' });
faker.generate('phone');     // 形如 1[3-9]xxxxxxxxx
faker.generate('email');
faker.generate('idCard');    // 带校验位的中国身份证
faker.generate('password');
faker.generate('captcha', 6);
// 支持的 SemanticType: phone | email | idCard | fullName | address | password
//                       | captcha | number | text | url | date | boolean | option
```

签名：`new FakerGenerator(options?: { locale?: string })`；`generate(semanticType: SemanticType, maxLength?: number): string`。

### `SemanticInferrer` — 从字段元信息推断语义类型

```ts
import { SemanticInferrer } from '@fliwright/core';
const inferrer = new SemanticInferrer();
const types = inferrer.infer(fields);   // Map<字段id, SemanticType>
```

它综合 hintText、keyboardType、控件类型（复选框→boolean，单选/下拉→option）来推断。`page.formHelper` 内部就是用它。

### `AssertionSuggester` — 给录制操作建议断言点

```ts
import { AssertionSuggester } from '@fliwright/core';
const suggester = new AssertionSuggester();
const tips = suggester.suggest(recordedOperations);
// tips: { afterIndex: number; reason: string; template: string }[]
```

启发式规则举例：屏幕顶部的 tap 可能是导航、表单输入后的 tap 可能是提交、drag 后的 tap 可能是列表项选中。`template` 是一行 `// TODO: …` 注释占位，供你补全。录制→生成代码流程（见 [mcp-workflow.md](./mcp-workflow.md)）会用到它。

---

## 6. 错误处理

AI 调用失败会抛 `@fliwright/core` 导出的结构化错误，都继承自 `AiInvocationError`（带 `artifactsDir?`、`cause?`）：

| 错误类 | 何时抛 |
| --- | --- |
| `AiDisabledError` | provider 为 `none` 或 `enabled=false` 时调用 AI |
| `AiTimeoutError` | 超过 `timeoutMs` |
| `AiParseError` | 模型返回无法解析 |
| `AiSchemaValidationError` | `generate`/`inspect` 的结果不符合 schema 且无 fallback |
| `AiAssertionError` | `visible` 视觉断言不满足 |

```ts
import { AiDisabledError, AiTimeoutError } from '@fliwright/core';

try {
  await aiRuntime.visible('应看到结算页', { page });
} catch (e) {
  if (e instanceof AiDisabledError) {
    // AI 没开：降级成普通断言，别让用例因为“没配 AI”而红
    await expect(page.getByText('结算')).toBeVisible();
  } else if (e instanceof AiTimeoutError) {
    // 模型太慢，记录到 artifactsDir 后人工排查
  } else {
    throw e;
  }
}
```

> 写“可选 AI”的用例时，**务必**捕获 `AiDisabledError` 并降级，否则在没配 AI 的环境（多数 CI）会平白失败。

---

## 7. 产物与缓存

- `FLIWRIGHT_AI_ARTIFACTS_DIR`（默认 `.fliwright/ai`）：每次调用的 prompt/响应/截图快照会落盘，方便事后排错（`AiInvocationError.artifactsDir` 会指向它）。
- `FLIWRIGHT_AI_CACHE`（默认 `off`）：
  - `read`：复用历史结果，省时省钱（适合稳定 prompt）。
  - `write`：把本次结果写进缓存。
  - `read-write`：两者都做。
  - 缓存对 `mock` provider 尤其有用——CI 里既确定性又快。

---

## 8. 决策建议（什么时候用什么 provider）

| 场景 | 建议 |
| --- | --- |
| CI / 回归 | `mock`（或 `none`）。确定性、零成本、零外部依赖。 |
| 本地写/调脚本 | `claude` 或 `codex`，让真模型帮你造数、视觉断言。 |
| 表单大部分字段 | 默认 `FakerGenerator` 就够；只有少数语义复杂的字段才上 `LLM_GENERATE`。 |
| 视觉类断言（`visible`/`inspect`） | 仅在本地或专门的 AI 验证 job 里开；CI 降级为 `getByText` 断言。 |
| 想用 OpenAI/自建服务 | 包一个满足 `AiAdapter.invoke` 的适配器，或用 `custom-cli` 调你的命令行封装。 |

## 9. 相关文档

- 表单填充全貌 → [forms.md](./forms.md)
- 断言与自动等待 → [assertions.md](./assertions.md)
- 录制 → 生成代码 → 运行 → 查失败（含自愈建议） → [mcp-workflow.md](./mcp-workflow.md)
- 失败时如何拿到自愈建议与诊断 → [troubleshooting.md](./troubleshooting.md)
- 测试夹具与 `aiRuntime` 装配 → [test-harness.md](./test-harness.md)
