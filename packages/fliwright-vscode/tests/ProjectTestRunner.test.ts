import { beforeEach, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { ProjectTestRunner } from '../src/runner/ProjectTestRunner.js';

const mocks = vi.hoisted(() => ({ cli: vi.fn(), vitest: vi.fn() }));
vi.mock('@fliwright/cli/run', () => ({ runCommand: mocks.cli }));
vi.mock('../src/runner/VitestRunner.js', () => ({ VitestRunner: class { run = mocks.vitest; } }));

beforeEach(() => vi.clearAllMocks());

it('honors changes to the runner setting and keeps CLI run identity and cancellation', async () => {
  let selected: 'vitest' | 'cli' = 'vitest';
  const runner = new ProjectTestRunner(() => selected);
  const signal = new AbortController().signal;
  const params = { workspaceRoot: Uri.file('/project'), testFile: Uri.file('/project/.fliwright/tests/form.test.ts'),
    failureContextDir: Uri.file('/project/.fliwright/failures'), runsRoot: '/runs', vmServiceUrl: 'ws://unused',
    testNamePattern: 'save form', signal };
  mocks.vitest.mockResolvedValue({ passed: true });
  await runner.run(params);
  expect(mocks.vitest).toHaveBeenCalledWith(params);
  expect(mocks.cli).not.toHaveBeenCalled();
  selected = 'cli';
  mocks.cli.mockResolvedValue({ passed: true, totalTests: 1, passedTests: 1, failedTests: 0, duration: 2,
    results: [{ name: 'save form', passed: true, duration: 2 }], artifacts: { runId: 'canonical-run' } });
  expect(await runner.run(params)).toMatchObject({ passed: true, runId: 'canonical-run', passedTests: 1 });
  expect(mocks.cli).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/project',
    testPattern: '/project/.fliwright/tests/form.test.ts', testName: 'save form', signal, runsRoot: '/runs', print: false }));
});

it('makes a CLI collection error visible when zero test bodies ran', async () => {
  mocks.cli.mockResolvedValue({ passed: false, totalTests: 0, passedTests: 0, failedTests: 0, duration: 1,
    results: [], runnerErrors: [{ phase: 'collection', message: 'scenario missing' }] });
  const result = await new ProjectTestRunner(() => 'cli').run({ workspaceRoot: Uri.file('/project'),
    failureContextDir: Uri.file('/project/failures') });
  expect(result).toMatchObject({ passed: false, failedTests: 1 });
  expect(result.results[0]).toMatchObject({ passed: false, error: expect.stringContaining('scenario missing') });
});
