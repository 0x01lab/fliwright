/**
 * Live Design QA smoke for Exio or another Flutter app that registered
 * FliwrightDesignQaExtension.
 *
 * Prerequisites:
 *   1. Start the app in debug/profile with FliwrightBridge and Design QA
 *      extensions registered.
 *   2. Copy the Flutter DDS or VM Service URL from `flutter run`.
 *   3. Run `test:design-qa:auto`; it follows DDS redirects and normalizes the
 *      URL before executing this test.
 *
 * Optional full pairing:
 *   FLIWRIGHT_DESIGN_QA_QR_PAYLOAD='{"version":2,...}' \
 *   pnpm --filter @fliwright/e2e-tests test:design-qa:auto -- --vm-url "..."
 *
 * Optional simulator/manual transport validation:
 *   FLIWRIGHT_DESIGN_QA_CAPTURE=1 ...
 *
 * The intended human QA interaction remains shake-to-capture. The manual
 * capture branch exists only to validate transport on simulators or CI devices
 * where accelerometer gestures are not available.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';

const vmServiceUrl = process.env.FLIWRIGHT_VM_SERVICE_URL ?? process.env.FLIWRIGHT_VM_URL;
const qrPayload = process.env.FLIWRIGHT_DESIGN_QA_QR_PAYLOAD;
const shouldCapture = process.env.FLIWRIGHT_DESIGN_QA_CAPTURE === '1';
const shouldOpenPairing = process.env.FLIWRIGHT_DESIGN_QA_OPEN_PAIRING === '1';

describe.skipIf(!vmServiceUrl)('Design QA live smoke', () => {
  let driver: FliwrightDriver;

  beforeAll(async () => {
    driver = new FliwrightDriver();
    await driver.connect(toWsUrl(vmServiceUrl!));
  });

  afterAll(async () => {
    await driver?.dispose();
  });

  it('exposes the Design QA VM-service extension', async () => {
    const status = await driver.designQa.status();

    expect(status.success).toBe(true);
    expect(status.designQa.state).toMatch(/^(idle|paired|listening|capturing|error|closed)$/);
  });

  it.skipIf(!shouldOpenPairing)('opens the in-app QR pairing scanner', async () => {
    const result = await driver.designQa.openPairing();

    expect(result.success).toBe(true);
  });

  it.skipIf(!qrPayload)('pairs from the Figma QR payload and starts shake listening', async () => {
    const diagnostics = await driver.designQa.diagnostics({ qrPayload });
    expect(diagnostics.success).toBe(true);
    expect(diagnostics.pairing?.roomId).toBeTruthy();
    expect(diagnostics.signaling?.host).toBeTruthy();

    const pairResult = await driver.designQa.pair(qrPayload!);
    expect(pairResult.success).toBe(true);
    expect(pairResult.designQa.state).toBe('listening');
    expect(pairResult.designQa.sessionId).toBeTruthy();

    const status = await driver.designQa.status();
    expect(status.designQa.state).toBe('listening');
  });

  it.skipIf(!qrPayload || !shouldCapture)('validates the manual capture transport path', async () => {
    const result = await driver.designQa.capture();

    expect(result.success).toBe(true);
    expect(result.result?.totalBytes).toBeGreaterThan(0);
    expect(result.result?.chunkCount).toBeGreaterThan(0);
    expect(result.designQa.lastCapture?.transferId).toBe(result.result?.transferId);
  });
});

function toWsUrl(url: string): string {
  const converted = url
    .replace('http://', 'ws://')
    .replace('https://', 'wss://');
  return converted.endsWith('/ws') ? converted : converted.replace(/\/?$/, '/ws');
}
