import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { AiRuntime, MockAiAdapter, type FliwrightFlowDocument } from '@fliwright/core';
import { createProgram } from '../src/index.js';
import {
  flowAgentSpecCommand,
  flowBindFigmaCommand,
  flowCleanCommand,
  flowGenerateTestCommand,
  flowListCommand,
  flowReviewCaptureFigmaCommand,
  flowReviewBundleCommand,
  flowReviewReportCommand,
  flowValidateCommand,
} from '../src/commands/flow.js';

describe('flow commands', () => {
  it('lists editable flow files under .fliwright/flows', async () => {
    const root = await makeWorkspace();
    await writeFlow(root, sampleFlow({ id: 'checkout', updatedAt: '2026-01-02T00:00:00.000Z' }));
    await writeFlow(root, sampleFlow({ id: 'login', updatedAt: '2026-01-03T00:00:00.000Z' }));
    await writeFile(join(root, '.fliwright', 'flows', 'broken.flow.json'), '{', 'utf8');

    const result = await flowListCommand({ cwd: root });

    expect(result.flows.map((flow) => flow.id)).toEqual(['login', 'checkout']);
    expect(result.flows[0]).toMatchObject({
      id: 'login',
      nodeCount: 2,
      edgeCount: 1,
    });
  });

  it('binds a flow node to a Figma URL', async () => {
    const root = await makeWorkspace();
    await writeFlow(root, sampleFlow({
      id: 'checkout',
      nodes: [
        { id: 'note-1', type: 'note', title: 'Pay screen' },
      ],
      edges: [],
    }));

    const result = await flowBindFigmaCommand({
      cwd: root,
      id: 'checkout',
      flowNodeId: 'note-1',
      figmaUrl: 'https://www.figma.com/design/FILE123/App?node-id=120-340',
      componentName: 'PayScreen',
    });

    expect(result.node).toMatchObject({
      id: 'note-1',
      type: 'note',
      figma: {
        fileKey: 'FILE123',
        nodeId: '120:340',
        componentName: 'PayScreen',
      },
    });
    const persisted = JSON.parse(await readFile(result.path, 'utf8')) as FliwrightFlowDocument;
    expect(persisted.nodes[0].figma?.nodeId).toBe('120:340');
  });

  it('builds an AI-agent-ready spec with Figma MCP requests', async () => {
    const root = await makeWorkspace();
    await writeFlow(root, sampleFlow({
      id: 'checkout',
      nodes: [
        {
          id: 'screen-1',
          type: 'screen',
          title: 'Checkout',
          route: '/checkout',
          figma: {
            fileKey: 'FILE123',
            nodeId: '120:340',
            componentName: 'CheckoutScreen',
          },
        },
      ],
      edges: [],
    }));

    const result = await flowAgentSpecCommand({ cwd: root, id: 'checkout' });

    expect(result.spec.summary).toMatchObject({
      nodeCount: 1,
      figmaBoundCount: 1,
      routeCount: 1,
      codeTargetCount: 1,
    });
    expect(result.spec.figmaMcpRequests).toEqual([
      {
        flowNodeId: 'screen-1',
        title: 'Checkout',
        tool: 'get_design_context',
        fileKey: 'FILE123',
        nodeId: '120:340',
      },
    ]);
  });

  it('cleans noisy flow nodes with an AI keep-list', async () => {
    const root = await makeWorkspace();
    await writeFlow(root, sampleFlow({
      id: 'checkout',
      nodes: [
        { id: 'screen-1', type: 'screen', title: 'Checkout', route: '/checkout' },
        { id: 'tap-noise', type: 'action', title: 'Duplicate tap', selector: 'text=Pay' },
        { id: 'pay-action', type: 'action', title: 'Tap Pay', selector: 'text=Pay' },
      ],
      edges: [
        { id: 'e1', source: 'screen-1', target: 'tap-noise' },
        { id: 'e2', source: 'tap-noise', target: 'pay-action' },
      ],
    }));
    const aiRuntime = new AiRuntime({
      provider: 'mock',
      adapter: new MockAiAdapter([{
        text: JSON.stringify({ version: 1, keptNodeIds: ['screen-1', 'pay-action'], summary: 'Removed duplicate tap.' }),
        json: { version: 1, keptNodeIds: ['screen-1', 'pay-action'], summary: 'Removed duplicate tap.' },
      }]),
    });

    const result = await flowCleanCommand({
      cwd: root,
      id: 'checkout',
      aiRuntime,
    });

    expect(result.plan.removedNodeIds).toEqual(['tap-noise']);
    expect(result.flow.nodes.map((node) => node.id)).toEqual(['screen-1', 'pay-action']);
    const persisted = JSON.parse(await readFile(result.path, 'utf8')) as FliwrightFlowDocument;
    expect(persisted.nodes.map((node) => node.id)).toEqual(['screen-1', 'pay-action']);
    expect(persisted.metadata).toEqual(expect.objectContaining({
      cleanedBy: 'ai',
      removedNodeCount: 1,
    }));
  });

  it('validates graph and Figma review completeness', async () => {
    const root = await makeWorkspace();
    await writeFlow(root, sampleFlow({
      id: 'invalid',
      nodes: [
        {
          id: 'screen-1',
          type: 'figma',
          title: 'Missing node id',
          figma: {
            fileKey: 'FILE123',
            nodeId: '',
          },
        },
      ],
      edges: [
        { id: 'edge-1', source: 'screen-1', target: 'missing' },
      ],
    }));

    const result = await flowValidateCommand({
      cwd: root,
      id: 'invalid',
      requireReviewRuntimeEntryForFigmaNodes: true,
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.issues.map((issue) => issue.code)).toEqual([
      'edge_target_missing',
      'figma_node_id_missing',
    ]);
  });

  it('generates a Fliwright/Vitest skeleton from a flow', async () => {
    const root = await makeWorkspace();
    const outputFile = join(root, 'tests', 'checkout.generated.test.ts');
    await writeFlow(root, sampleFlow({ id: 'checkout' }));

    const result = await flowGenerateTestCommand({
      cwd: root,
      id: 'checkout',
      testName: 'checkout happy path',
      outputFile,
      resetToHomeBeforeEach: true,
      homeRoute: '/home',
    });

    expect(result.outputFile).toBe(outputFile);
    expect(result.code).toContain("test('checkout happy path'");
    expect(result.code).toContain("await page.resetToHome({ homeRoute: '/home' });");
    expect(result.code).toContain("await page.locator('text=Pay').click();");
    expect(await readFile(outputFile, 'utf8')).toContain("flow.step('Tap Pay'");
  });

  it('builds a UI review bundle for Figma MCP capture and Fliwright report generation', async () => {
    const root = await makeWorkspace();
    const outputDir = join(root, '.fliwright', 'reviews', 'checkout-bundle');
    await writeFlow(root, sampleFlow({
      id: 'checkout',
      nodes: [
        {
          id: 'screen-1',
          type: 'screen',
          title: 'Checkout',
          route: '/checkout',
          figma: {
            fileKey: 'FILE123',
            nodeId: '120:340',
          },
        },
      ],
      edges: [],
    }));

    const result = await flowReviewBundleCommand({
      cwd: root,
      id: 'checkout',
      outputDir,
    });

    expect(result.outputPath).toBe(join(outputDir, 'checkout-review-bundle.json'));
    expect(result.bundle.figmaMcp.tasks).toEqual([
      expect.objectContaining({
        flowNodeId: 'screen-1',
        fileKey: 'FILE123',
        nodeId: '120:340',
        screenshotPath: join(outputDir, 'figma', '001-screen-1.png'),
      }),
    ]);
    expect(result.bundle.fliwrightMcp.report.args).toEqual(expect.objectContaining({
      outputPath: join(outputDir, 'checkout-report.json'),
      runtimeCaptures: join(outputDir, 'runtime', 'runtime-captures.json'),
      figmaCaptures: join(outputDir, 'figma', 'figma-captures.json'),
    }));
    expect(await readFile(result.outputPath, 'utf8')).toContain('"figmaMcp"');
  });

  it('captures Figma screenshots through a provider and writes figma-captures.json', async () => {
    const root = await makeWorkspace();
    const outputDir = join(root, '.fliwright', 'reviews', 'checkout', 'figma');
    await writeFlow(root, sampleFlow({
      id: 'checkout',
      nodes: [
        {
          id: 'screen-1',
          type: 'screen',
          title: 'Checkout',
          route: '/checkout',
          figma: {
            fileKey: 'FILE123',
            nodeId: '120:340',
          },
        },
      ],
      edges: [],
    }));
    const figmaProvider = {
      capture: vi.fn(async (task) => ({
        flowNodeId: task.flowNodeId,
        screenshotPath: task.screenshotPath,
      })),
    };

    const result = await flowReviewCaptureFigmaCommand({
      cwd: root,
      id: 'checkout',
      outputDir,
      figmaProvider,
    });

    expect(figmaProvider.capture).toHaveBeenCalledWith(expect.objectContaining({
      flowNodeId: 'screen-1',
      fileKey: 'FILE123',
      nodeId: '120:340',
      screenshotPath: join(outputDir, '001-screen-1.png'),
    }));
    expect(result.captures).toEqual([
      { flowNodeId: 'screen-1', screenshotPath: join(outputDir, '001-screen-1.png') },
    ]);
    expect(JSON.parse(await readFile(result.capturesFile, 'utf8'))).toEqual(result.captures);
  });

  it('builds a UI review report with automatic PNG diff', async () => {
    const root = await makeWorkspace();
    const runtimePath = join(root, 'runtime.png');
    const figmaPath = join(root, 'figma.png');
    const outputPath = join(root, '.fliwright', 'reviews', 'checkout-report.json');
    await writeFlow(root, sampleFlow({
      id: 'checkout',
      nodes: [
        {
          id: 'screen-1',
          type: 'screen',
          title: 'Checkout',
          route: '/checkout',
          figma: {
            fileKey: 'FILE123',
            nodeId: '120:340',
          },
        },
      ],
      edges: [],
    }));
    await writeFile(runtimePath, pngRgba(2, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]));
    await writeFile(figmaPath, pngRgba(2, 1, [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]));

    const result = await flowReviewReportCommand({
      cwd: root,
      id: 'checkout',
      outputPath,
      runtimeCaptures: [{ flowNodeId: 'screen-1', screenshotPath: runtimePath }],
      figmaCaptures: [{ flowNodeId: 'screen-1', screenshotPath: figmaPath }],
    });

    expect(result.reportPath).toBe(outputPath);
    expect(result.report.summary).toEqual({
      total: 1,
      passed: 0,
      failed: 1,
      missing: 0,
      pending: 0,
    });
    expect(result.report.items[0].comparison).toEqual(expect.objectContaining({
      pixelDiff: 0.5,
      layoutPx: 0,
    }));
    expect(await readFile(outputPath, 'utf8')).toContain('"pixelDiff": 0.5');
  });

  it('returns a failing exit code for JSON UI review reports with failed items', async () => {
    const root = await makeWorkspace();
    const runtimePath = join(root, 'runtime.png');
    const figmaPath = join(root, 'figma.png');
    await writeFlow(root, sampleFlow({
      id: 'checkout',
      nodes: [
        {
          id: 'screen-1',
          type: 'screen',
          title: 'Checkout',
          route: '/checkout',
          figma: {
            fileKey: 'FILE123',
            nodeId: '120:340',
          },
        },
      ],
      edges: [],
    }));
    await writeFile(runtimePath, pngRgba(1, 1, [[255, 0, 0, 255]]));
    await writeFile(figmaPath, pngRgba(1, 1, [[0, 0, 255, 255]]));

    const previousExitCode = process.exitCode;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.exitCode = 0;

    try {
      const program = createProgram();
      await program.parseAsync([
        'flow',
        'review-report',
        'checkout',
        '--cwd',
        root,
        '--runtime-capture',
        `screen-1=${runtimePath}`,
        '--figma-capture',
        `screen-1=${figmaPath}`,
        '--json',
      ], { from: 'user' });

      expect(process.exitCode).toBe(1);
      const printed = JSON.parse(log.mock.calls[0]?.[0] as string);
      expect(printed.report.summary).toEqual(expect.objectContaining({
        failed: 1,
        missing: 0,
      }));
    } finally {
      process.exitCode = previousExitCode;
      log.mockRestore();
    }
  });
});

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-flow-'));
  await mkdir(join(root, '.fliwright', 'flows'), { recursive: true });
  return root;
}

async function writeFlow(root: string, flow: FliwrightFlowDocument): Promise<void> {
  await writeFile(join(root, '.fliwright', 'flows', `${flow.id}.flow.json`), `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
}

function sampleFlow(overrides: Partial<FliwrightFlowDocument> = {}): FliwrightFlowDocument {
  return {
    version: 1,
    id: 'checkout',
    title: 'Checkout',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: {
      kind: 'recording',
      testName: 'Checkout',
    },
    nodes: [
      {
        id: 'screen-1',
        type: 'screen',
        title: 'Checkout screen',
        route: '/checkout',
      },
      {
        id: 'action-1',
        type: 'action',
        title: 'Tap Pay',
        selector: 'text=Pay',
        operation: {
          kind: 'tap',
          position: { x: 120, y: 240 },
          timestamp: 1000,
          status: 'included',
        },
      },
    ],
    edges: [
      { id: 'edge-1', source: 'screen-1', target: 'action-1' },
    ],
    ...overrides,
  };
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
