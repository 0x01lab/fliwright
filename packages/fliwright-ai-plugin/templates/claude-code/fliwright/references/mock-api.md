# Mock API Endpoint Schema

## File Locations

- Endpoint configs: `.fliwright/mocks/api/<name>.json`
- Index file: `.fliwright/mocks/mock-index.json`
- Naming: use kebab-case matching the endpoint, e.g. `/v1/public/token` → `get-token.json`

## MockEndpointConfig

Each file is a single JSON object:

```typescript
interface MockEndpointConfig {
  version: 1;                          // Always 1
  name: string;                        // Human-readable name, e.g. "Get Token List"
  description?: string;                // Optional description
  method: string;                      // GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS
  endpoint: string;                    // Must start with "/", e.g. "/v1/public/token"
  rules: MockRule[];                   // At least 2 rules recommended
}
```

### MockRule

```typescript
interface MockRule {
  name: string;                        // Rule identifier, e.g. "success", "empty", "server_error"
  status: number;                      // HTTP status code (100-599)
  delay?: number;                      // Response delay in milliseconds
  headers?: Record<string, string>;    // Response headers (include Content-Type)
  body?: unknown;                      // Response body (any JSON value)
}
```

### Validation Rules

- `version` must be `1`
- `method` must be a valid HTTP method (uppercase)
- `endpoint` must start with `/`
- `status` must be a number in 100-599 range
- Always include `Content-Type: application/json` in headers
- `rules` array must not be empty
- Each rule `name` must be unique within the file

## MockIndex

```typescript
interface MockIndex {
  version: 1;                          // Always 1
  defaultRule: string;                 // Default rule name for all endpoints, e.g. "success"
  files: string[];                     // Relative paths to endpoint config files
}
```

### Example

`.fliwright/mocks/mock-index.json`:
```json
{
  "version": 1,
  "defaultRule": "success",
  "files": [
    "api/get-token.json",
    "api/create-order.json"
  ]
}
```

## Rule Generation Strategy

When generating mock endpoint files, follow these rules:

### Required rules (always generate)
- `success` — status 200, realistic response body
- `server_error` — status 500, error body

### Context-dependent rules
| Endpoint type | Additional rules |
|---------------|-----------------|
| List endpoint (`GET /api/items`) | `empty` — status 200, empty array in data |
| Single resource (`GET /api/items/:id`) | `not_found` — status 404 |
| Create (`POST /api/items`) | `bad_request` — status 400, `conflict` — status 409 |
| Auth-related (`/login`, `/auth`) | `unauthorized` — status 401, `forbidden` — status 403 |
| Update (`PUT/PATCH /api/items/:id`) | `bad_request` — status 400, `not_found` — status 404 |

## Body Inference Patterns

Use endpoint path patterns to infer realistic response shapes:

| Pattern | Response shape |
|---------|---------------|
| `GET /api/{resources}` (list) | `{ "success": true, "data": { "rows": [...], "total": N }, "timestamp": ... }` |
| `GET /api/{resources}/:id` (detail) | `{ "success": true, "data": { ...single object... }, "timestamp": ... }` |
| `POST /api/{resources}` (create) | `{ "success": true, "data": { "id": "...", ... }, "timestamp": ... }` |
| `POST /api/auth/login` | `{ "success": true, "data": { "token": "...", "user": {...} }, "timestamp": ... }` |
| Error responses | `{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." }, "timestamp": ... }` |

Generate realistic field names and sample values based on the endpoint name and domain context. For example, a `/v1/public/token` endpoint should have fields like `token`, `decimals`, `is_collateral`, etc.

## Mock-Index Update Protocol

When creating a new endpoint file, always update `mock-index.json`:

1. **Read** the existing `mock-index.json` (or create a new one if missing)
2. **Add** the new file path to `files[]` (relative to `.fliwright/mocks/`)
3. **Deduplicate** — remove duplicate entries in `files[]`
4. **Validate** — ensure `defaultRule` exists as a rule name in all endpoint files
5. **Write** the updated file

If `mock-index.json` doesn't exist, create it with:
```json
{
  "version": 1,
  "defaultRule": "success",
  "files": ["api/<filename>.json"]
}
```

## Full Example

`.fliwright/mocks/api/get-token.json`:
```json
{
  "version": 1,
  "name": "Get Token List",
  "description": "List all supported tokens with chain details",
  "method": "GET",
  "endpoint": "/v1/public/token",
  "rules": [
    {
      "name": "success",
      "status": 200,
      "delay": 0,
      "headers": { "Content-Type": "application/json" },
      "body": {
        "success": true,
        "data": {
          "rows": [
            { "token": "ETH", "decimals": 8, "is_collateral": true },
            { "token": "USDT", "decimals": 6, "is_collateral": true }
          ]
        },
        "timestamp": 1768892322920
      }
    },
    {
      "name": "empty",
      "status": 200,
      "delay": 0,
      "headers": { "Content-Type": "application/json" },
      "body": {
        "success": true,
        "data": { "rows": [] },
        "timestamp": 1768892322920
      }
    },
    {
      "name": "server_error",
      "status": 500,
      "delay": 0,
      "headers": { "Content-Type": "application/json" },
      "body": {
        "success": false,
        "error": { "code": "TOKEN_SERVICE_UNAVAILABLE", "message": "Token service unavailable" },
        "timestamp": 1768892322920
      }
    }
  ]
}
```
