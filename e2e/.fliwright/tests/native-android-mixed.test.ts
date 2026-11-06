import { test, expect } from '@fliwright/vitest';
import { expect as assert } from 'vitest';

// Actual Android business acceptance remains pending a runnable dedicated device.
// Confirm these resource IDs against native snapshot for the selected OS recipe.
const permissionAppId = process.env.FLIWRIGHT_NATIVE_PERMISSION_APP_ID;
if (!permissionAppId) throw new Error('Set FLIWRIGHT_NATIVE_PERMISSION_APP_ID from the selected device permission dialog.');

test.scenario('native.ready')('returns a real native confirmation to Flutter', async ({ page, native }) => {
  await page.getByKey('native_confirm').click();
  await native.getByText('Confirm native').click();
  await expect(page.getByKey('native_status')).toHaveText('Native: confirmed');
});

test.scenario('native.ready')('returns a real native cancellation to Flutter', async ({ page, native }) => {
  await page.getByKey('native_confirm').click();
  await native.getByText('Cancel native').click();
  await expect(page.getByKey('native_status')).toHaveText('Native: cancelled');
});

for (const permission of ['camera', 'microphone'] as const) {
  // Run each permission case independently with an externally prepared prompt baseline.
  for (const decision of ['allow', 'deny'] as const) {
    test.scenario('native.ready')(`${decision === 'allow' ? 'allows' : 'denies'} the system ${permission} prompt and returns to Flutter`, async ({ page, native, driver }) => {
      await page.getByKey(`native_${permission}`).click();
      const button = decision === 'allow' ? 'permission_allow_foreground_only_button' : 'permission_deny_button';
      await native.getById(`${permissionAppId}:id/${button}`, { scope: 'system' }).click();
      const state = decision === 'allow' ? 'granted' : 'denied';
      await expect(page.getByKey('native_status')).toHaveText(`${permission === 'camera' ? 'Camera' : 'Microphone'}: ${state}`);
      const observed = await driver.app.invoke<undefined, Record<string, { granted: boolean; rationale: boolean }>>('nativeDemo', 'readPermissions');
      assert(observed[permission].granted).toBe(decision === 'allow');
    });
  }
}
