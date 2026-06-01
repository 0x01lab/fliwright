---
package: "@fliwright/mcp"
version: "0.1.0"
layer: transport
status: implemented
generated: "2026-06-01"
---

# @fliwright/mcp

> MCP (Model Context Protocol) server that exposes Fliwright test capabilities as tools and resources for AI agents.

## Tools

| Tool | Description | Doc |
|------|-------------|-----|
| `fliwright_run` | Run a Fliwright test file and return results | [fliwright-run.md](./fliwright-run.md) |
| `fliwright_get_failure` | Get detailed failure context with healing suggestions | [fliwright-get-failure.md](./fliwright-get-failure.md) |
| `fliwright_generate_test` | Generate test code from Flutter source | [fliwright-generate-test.md](./fliwright-generate-test.md) |
| `fliwright_record` | Record user interactions and generate test code | [fliwright-record.md](./fliwright-record.md) |

## Resources

| Resource | URI | Doc |
|----------|-----|-----|
| `test_report` | `fliwright://test-report/latest` | [test-report.md](./test-report.md) |

## Dependencies

- `@fliwright/core` — workspace:*
- `@modelcontextprotocol/sdk` — ^1.12.0
- `vitest` — ^2.0.0
- `zod` — ^3.25.0

## Usage Example

```typescript
import { createFliwrightServer } from '@fliwright/mcp';

const { server, state } = createFliwrightServer();
// Connect to stdio transport for MCP client usage
```
