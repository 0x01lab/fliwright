# MCP 辅助工作流

当 Fliwright MCP server 已连接时，你可以**发现**行为、**录制**一条流程、**生成**测试初稿、**运行**测试、**诊断**失败——全程不用离开对话。最终目标始终是提交一份正常的 `.test.ts`；MCP 只是达成目标的手段。

## 工具速览

| 工具 | 用途 | 产物 |
| --- | --- | --- |
| `fliwright_connect` | 确认当前桥接与连通性 | 连接/能力状态 |
| `fliwright_snap` | 给当前屏幕拍一张语义快照 | `AgentSnapshotResult`（refs） |
| `fliwright_observe` | 查找匹配某个查询的控件 | 命中的 refs |
| `fliwright_record` | 捕获实时流程 → 测试初稿代码 | 生成的 TS/Dart |
| `fliwright_generate_test` | 由 refs 或快照生成测试 | 使用 `findRef(...)` 的 `.test.ts` 初稿 |
| `fliwright_run` | 针对 VM 执行测试，返回完整 AI 报告 | `RunResult` + 产物 |
| `fliwright_get_failure` | 读取某次失败的完整上下文 | assertion + tree + diagnostics + screenshot + healing |

## 典型流程

1. **确认桥接就绪**——`fliwright_connect`。如果它报 `Unknown method "ext.fliwright.snap"`，说明应用还在用旧版桥接；先升级再继续（见 [troubleshooting.md](./troubleshooting.md)）。
2. **查看**——用 `fliwright_snap` / `fliwright_observe` 看清屏幕上实际有什么，并找到一个稳定的查询（role + text + key）。
3. **捕获流程**——`fliwright_record` 录下用户路径。原始产出只是起点，不是最终测试。
4. **生成初稿**——带着捕获到的 `refs`/`snapshot` 调 `fliwright_generate_test`。优先选择产出 `page.findRef(...)` 查询的变体，而不是硬编码的临时 ref。
5. **运行**——用 `fliwright_run` 执行。它返回的报告结构与 `fliwright run --reporter ai-json` 一致（见 [cli.md](./cli.md)）。
6. **诊断**——失败时调 `fliwright_get_failure` 取断言详情、控件树、诊断信息、截图产物、源码位置和自愈建议。
7. **提交**——精简选择器、把临时 ref 换成更稳的查询 locator、补上断言、写盘。

## `fliwright_run`

针对正在运行的 VM Service 执行测试文件，并返回完整 AI 报告（结构与 CLI 的 `RunResult` 一致）。优先用它而不是直接 `pnpm vitest`，这样能拿到截图、诊断信息和复现命令。

```jsonc
fliwright_run({
  testFile: "e2e/form-mock-e2e.test.ts",
  vmServiceUrl: "ws://127.0.0.1:54321/abc=/ws",
  screenshot: "file"
})
```

结果包含 `passed`、按用例的 `results`、可选的 `failures[]`、`artifacts`（runId、outputDir、reportPath、screenshots）以及 `reproduceCommand`。

## `fliwright_get_failure`

某次 `fliwright_run` 失败后，取出结构化的失败条目。它与 CLI 持久化到 `failures.json` 的 `CliFailureEntry` 是同一个东西：

```text
- testName
- assertion: { matcher, expected, actual, timeout }
- widgetTree            (the snapshot at failure time)
- diagnostics: VMServiceEvent[]   (recent logs/stderr)
- source: { file, line, snippet }
- screenshot: { path }            (when screenshot mode = file)
- healingSuggestion: { originalSelector, suggestedSelector, confidence, scores }
```

用 `healingSuggestion` 升级你的选择器，用 `widgetTree`/`source` 去理解为什么匹配失败。

## `fliwright_snap` / `fliwright_observe`

两者都调用桥接的 `ext.fliwright.snap`。`fliwright_observe` 就是把 `fliwright_snap` 限定到一个 find-query 范围内——等价于代码里的 `page.findRef(...)`。可以用它们来：

- 确认当前桥接暴露了 snap/ref/action，
- 为你要提交的选择器找到稳定查询（role + text + key），
- 在盲写选择器之前先确认屏幕上实际有什么。

## `fliwright_record` → `fliwright_generate_test`

```jsonc
fliwright_record({
  vmUrl: "ws://127.0.0.1:54321/abc=/ws",
  lang: "ts",
  name: "checkout flow",
  homeRoute: "/"
})

fliwright_generate_test({
  // pass the captured refs/snapshot so the draft uses findRef(...) queries
  refs: /* from record */,
  lang: "ts"
})
```

**之后必须清理生成的代码**（这是强制的，不是可选项）：

- 把临时的 `e<N>` ref 换成 `page.getBySemantics(...)` / `page.getByKey(...)` / `findRef(...)`，
- 删掉多余的探索性点击，
- 给可见的结果补上断言，
- 删掉任何写死的 `sleep`。

## 决策：MCP 还是手写

| 想要什么 | 用什么 |
| --- | --- |
| 一份健壮、经过 review、可提交的测试 | 用 fixture 手写，可选地**借助** MCP 发现来辅助 |
| 快速验证“这条流程现在跑得通吗？” | `fliwright_record` + `fliwright_run` |
| 理解一条不稳定/失败的测试 | `fliwright_get_failure` + `fliwright_snap` |
| 告诉同事/CI 该跑什么 | 提交一份 `.test.ts` + 一条 `package.json` 脚本（见 [cli.md](./cli.md)） |

MCP 工具产出的是**初稿和诊断信息**；最终提交的测试始终是一份手工打磨的 `.test.ts`。
