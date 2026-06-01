# API Mock Configuration

Mock endpoint files live in `.fliwright/mocks/api/*.json`.

Each file describes one endpoint and one or more named response rules. The minimal shape is:

```json
{
  "version": 1,
  "name": "Example API",
  "description": "Optional description",
  "method": "GET",
  "endpoint": "/api/example",
  "rules": [
    {
      "name": "success",
      "status": 200,
      "delay": 0,
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "success": true
      }
    }
  ]
}
```

Mapping to `MockManager`:

- `endpoint` becomes `driver.mock.route(endpoint, ...)`
- `method`, `status`, `headers`, `body`, and `delay` become the mock response
- `rules[].name` is a selectable scenario name in the VS Code extension
