# API Response Assertions

**Date:** 2026-11-25
**Status:** Implemented
**Scope:** fliwright-core, fliwright-bridge, fliwright-vitest

## Contract

Test scripts can assert the HTTP response observed by a request made from the
Flutter app:

```ts
import { test } from '@fliwright/vitest';
import { expect } from 'vitest';

test('creates an order', async ({ page, assert }) => {
  await page.getByText('Submit order').click();

  await assert.response('Order API succeeded', {
    request: { method: 'POST', path: '/api/orders' },
    verify: ({ status, body }) => {
      expect(status).toBe(201);
      expect(body).toMatchObject({ code: 0 });
      expect(body).toHaveProperty('data.orderId');
    },
  });
});
```

The request matcher uses the existing method, URL/path, headers, and request
body fields. The verifier receives the HTTP status and response body, including
HTTP error responses such as 400 or 500. It can use Vitest's `expect` matchers, including
`toMatchObject`, `toHaveProperty`, `toContain`, and `toBeDefined`.

The assertion selects the latest matching call and waits for it to complete,
using the existing assertion timeout and interval options. A missing request or
a transport error fails the assertion before the verifier runs. A matcher that
throws in the verifier fails the assertion. Failure metadata includes the actual
status, response body, or transport error.

## Data Flow

Dio records a pending call in `FliwrightDioMockInterceptor.onRequest`, then
completes it in `onResponse` or `onError`. The existing
`ext.fliwright.mock.getCalls` VM Service extension serializes those records.
Core reads them through `MockManager` and `MockRuntime`, where `AssertRuntime`
matches the response. A delayed Dio mock remains pending until the interceptor
delivers its response.

Every Dio instance under test must include a Fliwright Dio interceptor. The
HTTP proxy does not observe Dio traffic. UI assertions remain separate and
verify what the app displays after handling the response.
