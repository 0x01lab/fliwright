import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FlowReviewArtifactInput } from './FlowReviewReport.js';
import type { FlowReviewFigmaCaptureTask } from './FlowReviewBundle.js';

export interface FigmaRestScreenshotProviderOptions {
  accessToken?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  format?: 'png' | 'jpg' | 'svg' | 'pdf';
  scale?: number;
}

export interface FigmaScreenshotProvider {
  capture(task: FlowReviewFigmaCaptureTask): Promise<FlowReviewArtifactInput>;
}

export class FigmaRestScreenshotProvider implements FigmaScreenshotProvider {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly format: 'png' | 'jpg' | 'svg' | 'pdf';
  private readonly scale: number | undefined;

  constructor(options: FigmaRestScreenshotProviderOptions = {}) {
    this.accessToken = options.accessToken ?? process.env.FIGMA_ACCESS_TOKEN ?? process.env.FIGMA_TOKEN ?? '';
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? 'https://api.figma.com');
    this.fetchImpl = options.fetch ?? fetch;
    this.format = options.format ?? 'png';
    this.scale = options.scale;
  }

  async capture(task: FlowReviewFigmaCaptureTask): Promise<FlowReviewArtifactInput> {
    try {
      if (!this.accessToken) throw new Error('Missing Figma access token. Set FIGMA_ACCESS_TOKEN or pass accessToken.');
      const imageUrl = await this.resolveImageUrl(task);
      const image = await this.fetchImpl(imageUrl);
      if (!image.ok) {
        throw new Error(`Figma image download failed (${image.status} ${image.statusText})`);
      }
      await mkdir(dirname(task.screenshotPath), { recursive: true });
      await writeFile(task.screenshotPath, Buffer.from(await image.arrayBuffer()));
      return {
        flowNodeId: task.flowNodeId,
        screenshotPath: task.screenshotPath,
      };
    } catch (error) {
      return {
        flowNodeId: task.flowNodeId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveImageUrl(task: FlowReviewFigmaCaptureTask): Promise<string> {
    const url = new URL(`${this.baseUrl}/v1/images/${encodeURIComponent(task.fileKey)}`);
    url.searchParams.set('ids', task.nodeId);
    url.searchParams.set('format', this.format);
    if (this.scale != null) url.searchParams.set('scale', String(this.scale));

    const response = await this.fetchImpl(url, {
      headers: {
        'X-Figma-Token': this.accessToken,
      },
    });
    if (!response.ok) {
      throw new Error(`Figma image endpoint failed (${response.status} ${response.statusText})`);
    }
    const payload = await response.json() as {
      err?: string | null;
      images?: Record<string, string | null | undefined>;
    };
    if (payload.err) throw new Error(payload.err);
    const imageUrl = payload.images?.[task.nodeId];
    if (!imageUrl) throw new Error(`Figma did not return an image URL for node ${task.nodeId}.`);
    return imageUrl;
  }
}

export async function captureFigmaReviewScreenshots(
  tasks: FlowReviewFigmaCaptureTask[],
  provider: FigmaScreenshotProvider,
): Promise<FlowReviewArtifactInput[]> {
  const captures: FlowReviewArtifactInput[] = [];
  for (const task of tasks) captures.push(await provider.capture(task));
  return captures;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, '');
}
