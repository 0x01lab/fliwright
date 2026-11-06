import { test, expect } from '@fliwright/vitest';

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

// Run these independently with an externally reset microphone prompt baseline.
// English labels are verified on the dedicated en-US iOS Simulator recipe.
test.scenario('native.ready')('allows the system microphone prompt and returns to Flutter', async ({ page, native }) => {
  await page.getByKey('native_microphone').click();
  await native.getByText('Allow', { scope: 'system' }).click();
  await expect(page.getByKey('native_status')).toHaveText('Microphone: granted');
});

test.scenario('native.ready')('denies the system microphone prompt and returns to Flutter', async ({ page, native }) => {
  await page.getByKey('native_microphone').click();
  await native.getByText('Don’t Allow', { scope: 'system' }).click();
  await expect(page.getByKey('native_status')).toHaveText('Microphone: denied');
});
