import { describe, expect, it } from 'vitest';
import {
  buildSmokeEnvironment,
  parseArguments,
  resolveDesignQaVmServiceUrl,
} from './scripts/run-design-qa-smoke.mjs';

describe('Design QA smoke runner', () => {
  it('uses a raw VM Service WebSocket URL without probing it', async () => {
    const url = await resolveDesignQaVmServiceUrl('ws://127.0.0.1:54321/token=/ws', {
      fetchImpl: () => {
        throw new Error('WebSocket URLs must not be queried over HTTP.');
      },
    });

    expect(url).toBe('ws://127.0.0.1:54321/token=/ws');
  });

  it('follows the DDS redirect and normalizes the actual VM Service endpoint', async () => {
    const requested: string[] = [];
    const url = await resolveDesignQaVmServiceUrl('http://127.0.0.1:50261/KOVvlIYlSOg=/', {
      fetchImpl: async (input: URL) => {
        requested.push(String(input));
        return requested.length === 1
          ? new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1:50267/GiPdfYI5mXc=/' },
          })
          : new Response(null, { status: 404 });
      },
    });

    expect(requested).toEqual([
      'http://127.0.0.1:50261/KOVvlIYlSOg=/ws',
      'http://127.0.0.1:50267/GiPdfYI5mXc=/ws',
    ]);
    expect(url).toBe('ws://127.0.0.1:50267/GiPdfYI5mXc=/ws');
  });

  it('resolves a relative DDS redirect', async () => {
    const url = await resolveDesignQaVmServiceUrl('http://127.0.0.1:50261/dds=/', {
      fetchImpl: (() => {
        let requestCount = 0;
        return async () => {
          requestCount += 1;
          return requestCount === 1
            ? new Response(null, {
              status: 302,
              headers: { location: '/vm=/' },
            })
            : new Response(null, { status: 404 });
        };
      })(),
    });

    expect(url).toBe('ws://127.0.0.1:50261/vm=/ws');
  });

  it('accepts pairing-page, capture, and explicit VM URL command options', () => {
    expect(parseArguments([
      '--',
      '--vm-url',
      'http://127.0.0.1:1234/token=/',
      '--open-pairing',
      '--capture',
    ])).toEqual({
      vmUrl: 'http://127.0.0.1:1234/token=/',
      capture: true,
      openPairing: true,
    });
  });

  it('passes the normalized URL and requested Design QA options to the smoke test', () => {
    const environment = buildSmokeEnvironment(
      { FLIWRIGHT_DESIGN_QA_QR_PAYLOAD: '{"secret":"not-logged"}' },
      'ws://127.0.0.1:54321/token=/ws',
      true,
      true,
    );

    expect(environment.FLIWRIGHT_VM_SERVICE_URL).toBe('ws://127.0.0.1:54321/token=/ws');
    expect(environment.FLIWRIGHT_VM_URL).toBe('ws://127.0.0.1:54321/token=/ws');
    expect(environment.FLIWRIGHT_DESIGN_QA_CAPTURE).toBe('1');
    expect(environment.FLIWRIGHT_DESIGN_QA_OPEN_PAIRING).toBe('1');
    expect(environment.FLIWRIGHT_DESIGN_QA_QR_PAYLOAD).toBe('{"secret":"not-logged"}');
  });
});
