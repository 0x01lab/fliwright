---
name: fliwright-tdd
description: >
  在 Fliwright 仓库中以测试优先方式开发时使用：TDD、red-green-refactor、
  回归测试、需要先写失败测试的 bug 修复，或用户明确提到 "先写测试"、
  "测试驱动"、"TDD"、"red green refactor"、"regression"、"回归测试" 的实现请求。
  适用于 TypeScript 包、Dart bridge、MCP 工具、CLI 行为、选择器、协议行为、
  代码生成以及生成式 feature docs 更新。涉及 Fliwright automation script、`.fliwright/tests`、
  `@fliwright/vitest` fixture、locator、flow、mock、agent、timeline、真实 Flutter app
  验证或 E2E 用例时，必须同时使用 `write-fliwright-tests` skill。
---

# Fliwright TDD

使用这个 Skill，让 Fliwright 的开发保持测试优先、范围清晰、结果可验证。Fliwright 是一个自动化运行时，所以优先写面向行为的测试，用来保护协议契约、选择器语义、生成代码以及用户可见的自动化行为。

## 组合 Skill

当 TDD 任务涉及 Fliwright 自动化测试或脚本时，先继续遵守本 Skill 的红绿重构流程，再同时使用 `write-fliwright-tests` skill 获取具体写法。典型触发包括 `.fliwright/tests`、`.fliwright/scripts`、`@fliwright/vitest`、`test` / `script` fixture、locator、selector、flow step、mock rule、agent verify、timeline、真实 Flutter app 验证、MCP 录制脚本清理和 E2E 用例。

职责分工：

- 本 Skill 决定 TDD 节奏、验证范围和什么时候扩大测试。
- `write-fliwright-tests` 决定 Fliwright 测试/脚本的文件位置、fixture 用法、locator 选择、mock/flow/timeline 写法和主动 app 验证方式。

## 核心循环

1. 用一句话定义最小行为切片。
2. 用 `rg` / `rg --files` 找到所属 package、源码位置和附近测试。
3. 只读取当前改动真正需要的文档；如果需要 API 细节，优先读取对应的 `docs/features/<package>/<Class>.md`。
4. 先写或更新一个失败测试。
5. 运行最窄范围的相关测试，确认它因为预期原因失败。
6. 写最小实现，让这个测试通过。
7. 重新运行聚焦测试，直到变绿。
8. 只在测试变绿之后重构，然后重新运行同一个聚焦测试。
9. 根据影响范围扩大验证。

如果现有 bug 报告已经包含失败测试或可复现用例，把它当作红灯步骤；只要可行，仍应在改代码前先运行一次。

## 选择测试

- TypeScript package 行为：在该 package 的 `tests` 目录下添加聚焦 Vitest 测试，文件名用 `*.test.ts`，并尽量镜像被测源码主题。
- 选择器、协议、MCP 工具或代码生成变更：必须添加回归测试。
- 公共 API 变更：同时测试新行为，以及调用方依赖的兼容行为或错误行为。
- Dart bridge 变更：可行时，在 bridge 行为附近添加或更新 `dart test` 覆盖。
- Timeline-native Flutter 自动化脚本和 `.fliwright/tests` 编写：使用 `write-fliwright-tests` skill 获取 fixture、locator、flow、mock 和真实 app 验证模式。
- HTTP mock rule JSON 变更：使用 `write-fliwright-mock-rules` skill。

第一个红绿循环优先使用单元测试或窄集成测试。E2E smoke test 适合在单元级行为已经受保护之后再跑；它们需要运行中的 Flutter VM service，不应该成为确定性逻辑的唯一覆盖。

## 命令选择

先运行能证明当前步骤的最小命令，再逐步扩大范围：

| Scope | Command |
| --- | --- |
| 单个 TypeScript package | `pnpm --filter <package> test` |
| Core package | `pnpm --filter @fliwright/core test` |
| Vitest package | `pnpm --filter @fliwright/vitest test` |
| 仓库 TypeScript build | `pnpm build` |
| 仓库 TypeScript 类型检查 | `pnpm lint` |
| 全部 TypeScript 测试 | `pnpm test` |
| Dart 分析 | `melos run analyze` |
| Dart 测试 | `melos run test` |
| E2E smoke | `FLIWRIGHT_VM_SERVICE_URL=... pnpm --filter @fliwright/e2e-tests test:smoke` |

如果依赖发生变化，TypeScript 验证前先运行 `pnpm install`。如果 Dart 依赖发生变化，运行 `melos bootstrap`。如果 pub.dev 不可达，可在当前 shell 会话中选择性 source `scripts/use-cn-pub-mirror.sh`。

## 红灯规则

- 失败测试应该描述可观察行为，而不是私有实现细节。
- 确认失败原因是预期的缺失行为或回归。
- 如果测试因为 setup、import、时序或错误假设失败，先修测试，再改生产代码。
- 失败断言要足够具体，让下一个开发者能从测试名和断言信息理解契约。

## 绿灯规则

- 只做满足失败行为所需的最小源码改动。
- 新增公共 API 时，遵守通过 `src/index.ts` 导出的既有约定。
- TypeScript ESM 相对导入保留显式 `.js` 后缀。
- 不要在没有测试的情况下扩大选择器、协议 payload、生成输出或 MCP 契约。
- 不要更新 `dist` 之类的生成构建产物。

## 重构与文档

- 只在测试为绿时重构。
- 每次有意义的重构后，重新运行聚焦测试。
- 触及共享 helper、公共 API 或跨 package 契约后，运行 package 级验证。
- 重要源码行为或公共 API 变化后，使用 `document-features` skill 重新生成或更新 `docs/features/`。

## 验证受阻时

如果所需 VM service、设备、网络或外部依赖不可用，清楚说明阻塞点，运行不依赖它们的静态检查或单元级检查，并留下最终验证所需的精确命令。
