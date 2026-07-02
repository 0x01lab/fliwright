import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleSourceMap } from '../src/tools/sourceMap.js';

describe('handleSourceMap', () => {
  it('throws when no driver is connected', async () => {
    await expect(handleSourceMap({}, createServerState())).rejects.toThrow(
      'fliwright_connect',
    );
  });

  it('reads source mapping from the connected driver', async () => {
    const state = createServerState();
    const sourceMap = vi.fn().mockResolvedValue({
      success: true,
      widgetCreationTracked: true,
      route: { location: '/home', name: 'home' },
      nodes: [
        {
          type: 'ElevatedButton',
          label: 'Submit',
          source: {
            file: 'package:exio_app/features/home/home_page.dart',
            line: 42,
            column: 10,
          },
        },
      ],
      candidateFiles: ['package:exio_app/features/home/home_page.dart'],
      fileCounts: { 'package:exio_app/features/home/home_page.dart': 1 },
      count: 1,
    });
    state.setDriver({
      page: { sourceMap },
    } as unknown as FliwrightDriver);

    const result = await handleSourceMap({
      includeFramework: false,
      includeRects: true,
      includeProperties: true,
      limit: 25,
    }, state);

    expect(sourceMap).toHaveBeenCalledWith({
      includeFramework: false,
      includeRects: true,
      includeProperties: true,
      limit: 25,
    });
    expect(result.candidateFiles).toEqual([
      'package:exio_app/features/home/home_page.dart',
    ]);
    expect(result.nodes[0].source?.line).toBe(42);
  });
});
