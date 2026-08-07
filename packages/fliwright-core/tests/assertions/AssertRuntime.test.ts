import { describe, expect, it, vi } from 'vitest';
import { MockRuntime } from '../../src/mocks/MockRuntime.js';
import { TimelineRecorder } from '../../src/timeline/TimelineRecorder.js';
import { AssertRuntime } from '../../src/assertions/AssertRuntime.js';
import type { Locator } from '../../src/Locator.js';
import type { MockManager } from '../../src/MockManager.js';
import type { Page } from '../../src/Page.js';
import type { TimelineArtifactStore } from '../../src/timeline/TimelineArtifactStore.js';

function recorder(): TimelineRecorder {
  return new TimelineRecorder({ runId: 'assertions', testName: 'assertions' });
}

function locator(overrides: Partial<Locator> = {}): Locator {
  return {
    selectorString: 'text=Save',
    isVisible: vi.fn().mockResolvedValue(true),
    resolve: vi.fn().mockResolvedValue({ properties: { enabled: true }, text: 'Saved' }),
    count: vi.fn().mockResolvedValue(1),
    ...overrides,
  } as unknown as Locator;
}

describe('AssertRuntime', () => {
  it('records deterministic locator assertions as timeline nodes', async () => {
    const timeline = recorder();
    const runtime = new AssertRuntime({ recorder: timeline });

    await runtime.visible('Save is visible', locator());
    await runtime.text('Save label', locator(), 'Saved');
    await runtime.count('One save control', locator(), 1);

    const nodes = timeline.toJSON().nodes;
    expect(nodes.map((node) => node.kind)).toEqual(['assertion', 'assertion', 'assertion']);
    expect(nodes.every((node) => node.status === 'passed')).toBe(true);
    expect(nodes[0]?.metadata).toMatchObject({ matcher: 'visible', target: 'text=Save' });
  });

  it('throws an agent-visible failure and records a failed assertion', async () => {
    const timeline = recorder();
    const runtime = new AssertRuntime({ recorder: timeline });
    const target = locator({ isVisible: vi.fn().mockResolvedValue(false) });

    await expect(runtime.visible('Missing save control', target, { timeout: 0 })).rejects.toMatchObject({
      failure: expect.objectContaining({ code: 'assertion_failed', title: 'Missing save control' }),
    });
    expect(timeline.toJSON().nodes[0]).toMatchObject({
      kind: 'assertion',
      status: 'failed',
      metadata: expect.objectContaining({ matcher: 'visible', target: 'text=Save', actual: 'visible=false' }),
      error: expect.objectContaining({
        code: 'assertion_failed',
        actionContext: { action: 'visible', target: 'text=Save' },
      }),
    });
  });

  it('captures screenshot and snapshot artifacts when an assertion fails', async () => {
    const timeline = recorder();
    const page = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('image')),
      snapshot: vi.fn().mockResolvedValue({ widgets: [] }),
    } as unknown as Page;
    const artifactStore = {
      writeScreenshot: vi.fn().mockResolvedValue({ kind: 'screenshot', path: 'artifacts/screenshots/assertion-1.png' }),
      writeSnapshot: vi.fn().mockResolvedValue({ kind: 'snapshot', path: 'artifacts/snapshots/assertion-1.json' }),
    } as unknown as TimelineArtifactStore;
    const runtime = new AssertRuntime({ recorder: timeline, page, artifactStore });

    await expect(runtime.visible('Missing save control', locator({ isVisible: vi.fn().mockResolvedValue(false) }), { timeout: 0 }))
      .rejects.toMatchObject({ failure: expect.objectContaining({
        appState: {
          screenshotPath: 'artifacts/screenshots/assertion-1.png',
          snapshotPath: 'artifacts/snapshots/assertion-1.json',
        },
      }) });

    expect(timeline.toJSON().nodes[0]?.artifacts).toEqual([
      { kind: 'screenshot', path: 'artifacts/screenshots/assertion-1.png' },
      { kind: 'snapshot', path: 'artifacts/snapshots/assertion-1.json' },
    ]);
  });

  it('honors disabled failure evidence for locator assertions', async () => {
    const timeline = recorder();
    const page = {
      screenshot: vi.fn(),
      snapshot: vi.fn(),
    } as unknown as Page;
    const artifactStore = {
      writeScreenshot: vi.fn().mockResolvedValue({ kind: 'screenshot', path: 'artifacts/screenshots/assertion-1.png' }),
      writeSnapshot: vi.fn().mockResolvedValue({ kind: 'snapshot', path: 'artifacts/snapshots/assertion-1.json' }),
    } as unknown as TimelineArtifactStore;
    const runtime = new AssertRuntime({ recorder: timeline, page, artifactStore });

    await expect(runtime.visible(
      'Missing save control',
      locator({ isVisible: vi.fn().mockResolvedValue(false) }),
      { timeout: 0, includeScreenshot: false, includeSnapshot: false },
    )).rejects.toMatchObject({ failure: expect.objectContaining({ code: 'assertion_failed' }) });

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(page.snapshot).not.toHaveBeenCalled();
    expect(artifactStore.writeScreenshot).not.toHaveBeenCalled();
    expect(artifactStore.writeSnapshot).not.toHaveBeenCalled();
    expect(timeline.toJSON().nodes[0]?.artifacts).toBeUndefined();
  });

  it('supports request, noRequest, and requestCount through MockRuntime', async () => {
    const timeline = recorder();
    const manager = {
      getCalls: vi.fn().mockResolvedValue([
        { method: 'POST', path: '/api/register', body: { ok: true }, timestamp: 'now' },
        { method: 'POST', path: '/api/register', body: { ok: true }, timestamp: 'later' },
      ]),
    } as unknown as MockManager;
    const mock = new MockRuntime(manager, timeline);
    const runtime = new AssertRuntime({ recorder: timeline, mock });

    await runtime.request('Register called', { path: '/api/register', method: 'POST' });
    await runtime.requestCount('Register called twice', { path: '/api/register' }, 2);
    await runtime.noRequest('No logout call', { path: '/api/logout' });

    expect(timeline.toJSON().nodes.filter((node) => node.kind === 'assertion')).toHaveLength(3);
  });
});
