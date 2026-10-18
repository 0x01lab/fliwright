import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactsFailuresCommand, artifactsTimelineCommand } from '../src/commands/artifact-query.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function run(attempts = ['a']) {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-query-')); roots.push(root);
  const dir = join(root, 'r'); await mkdir(dir);
  await writeFile(join(dir, 'run.json'), JSON.stringify({ tests: [{ testId: 't', attempts: attempts.map((id) => ({ attemptId: id, resultPath: `${id}/result.json` })) }] }));
  for (const id of attempts) {
    await mkdir(join(dir, id));
    await writeFile(join(dir, id, 'result.json'), JSON.stringify({ failureContextPath: 'failures.json' }));
    await writeFile(join(dir, id, 'failures.json'), JSON.stringify([{ testName: 'cart', attemptId: id, assertion: { actual: 'red' } }]));
    await writeFile(join(dir, id, 'timeline.json'), JSON.stringify({ version: 2, nodes: [{ id: 'step', artifacts: [{ path: 's.png' }] }] }));
  }
  return { root, dir, options: { runsRoot: root, runId: 'r' } };
}
it('reads attempt failure evidence offline without requiring a finalized report', async () => {
  const { options } = await run();
  expect(await artifactsFailuresCommand(options)).toMatchObject({ failures: [{ testName: 'cart', attemptId: 'a' }] });
});
it('requires an explicit attempt for ambiguous timelines and strips artifacts by default', async () => {
  const { options } = await run(['a', 'b']);
  await expect(artifactsTimelineCommand(options)).rejects.toThrow('Multiple timelines');
  expect(await artifactsTimelineCommand({ ...options, attemptId: 'b' })).toMatchObject({ timeline: { nodes: [{ id: 'step' }] } });
  const result = await artifactsTimelineCommand({ ...options, attemptId: 'b' });
  expect(result.timeline?.nodes[0]).not.toHaveProperty('artifacts');
});
it('rejects manifest timeline symlinks outside the owning run', async () => {
  const { root, dir, options } = await run();
  const outside = join(root, 'outside.json'); await writeFile(outside, '{"nodes":[]}');
  await rm(join(dir, 'a/timeline.json')); await symlink(outside, join(dir, 'a/timeline.json'));
  await expect(artifactsTimelineCommand(options)).rejects.toThrow('escapes');
});
