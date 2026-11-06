import { test, expect } from '@fliwright/vitest';

test.scenario('camera.empty')('previews and uploads the retaken fixture', async ({ page, cameraTest }) => {
  await cameraTest.enqueueResult({ kind: 'image', fixtureId: 'portrait' });
  await page.getByKey('camera_capture').click();
  await expect(page.getByKey('camera_preview')).toBeVisible();
  await expect(page.getByKey('camera_selected')).toHaveText('Selected: portrait');

  await cameraTest.enqueueResult({ kind: 'cancel' });
  await page.getByKey('camera_capture').click();
  await expect(page.getByKey('camera_status')).toHaveText('Capture cancelled');
  await expect(page.getByKey('camera_selected')).toHaveText('Selected: portrait');

  await cameraTest.enqueueResult({ kind: 'error', code: 'camera_unavailable', message: 'Try again' });
  await page.getByKey('camera_capture').click();
  await expect(page.getByKey('camera_status')).toHaveText('Try again');
  await expect(page.getByKey('camera_selected')).toHaveText('Selected: portrait');

  await cameraTest.enqueueResult({ kind: 'image', fixtureId: 'retake' });
  await page.getByKey('camera_capture').click();
  await expect(page.getByKey('camera_selected')).toHaveText('Selected: retake');
  await page.getByKey('camera_upload').click();
  await expect(page.getByKey('camera_status')).toHaveText('Uploaded: retake');
  await cameraTest.assertConsumed();
});
