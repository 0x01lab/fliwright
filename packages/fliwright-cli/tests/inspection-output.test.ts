import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { inspectionOutput } from '../src/InspectionOutput.js';

it('uses the configured cache for unique captures while preserving explicit output files', async () => {
  const project = await mkdtemp(join(tmpdir(), 'inspection-storage-'));
  try {
    await writeFile(join(project, 'fliwright.config.ts'), "export default { cacheRoot: 'scratch', runsRoot: 'history' };");
    const first = await inspectionOutput({ cwd: project }, 'screenshot');
    const second = await inspectionOutput({ cwd: project }, 'screenshot');
    expect(first).toContain(join(project, 'scratch/inspect/'));
    expect(first).toMatch(/screenshot\.png$/);
    expect(first).not.toBe(second);
    expect(await inspectionOutput({ cwd: project, output: 'saved.png' }, 'screenshot')).toBe(join(project, 'saved.png'));
  } finally { await rm(project, { recursive: true, force: true }); }
});
