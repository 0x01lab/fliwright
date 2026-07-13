import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';

let driver: FliwrightDriver;

describe('registration flow with mock API', () => {
  beforeAll(async () => {
    const vmServiceUrl = process.env.FLIWRIGHT_VM_URL;
    if (!vmServiceUrl) {
      throw new Error('Set FLIWRIGHT_VM_URL to the Flutter VM Service WebSocket URL.');
    }

    driver = new FliwrightDriver();
    await driver.connect(vmServiceUrl);
  });

  afterAll(async () => {
    await driver?.dispose();
  });

  it('fills the form and submits a mocked registration request', async () => {
    await driver.mock.clear();
    await driver.mock.clearCalls();
    await driver.mock.route('/api/register', {
      method: 'POST',
      status: 201,
      body: { id: 'user-1', displayName: 'Alice' },
    });

    const result = await driver.page.formHelper.fillFields(['Email', 'Password'], {
      skipObscureFields: false,
    });
    expect(result.filled).toBeGreaterThan(0);

    await driver.page.getByText('Create account').click();
    await driver.page.waitFor('text=Welcome, Alice', 5_000);

    const calls = await driver.mock.getCalls('/api/register');
    expect(calls.length).toBe(1);
  });
});
