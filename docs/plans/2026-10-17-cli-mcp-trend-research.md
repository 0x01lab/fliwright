# Fliwright CLI-first / MCP 趋势研究

研究日期：2026-10-17（Asia/Hong_Kong）。仅研究公开一手资料；没有修改项目源码。本文区分已核实事实与对 Fliwright 的设计推论，不把产品 README 的观点视为行业定量调查。

## 结论

**对主要服务本地 coding agent 的 Flutter 自动化产品，CLI + 渐进加载的 skill + 可编程 TypeScript API，是有明确先例的合理方向。** 最直接的同类先例是 Microsoft Playwright：截至本次检索，官方 CLI 与 MCP 两个仓库都明确建议 coding agent 使用 CLI + SKILLS，同时都明确保留 MCP 的适用场景。[S1][S2]

**这些证据不能推出“MCP 已过时”或“删除 MCP 必然更省 token”。** Anthropic 推动的是按需发现、代码编排和结果过滤；其方案明确继续使用 MCP 作为后端协议。[S3][S4] MCP 协议也支持本地进程和远端服务。[S5][S6]

Fliwright 是否彻底删除 MCP，应由目标客户端是否能直接执行本地命令、团队是否需要远程标准连接器、现有用户与集成占比决定。若产品范围明确收敛到具有 shell 权限的本地 coding agent / 开发者 / CI，删除独立 MCP 包可以减少维护面；如果仍承诺只提供 MCP 接口的宿主与远程连接器，CLI 本身不能自动维持这些入口。这是产品覆盖面的决策，不能仅靠“趋势”证明。

## 已核实证据

### 1. Playwright 官方给出 CLI-first 的同类先例，而不是宣告 MCP 废弃

Playwright CLI README 原文：

> This package provides CLI interface into Playwright. If you are using **coding agents**, that is the best fit.

随后给出的理由是：通过 SKILL 暴露的 CLI 调用避免预先加载大量 tool schema 与冗长 accessibility trees，适合需要为代码、测试和推理保留上下文的 coding agent。[S1]

同一份 README 也写道：

> MCP remains relevant for specialized agentic loops that benefit from persistent state, rich introspection, and iterative reasoning over page structure ...

Playwright MCP README 同时链接并推荐 CLI + SKILLS，仍提供 MCP 安装方式与客户端配置，没有声明 server 退役。[S2] 这能证明 Microsoft 项目对不同使用场景的取舍，不能证明全行业 MCP 使用量下降。

这两个 README 已通过 GitHub commits API 固定为截止日期之前的修订；下载固定修订后与 main 内容完全一致：[S1] README 最后修改于 2026-09-28T23:14:21Z，[S2] 于 2026-09-28T22:55:35Z。

### 2. CLI 可以有持久会话；“每条命令都必须重连”并非 CLI 的固有属性

Playwright CLI 文档提供 `-s=<session>`、`PLAYWRIGHT_CLI_SESSION`、`list`、`close-all` 和 `kill-all`。浏览器内存状态可在同一 session 的不同 CLI 调用之间保留；`--persistent` 可写磁盘 profile；headless session 默认空闲一小时后结束。[S1]

对 Fliwright 的推论：CLI 前台命令与驻留 session runtime 是不同层。去掉 MCP server，不代表也必须去掉负责 VM-Service 长连接、订阅、录制和缓存的后台 runtime。具体寿命策略应按 Fliwright 的行为重新设计，不能照抄浏览器默认值。

### 3. Anthropic 的优化对象是“全量 schema 与中间结果进入上下文”，并非 MCP 协议本身

Anthropic 2025-11-04 的《Code execution with MCP》提出：把 MCP server 暴露为可调用代码 API，让 agent 按需探索工具文件并在执行环境中处理数据。[S3] 文中给出一个从 150,000 tokens 降到 2,000 tokens（98.7%）的示例，同时明确说明代码执行环境会引入 sandbox、资源限制与监控的额外复杂性。[S3]

这是特定例子，不是 Fliwright CLI 对 MCP 的基准；不能把 98.7% 当成迁移收益预测。若 CLI 每次直接返回完整 widget tree、截图 base64 或完整日志，仍会污染模型上下文。

Anthropic 2025-11-24 的《Introducing advanced tool use》进一步提供 Tool Search（按需发现）与 Programmatic Tool Calling（代码编排），明确可对 MCP server 延迟加载。[S4] 其 85% token 节省与其他数字同样属于文章自己的测试场景，不证明 CLI 优于经过延迟加载和输出裁剪的 MCP。

对 Fliwright 的推论：迁移真正应该交付的是可发现的 command/schema、可裁剪输出、artifact 路径、批处理与代码编排，而不只是把几十个 MCP tool 一对一改成几十条 command。

### 4. MCP 的标准连接能力与本地 CLI 是不同产品能力

MCP 2025-11-25 架构说明：host 管理 client，每个 client 对接 server；server 可以是本地进程或远端服务；通过资源、工具和 prompts 暴露能力并协商 capabilities。[S5]

该版本传输规范明确两类标准 transport：stdio 与 Streamable HTTP；stdio 由 client 启动 server 子进程，Streamable HTTP server 可独立运行并接受多个 client 的连接。[S6]

因此：有 shell 执行能力且能访问目标机器/应用的 agent，可通过 CLI 使用自动化；只能连接 MCP endpoint、不能任意启动本地进程或执行 shell 的宿主，需要其认可的连接机制。删掉 MCP 后，原有 MCP 配置不能直接改一个 command 名称就得到等价连接。

这里引用固定版本规范，而不是不断变化的 latest 页面，避免把未来协议变更倒推到现状。

## 可以直接用于设计评审的标准

1. **主目标是否本地 coding agent / 开发者 / CI？** 若是，CLI-first 与 SDK-first 组合有充分一手先例。
2. **是否仍承诺 MCP-only / remote-host 集成？** 若承诺，应把删除 MCP 定义为明确的产品能力收缩，或另立未来适配器，不宣称协议无损替换。
3. **是否完成输出预算？** 默认返回操作摘要、定位信息与 artifact 引用；按需扩大 tree/log/result，而不是每条命令都回传全部状态。
4. **是否保留状态层？** 长连接、HTTP mock、事件订阅、录制与 session lifecycle 要有独立 runtime；CLI 是调用入口，不是所有状态的保存地。
5. **是否实际测量？** 用同一 Flutter 流程、相同失败重试策略、相同结果信息量比较：prompt/tool 元数据 token、结果 token、agent round trips、p50/p95 延迟、成功率、可恢复性。不能只比较 command 字符数与 schema 字符数。

## 来源

- **[S1] Microsoft Playwright CLI README，固定修订 83368cb3bfc0b2bd8ff8af4ade8e0107461ed421（2026-09-28）**：https://github.com/microsoft/playwright-cli/blob/83368cb3bfc0b2bd8ff8af4ade8e0107461ed421/README.md
- **[S2] Microsoft Playwright MCP README，固定修订 ea00e62b711700733a9eff05b149b48cd3eb1b48（2026-09-28）**：https://github.com/microsoft/playwright-mcp/blob/ea00e62b711700733a9eff05b149b48cd3eb1b48/README.md
- **[S3] Anthropic，Code execution with MCP: Building more efficient agents，2025-11-04**：https://www.anthropic.com/engineering/code-execution-with-mcp
- **[S4] Anthropic，Introducing advanced tool use on the Claude Developer Platform，2025-11-24**：https://www.anthropic.com/engineering/advanced-tool-use
- **[S5] MCP specification 2025-11-25，Architecture**：https://modelcontextprotocol.io/specification/2025-11-25/architecture
- **[S6] MCP specification 2025-11-25，Transports**：https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

检索方式：直接 HTTPS 获取原站页面与 GitHub raw；Anthropic 页面先用 urllib 返回 403，随后 curl 常规浏览器 User-Agent 返回 200 并成功读出全文。没有用二手摘录代替一手页面。
