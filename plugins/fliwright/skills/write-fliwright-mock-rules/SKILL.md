---
name: write-fliwright-mock-rules
description: Create or edit contract-backed Fliwright HTTP Mock endpoint JSON in shared or Item-local mocks directories. Use for response body design, named rules, baseRule inheritance, removeBodyFields, and rule registration.
---

# Write Fliwright Mock Rules

## Endpoint Files And Loading Modes

Create Mock JSON that follows the app's API contract. Each file describes one HTTP method and endpoint with one or more named responses in `rules[]`. Use the endpoint schema and avoid adding `scenarios`, `routes`, or `mocks[]` wrappers. Put shared files in `.fliwright/mocks/api/*.json` and Item-specific variants in `.fliwright/test-plans/<iid>/mocks/api/*.json`. Both locations use the same schema.

| Mode | Registration and selection |
| --- | --- |
| Named scenarios, preferred for Item acceptance | Declare `{ name, directory, files }` in `sources` and explicitly select `{ source, method, endpoint, rule, replace? }` in `rules`. This activates only selected responses and skips the index. Use `replace: true` when overriding the same method and endpoint from a parent scenario. Replacement across sources swaps the entire response, including its body. |
| Single-directory tools | Use `loadRules()` to load default responses for the directory and `switchRule()` to select another loaded rule. This mode uses the index below. |

Use one loading mode per composition. For named scenarios, see [composing shared and Item-specific rules](../write-fliwright-tests/references/mock-rule-sets.md). For runtime APIs and cleanup, see [HTTP Mock](../write-fliwright-tests/references/mocks.md).

Example `.fliwright/mocks/mock-index.json` for a single directory.

```json
{
  "version": 1,
  "defaultRule": "success",
  "files": ["api/user-profile.example.json", "api/login.example.json"]
}
```

`files` entries are relative to the mocks directory. Use the project's `api/` prefix convention and match filenames on disk. Register new endpoints in the existing index's `files` or in the relevant named source's file list. Without an index, the loader scans `api/*.json` and defaults to `"success"`. If `defaultRule` fails to match a rule in a file, the loader uses that file's first rule. Check which response was selected.

## Verify The Response Contract

Check the target app's API contract and the goal before creating or editing a response, including when using this skill on its own. The schema defines the rule structure and `sources` locates data files. Verify the business response body separately.

- Trace the API client, response model or parser, repository, and controller or provider to confirm how the app sends requests and parses responses. Consult API docs for the applicable version or confirmed response samples when needed. A client default does not prove that the backend sends a field.
- Reuse shared responses that match the contract and the target branch. Derive the business state from requirements and acceptance criteria. Derive the response shape from the contract. Use the examples here as format references.
- Build deterministic data in the verified shape. Keep required fields and change only the fields that distinguish the scenario. Redact real samples while preserving types, formats, and relationships among IDs, permissions, and states across endpoints.
- If the contract is missing or sources conflict, document the evidence and gaps, complete the portions you can verify, and leave the affected response pending confirmation. Use only supported fields, enums, and business codes. Keep production code independent of the fixture. When relying on client code alone, identify unverified backend semantics.

For test branch derivation, see [building mocks for business scenarios](../write-fliwright-tests/references/scenario-design.md#从业务分支构建正确-mock).

## Schema

Endpoint file fields

| Field | Required | Description |
| --- | --- | --- |
| `version` | Yes | Always `1` |
| `name` | Yes | Human-readable endpoint name |
| `method` | Yes | Uppercase HTTP method, such as `"GET"` or `"POST"` |
| `endpoint` | Yes | Path such as `/api/v1/user` |
| `baseRule` | No | Shared response fields `{ status?, delay?, headers?, body? }` |
| `rules` | Yes | At least one named response |
| `description` | No | File description |

Fields for each entry in `rules[]`

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Response selector in snake_case, such as `success` or `validation_error` |
| `status` | After merging | HTTP status code. Can inherit `baseRule.status`. |
| `delay` | No | Delay in milliseconds |
| `headers` | No | Response headers |
| `body` | No | Object, array, scalar, or `null` |
| `description` | No | Documentation for readers. Omitted from the final response. |
| `removeBodyFields` | No | List of top-level fields to remove after merging. Applies only to object bodies. |

## Merge Semantics

`MockRuleStore` expands `baseRule` when it loads the file. All entry points use the expanded response.

| Field | Merge behavior |
| --- | --- |
| `status` / `delay` | Rule values override base values. |
| `headers` | Shallow merge. Rule headers override base headers with the same name. |
| `body` | Shallow merge when both bodies are objects. Arrays, scalars, and `null` replace the entire body. Nested objects are replaced whole. |
| `removeBodyFields` | Removes the specified top-level fields after merging. The setting is omitted from the final response. |

Put only shared fields in `baseRule`. When status codes vary, prefer specifying them in each rule. If the base sets a status, override it in every exception. When body shapes differ substantially, put each body in its own rule and omit `baseRule.body`.

Omit unwanted fields from standalone bodies. Use `removeBodyFields` for unwanted inherited fields. Represent absence, `null`, empty strings, `0`, and empty arrays according to the actual API contract. A rule body such as `{ "error": "..." }` inherits user fields when the base body is a user object. Remove those fields or move the unshared bodies into their individual rules.

## Validate And Deliver

Run the offline checks for the loading mode in use.

- For named sources, call `resolveMockRuleSet` to check declared files, rule names, and conflicting overrides. Resolve directories relative to the execution working directory. Pass the full composition so selections with `replace: true` can resolve against their parents. `scenario resolve` checks scenario declarations and leaves endpoint JSON unread.
- For a single directory, use `normalizeMockEndpointConfig` to check each file and expanded response. `loadRules()` warns and skips invalid files, so use the normalizer for validation. The normalizer throws if a rule has no status after merging, which also causes named-source preparation to fail.

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

Replace the example sources and selections with the actual ones. The resolved result includes response bodies. Omit them when publishing audit metadata intended to exclude business data.

To validate one file from the Fliwright repository root, first run `pnpm --filter @fliwright/core build`, then use the following command.

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { normalizeMockEndpointConfig } from "./packages/fliwright-core/dist/index.js";
const cfg = JSON.parse(readFileSync(process.argv[1], "utf8"));
console.log(JSON.stringify(normalizeMockEndpointConfig(cfg).rules, null, 2));
' .fliwright/mocks/api/user-profile.example.json
```

In downstream projects, import from the installed `@fliwright/core`. If a runtime is unavailable, at least check JSON validity and confirm every expanded rule has a status. Report the checks still pending.

Verify that the final response matches the confirmed contract and target branch. Check HTTP status, business code, envelope, required fields, types, enums, missing versus `null` fields, pagination, and relationships across endpoints. Separately verify business behavior after checking schema validity and rule selection.

Report the file and rule names, business state, relevant source, documentation, or sample locations, and the fields that differ. Record the formatting and composition checks, contract checks, and live app results with any gaps. Put provenance in the reply or an existing `description` field. Rule-only requests end after rule authoring and applicable offline checks, without adding tests or running the app. For test requests, verify the actual HTTP requests and UI outcomes using the [verification and delivery guide](../write-fliwright-tests/references/scenario-design.md#验证与交付).

## Complete Example

This endpoint uses multiple rules to demonstrate `baseRule` inheritance, field overrides, field removal, and a status override.

```json
{
  "version": 1,
  "name": "User Profile",
  "description": "GET /api/v1/user/profile full, limited, and not-found responses",
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
    { "name": "success", "description": "Full profile with every field inherited from baseRule" },
    {
      "name": "partial",
      "description": "Omit the phone field and set the role to guest",
      "removeBodyFields": ["phone"],
      "body": { "role": "guest" }
    },
    {
      "name": "not_found",
      "description": "Return only the error envelope and omit all user fields",
      "status": 404,
      "removeBodyFields": ["id", "name", "email", "phone", "role"],
      "body": { "error": "not found" }
    }
  ]
}
```

After expansion, `success` returns the full body with HTTP 200. `partial` returns HTTP 200 with `role` set to `guest` and the phone omitted. `not_found` returns only `{ "error": "not found" }` with HTTP 404.
