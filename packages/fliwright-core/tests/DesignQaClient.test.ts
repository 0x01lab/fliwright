import { describe, expect, it } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import { createProtocolMock } from './helpers/mockVMService.js';

describe('DesignQaClient', () => {
  it('reads Design QA status through the VM-service extension', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.designQa.status', (params) => {
      expect(params.isolateId).toBe(protocol.isolateId);
      return {
        success: true,
        designQa: { state: 'idle' },
      };
    });
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    await expect(driver.designQa.status()).resolves.toEqual({
      success: true,
      error: undefined,
      designQa: {
        state: 'idle',
        sessionId: undefined,
        lastCapture: undefined,
        error: undefined,
      },
    });
  });

  it('passes QR payloads to diagnostics and pair without leaking transformed input', async () => {
    const protocol = createProtocolMock();
    const qrPayload = '{"version":2,"roomId":"room-1"}';
    protocol.mockExtension('ext.fliwright.designQa.diagnostics', (params) => {
      expect(params.qrPayload).toBe(qrPayload);
      return {
        success: true,
        pairing: {
          version: 2,
          signalingUrl: 'https://example.test/signaling',
          roomId: 'room-1',
          iceConfigId: 'team-default',
        },
        signaling: {
          host: 'example.test',
          path: '/signaling',
          secure: true,
          key: 'peerjs',
        },
        designQa: { state: 'idle' },
      };
    });
    protocol.mockExtension('ext.fliwright.designQa.pair', (params) => {
      expect(params.qrPayload).toBe(qrPayload);
      return {
        success: true,
        pairing: {
          version: 2,
          signalingUrl: 'https://example.test/signaling',
          roomId: 'room-1',
          iceConfigId: 'team-default',
        },
        designQa: {
          state: 'paired',
          sessionId: 'mobile-session',
        },
      };
    });
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    const diagnostics = await driver.designQa.diagnostics({ qrPayload });
    const paired = await driver.designQa.pair(qrPayload);

    expect(diagnostics.pairing?.roomId).toBe('room-1');
    expect(diagnostics.signaling?.secure).toBe(true);
    expect(paired.designQa.state).toBe('paired');
    expect(paired.designQa.sessionId).toBe('mobile-session');
  });

  it('starts shake capture and reports manual capture results', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.designQa.startShake', () => ({
      success: true,
      designQa: {
        state: 'listening',
        sessionId: 'mobile-session',
      },
    }));
    protocol.mockExtension('ext.fliwright.designQa.capture', () => ({
      success: true,
      result: {
        sessionId: 'mobile-session',
        transferId: 'transfer-1',
        totalBytes: 1234,
        chunkCount: 2,
        sha256: 'abc123',
      },
      designQa: {
        state: 'listening',
        sessionId: 'mobile-session',
        lastCapture: {
          sessionId: 'mobile-session',
          transferId: 'transfer-1',
          totalBytes: 1234,
          chunkCount: 2,
          sha256: 'abc123',
        },
      },
    }));
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    await expect(driver.designQa.startShake()).resolves.toMatchObject({
      success: true,
      designQa: { state: 'listening' },
    });
    await expect(driver.designQa.capture()).resolves.toMatchObject({
      success: true,
      result: {
        transferId: 'transfer-1',
        totalBytes: 1234,
      },
      designQa: {
        lastCapture: {
          transferId: 'transfer-1',
          chunkCount: 2,
        },
      },
    });
  });

  it('opens the in-app QR pairing page through the VM-service extension', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.designQa.openPairing', () => ({
      success: true,
      designQa: { state: 'idle' },
    }));
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    await expect(driver.designQa.openPairing()).resolves.toMatchObject({
      success: true,
      designQa: { state: 'idle' },
    });
  });

  it('throws command failures returned by the Design QA extension', async () => {
    const protocol = createProtocolMock();
    protocol.mockExtension('ext.fliwright.designQa.startShake', () => ({
      success: false,
      error: 'Design QA is not paired or enabled.',
      designQa: { state: 'idle' },
    }));
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(protocol.ws);

    await expect(driver.designQa.startShake()).rejects.toThrow(
      'Design QA is not paired or enabled.',
    );
  });
});
