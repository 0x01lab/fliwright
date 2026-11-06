import { test, expect } from '@fliwright/vitest';

// Readable UIKit UITextField, en-US iOS Simulator. These cases do not certify
// secure fields, text views, localized edit menus, or Unicode keyboard input.
test.scenario('native.input')('replaces existing native text and returns the exact value to Flutter', async ({ page, native }) => {
  await page.getByKey('native_input').click();
  await native.getById('native_text_input').fill('Replacement with spaces');
  await native.getById('native_text_input').fill("Second 'value' & 42");
  await native.getByText('Confirm input').click();
  await expect(page.getByKey('native_status')).toHaveText('Input: confirmed');
  await expect(page.getByKey('native_input_value')).toHaveText("Second 'value' & 42");
});

test.scenario('native.input')('clears existing native text and returns an empty value to Flutter', async ({ page, native }) => {
  await page.getByKey('native_input').click();
  await native.getById('native_text_input').fill('');
  await native.getByText('Confirm input').click();
  await expect(page.getByKey('native_status')).toHaveText('Input: confirmed');
  await expect(page.getByKey('native_input_value')).toHaveText('');
});

test.scenario('native.input')('cancels native input without publishing the edited value', async ({ page, native }) => {
  await page.getByKey('native_input').click();
  await native.getById('native_text_input').fill('Discard this value');
  await native.getByText('Cancel input').click();
  await expect(page.getByKey('native_status')).toHaveText('Input: cancelled');
  await expect(page.getByKey('native_input_value')).toHaveText('');
});
