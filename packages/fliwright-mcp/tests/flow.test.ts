import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { AiRuntime, MockAiAdapter } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleFlowAgentSpec, handleFlowBindFigma, handleFlowClean, handleFlowGenerateTest, handleFlowGet, handleFlowList, handleFlowReviewBundle, handleFlowReviewCaptureFigma, handleFlowReviewCaptureRuntime, handleFlowReviewPlan, handleFlowReviewReport, handleFlowReviewRun, handleFlowValidate } from '../src/tools/flow.js';

describe('flow tools', () => {
  it('returns an empty list when no project flows exist', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-flow-empty-'));

    await expect(handleFlowList({ cwd })).resolves.toEqual({ flows: [] });
  });

  it('lists and reads project flow files', async () => {
    const { cwd, flowsDir, flowPath } = await writeProjectFlow();
    await writeFile(join(flowsDir, 'broken.flow.json'), '{', 'utf8');

    const list = await handleFlowList({ cwd });
    expect(list.flows).toEqual([
      expect.objectContaining({
        id: 'checkout',
        title: 'Checkout',
        nodeCount: 1,
        edgeCount: 0,
      }),
    ]);

    const result = await handleFlowGet({ cwd, id: 'checkout' });
    expect(result.flow).toEqual(expect.objectContaining({
      id: 'checkout',
      nodes: [expect.objectContaining({ id: 'note-1' })],
    }));
    expect(result.path).toBe(flowPath);
  });

  it('binds a flow node to a Figma URL', async () => {
    const { cwd, flowPath } = await writeProjectFlow();

    const result = await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
      name: 'Checkout pending',
      codeConnectId: 'checkout-pending',
      componentName: 'CheckoutPendingView',
    });

    expect(result.path).toBe(flowPath);
    expect(result.node).toEqual(expect.objectContaining({
      id: 'note-1',
      type: 'note',
      figma: {
        fileKey: 'ABC123',
        nodeId: '120:340',
        url: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
        name: 'Checkout pending',
        codeConnectId: 'checkout-pending',
        componentName: 'CheckoutPendingView',
      },
    }));

    const reread = await handleFlowGet({ path: flowPath });
    expect(reread.flow?.nodes[0].figma?.nodeId).toBe('120:340');
  });

  it('builds an agent-ready spec from a project flow', async () => {
    const { cwd } = await writeProjectFlow();
    await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
    });

    const result = await handleFlowAgentSpec({ cwd, id: 'checkout' });

    expect(result.spec?.summary).toEqual(expect.objectContaining({
      nodeCount: 1,
      figmaBoundCount: 1,
      codeTargetCount: 0,
    }));
    expect(result.spec?.figmaBindings[0]).toEqual(expect.objectContaining({
      flowNodeId: 'note-1',
      fileKey: 'ABC123',
      nodeId: '120:340',
    }));
    expect(result.spec?.figmaMcpRequests).toEqual([
      expect.objectContaining({
        flowNodeId: 'note-1',
        tool: 'get_design_context',
        fileKey: 'ABC123',
        nodeId: '120:340',
      }),
    ]);
    expect(result.spec?.missing.codeTargets).toEqual([
      {
        flowNodeId: 'note-1',
        title: 'Review',
        reason: 'missing componentName or codeConnectId',
      },
    ]);
  });

  it('cleans noisy project flow nodes through AI', async () => {
    const { cwd, flowPath } = await writeProjectFlow();
    await writeFile(flowPath, JSON.stringify({
      version: 1,
      id: 'checkout',
      title: 'Checkout',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T01:00:00.000Z',
      source: { kind: 'recording', testName: 'checkout test' },
      nodes: [
        { id: 'screen-1', type: 'screen', title: 'Checkout', route: '/checkout' },
        { id: 'tap-noise', type: 'action', title: 'Duplicate tap', selector: 'text=Pay' },
        { id: 'pay-action', type: 'action', title: 'Tap Pay', selector: 'text=Pay' },
      ],
      edges: [
        { id: 'e1', source: 'screen-1', target: 'tap-noise' },
        { id: 'e2', source: 'tap-noise', target: 'pay-action' },
      ],
    }), 'utf8');
    const aiRuntime = new AiRuntime({
      provider: 'mock',
      adapter: new MockAiAdapter([{
        text: JSON.stringify({ version: 1, keptNodeIds: ['screen-1', 'pay-action'], summary: 'Removed duplicate tap.' }),
        json: { version: 1, keptNodeIds: ['screen-1', 'pay-action'], summary: 'Removed duplicate tap.' },
      }]),
    });

    const result = await handleFlowClean({ cwd, id: 'checkout' }, aiRuntime);

    expect(result.plan?.removedNodeIds).toEqual(['tap-noise']);
    expect(result.flow?.nodes.map((node) => node.id)).toEqual(['screen-1', 'pay-action']);
    const persisted = JSON.parse(await readFile(flowPath, 'utf8'));
    expect(persisted.nodes.map((node: { id: string }) => node.id)).toEqual(['screen-1', 'pay-action']);
  });

  it('builds a UI review plan from a project flow', async () => {
    const { cwd } = await writeProjectFlow();
    await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
    });

    const result = await handleFlowReviewPlan({
      cwd,
      id: 'checkout',
      pixelDiffTolerance: 0.05,
      layoutPxTolerance: 6,
    });

    expect(result.reviewPlan?.targets).toEqual([
      expect.objectContaining({
        flowNodeId: 'note-1',
        route: '/checkout',
        selector: 'text=Pay',
        figma: expect.objectContaining({
          fileKey: 'ABC123',
          nodeId: '120:340',
        }),
        tolerance: {
          pixelDiff: 0.05,
          layoutPx: 6,
        },
      }),
    ]);
  });

  it('builds and saves a UI review bundle for Figma MCP and runtime review', async () => {
    const { cwd, flowPath } = await writeProjectFlow();
    await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
    });
    const outputDir = join(cwd, '.fliwright', 'reviews', 'checkout-bundle');

    const result = await handleFlowReviewBundle({
      cwd,
      id: 'checkout',
      outputDir,
    });

    expect(result.outputPath).toBe(join(outputDir, 'checkout-review-bundle.json'));
    expect(result.bundle?.figmaMcp.tasks).toEqual([
      expect.objectContaining({
        flowNodeId: 'note-1',
        fileKey: 'ABC123',
        nodeId: '120:340',
        screenshotPath: join(outputDir, 'figma', '001-note-1.png'),
        mcpTool: 'figma.get_screenshot',
      }),
    ]);
    expect(result.bundle?.fliwrightMcp.runtimeCapture.args).toEqual({
      path: flowPath,
      outputDir: join(outputDir, 'runtime'),
      targetIds: ['note-1'],
    });
    const written = JSON.parse(await readFile(result.outputPath!, 'utf8'));
    expect(written.fliwrightMcp.report.args).toEqual(expect.objectContaining({
      path: flowPath,
      outputPath: join(outputDir, 'checkout-report.json'),
      runtimeCaptures: join(outputDir, 'runtime', 'runtime-captures.json'),
      figmaCaptures: join(outputDir, 'figma', 'figma-captures.json'),
    }));
  });

  it('captures Figma screenshots through a provider and writes captures JSON', async () => {
    const { cwd } = await writeProjectFlow();
    await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
    });
    const outputDir = join(cwd, '.fliwright', 'reviews', 'checkout', 'figma');
    const figmaProvider = {
      capture: vi.fn(async (task) => ({
        flowNodeId: task.flowNodeId,
        screenshotPath: task.screenshotPath,
      })),
    };

    const result = await handleFlowReviewCaptureFigma({
      cwd,
      id: 'checkout',
      outputDir,
    }, figmaProvider);

    expect(figmaProvider.capture).toHaveBeenCalledWith(expect.objectContaining({
      flowNodeId: 'note-1',
      fileKey: 'ABC123',
      nodeId: '120:340',
      screenshotPath: join(outputDir, '001-note-1.png'),
    }));
    expect(result.captures).toEqual([
      { flowNodeId: 'note-1', screenshotPath: join(outputDir, '001-note-1.png') },
    ]);
    expect(JSON.parse(await readFile(result.capturesFile!, 'utf8'))).toEqual(result.captures);
  });

  it('captures runtime screenshots for review targets', async () => {
    const { cwd } = await writeProjectFlow();
    await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
    });
    const state = createServerState();
    const goto = vi.fn(async () => undefined);
    const screenshot = vi.fn(async () => Buffer.from('runtime-png'));
    state.setDriver({ page: { goto, screenshot } } as any);

    const result = await handleFlowReviewCaptureRuntime({ cwd, id: 'checkout', pixelRatio: 2 }, state);

    expect(goto).toHaveBeenCalledWith('/checkout');
    expect(screenshot).toHaveBeenCalledWith({ pixelRatio: 2 });
    expect(result.captures).toEqual([
      expect.objectContaining({
        flowNodeId: 'note-1',
        route: '/checkout',
        status: 'passed',
        screenshotPath: expect.stringMatching(/001-note-1\.png$/),
      }),
    ]);
    await expect(readFile(result.captures![0].screenshotPath!, 'utf8')).resolves.toBe('runtime-png');
    expect(JSON.parse(await readFile(result.capturesFile!, 'utf8'))[0]).toEqual(expect.objectContaining({
      flowNodeId: 'note-1',
      screenshotPath: result.captures![0].screenshotPath,
    }));
  });

  it('runs the full deterministic UI review pipeline', async () => {
    const { cwd } = await writeProjectFlow();
    await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
    });
    const outputDir = join(cwd, '.fliwright', 'reviews', 'checkout-run');
    const state = createServerState();
    const goto = vi.fn(async () => undefined);
    const screenshot = vi.fn(async () => pngRgba(1, 1, [[255, 0, 0, 255]]));
    state.setDriver({ page: { goto, screenshot } } as any);
    const figmaProvider = {
      capture: vi.fn(async (task) => {
        await mkdir(dirname(task.screenshotPath), { recursive: true });
        await writeFile(task.screenshotPath, pngRgba(1, 1, [[255, 0, 0, 255]]));
        return {
          flowNodeId: task.flowNodeId,
          screenshotPath: task.screenshotPath,
        };
      }),
    };

    const result = await handleFlowReviewRun({
      cwd,
      id: 'checkout',
      outputDir,
    }, state, figmaProvider);

    expect(goto).toHaveBeenCalledWith('/checkout');
    expect(figmaProvider.capture).toHaveBeenCalledWith(expect.objectContaining({
      flowNodeId: 'note-1',
      fileKey: 'ABC123',
      nodeId: '120:340',
      screenshotPath: join(outputDir, 'figma', '001-note-1.png'),
    }));
    expect(result.bundlePath).toBe(join(outputDir, 'checkout-review-bundle.json'));
    expect(result.runtimeCapturesFile).toBe(join(outputDir, 'runtime', 'runtime-captures.json'));
    expect(result.figmaCapturesFile).toBe(join(outputDir, 'figma', 'figma-captures.json'));
    expect(result.reportPath).toBe(join(outputDir, 'checkout-report.json'));
    expect(result.report?.summary).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      missing: 0,
      pending: 0,
    });
    await expect(readFile(result.bundlePath!, 'utf8')).resolves.toContain('"figmaMcp"');
    await expect(readFile(result.reportPath!, 'utf8')).resolves.toContain('"passed": 1');
  });

  it('requires a connected driver before runtime capture', async () => {
    const { cwd } = await writeProjectFlow();
    const state = createServerState();

    await expect(handleFlowReviewCaptureRuntime({ cwd, id: 'checkout' }, state))
      .rejects.toThrow('Not connected. Call fliwright_connect first.');
  });

  it('builds and saves a UI review report', async () => {
    const { cwd } = await writeProjectFlow();
    await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
    });

    const result = await handleFlowReviewReport({
      cwd,
      id: 'checkout',
      runtimeCaptures: [{ flowNodeId: 'note-1', screenshotPath: 'runtime/note-1.png' }],
      figmaCaptures: [{ flowNodeId: 'note-1', screenshotPath: 'figma/note-1.png' }],
      comparisons: [{ flowNodeId: 'note-1', pixelDiff: 0.08, layoutPx: 2 }],
    });

    expect(result.reportPath).toMatch(/\.fliwright\/reviews\/checkout-report\.json$/);
    expect(result.report?.summary).toEqual({
      total: 1,
      passed: 0,
      failed: 1,
      missing: 0,
      pending: 0,
    });
    expect(result.report?.items[0].issues).toEqual([
      'pixel diff 0.08 exceeds tolerance 0.03',
    ]);
    const written = JSON.parse(await readFile(result.reportPath!, 'utf8'));
    expect(written.items[0].runtimeScreenshotPath).toBe('runtime/note-1.png');
  });

  it('auto-compares runtime and Figma PNG screenshots in review reports', async () => {
    const { cwd } = await writeProjectFlow();
    await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
    });
    const runtimePath = join(cwd, 'runtime.png');
    const figmaPath = join(cwd, 'figma.png');
    await writeFile(runtimePath, pngRgba(2, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]));
    await writeFile(figmaPath, pngRgba(2, 1, [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]));

    const result = await handleFlowReviewReport({
      cwd,
      id: 'checkout',
      runtimeCaptures: [{ flowNodeId: 'note-1', screenshotPath: runtimePath }],
      figmaCaptures: [{ flowNodeId: 'note-1', screenshotPath: figmaPath }],
    });

    expect(result.report?.items[0].comparison).toEqual(expect.objectContaining({
      flowNodeId: 'note-1',
      pixelDiff: 0.5,
      layoutPx: 0,
    }));
    expect(result.report?.items[0].issues).toEqual([
      'pixel diff 0.5 exceeds tolerance 0.03',
    ]);
  });

  it('generates a Fliwright test skeleton from a project flow', async () => {
    const { cwd } = await writeProjectFlow();
    const outputFile = join(cwd, 'tests', 'checkout-flow.test.ts');

    const result = await handleFlowGenerateTest({
      cwd,
      id: 'checkout',
      outputFile,
      resetToHomeBeforeEach: true,
    });

    expect(result.outputFile).toBe(outputFile);
    expect(result.code).toContain("test('Checkout', async ({ page, flow }) => {");
    expect(result.code).toContain("await page.goto('/checkout');");
    expect(result.code).toContain("await expect(page.locator('text=Pay')).toBeVisible();");
    await expect(readFile(outputFile, 'utf8')).resolves.toContain("import { test, expect, beforeEach } from '@fliwright/vitest';");
  });

  it('validates project flows', async () => {
    const { cwd } = await writeProjectFlow();
    await handleFlowBindFigma({
      cwd,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/ABC123/File?node-id=120-340',
    });

    const result = await handleFlowValidate({
      cwd,
      id: 'checkout',
      requireCodeTargetForFigmaNodes: true,
      requireReviewRuntimeEntryForFigmaNodes: true,
    });

    expect(result.validation).toEqual(expect.objectContaining({
      valid: true,
      errorCount: 0,
      warningCount: 1,
    }));
    expect(result.validation?.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'code_target_missing',
        nodeId: 'note-1',
      }),
    ]);
  });
});

async function writeProjectFlow(): Promise<{ cwd: string; flowsDir: string; flowPath: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'fliwright-flow-'));
  const flowsDir = join(cwd, '.fliwright', 'flows');
  const flowPath = join(flowsDir, 'checkout.flow.json');
  await mkdir(flowsDir, { recursive: true });
  await writeFile(flowPath, JSON.stringify({
    version: 1,
    id: 'checkout',
    title: 'Checkout',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T01:00:00.000Z',
    source: { kind: 'recording', testName: 'checkout test' },
    nodes: [{ id: 'note-1', type: 'note', title: 'Review', notes: 'Check copy', route: '/checkout', selector: 'text=Pay' }],
    edges: [],
  }), 'utf8');
  return { cwd, flowsDir, flowPath };
}

type Rgba = [number, number, number, number];

function pngRgba(width: number, height: number, pixels: Rgba[]): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = pixels[y * width + x];
      raw[offset++] = pixel[0];
      raw[offset++] = pixel[1];
      raw[offset++] = pixel[2];
      raw[offset++] = pixel[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const output = Buffer.alloc(8 + data.length + 4);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, 'ascii');
  data.copy(output, 8);
  return output;
}
