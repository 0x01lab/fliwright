import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/index.js';

describe('generated CLI storage guidance', () => {
  it('routes native command readers to the bundled setup and capability workflow', async () => {
    const renderer = new URL('../../../scripts/cli-command-docs.mjs', import.meta.url).href;
    const { renderIndex } = await import(renderer);
    expect(renderIndex(createRegistry())).toContain('[native workflows](../native.md)');
  });
  it('keeps local run and cache defaults outside the project working tree', async () => {
    const renderer = new URL('../../../scripts/cli-command-docs.mjs', import.meta.url).href;
    const { commonGuide } = await import(renderer);

    expect(commonGuide).toContain('~/.fliwright/<project-path>');
    expect(commonGuide).toContain('<runtimeRoot>/runs');
    expect(commonGuide).toContain('<runtimeRoot>/cache');
    expect(commonGuide).not.toContain('<project>/.fliwright/runs');
    expect(commonGuide).not.toContain('<project>/.fliwright/cache');
  });
});
