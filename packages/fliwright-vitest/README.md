# @fliwright/vitest

Vitest fixtures for Fliwright Flutter E2E tests.

```ts
import { expect, test } from '@fliwright/vitest';

test('increments the counter', async ({ page }) => {
  await page.locator('text=Increment').click();
  await expect(page.locator('text=Count: 1')).toBeVisible();
});
```

Use `fliwright init` to create compatible configuration and a test-only Flutter
entrypoint. The current supported Vitest version is 5.0.5.

## Assert an HTTP response

Use the `assert` fixture to wait for an app request and check its response with
Vitest matchers. This example checks field presence, selected business values,
and the UI result for an order submission.

```ts
import { expect, test } from '@fliwright/vitest';
import { expect as viExpect } from 'vitest';

test('creates an order', async ({ page, driver, assert }) => {
  await driver.mock.clearFlutterCalls();
  await page.getByText('Submit order').click();

  await assert.response('Order API returned a created order', {
    request: { method: 'POST', path: '/api/orders' },
    verify: ({ status, body }) => {
      viExpect(status).toBe(201);
      viExpect(body).toHaveProperty('data.orderId');
      viExpect(body).toMatchObject({ code: 0 });
    },
  });

  await expect(page.getByText('Order placed'), 'Order confirmation is visible').toBeVisible();
});
```

`assert.response` waits for the latest matching call in the Flutter app history.
Clear the history or narrow the request matcher when the endpoint has earlier
calls. The default wait is five seconds. Pass `{ timeout: 10_000 }` as the third
argument to extend it. The verifier also receives HTTP error responses, so a
test can assert an expected 4xx or 5xx status and business payload.

A missing call, a response timeout, or a transport error fails the assertion.
When a matcher in `verify` throws, the assertion timeline records the error
and actual response. Await matchers that return a promise inside `verify`.

For Mock and passthrough Dio responses, install the Fliwright interceptor in
the app's test bootstrap. [Dio bridge setup](../fliwright-bridge/README.md#capture-dio-responses)
