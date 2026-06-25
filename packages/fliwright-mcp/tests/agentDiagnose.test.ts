import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockAiAdapter } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleAgentDiagnose } from '../src/tools/agentDiagnose.js';

describe('handleAgentDiagnose', () => {
  it('returns an error when no failure is available', async () => {
    const state = createServerState();

    await expect(handleAgentDiagnose({}, state, {
      adapter: new MockAiAdapter([]),
    })).resolves.toEqual({
      error: 'No agent-visible failure is available to diagnose.',
    });
  });

  it('diagnoses an explicit failure with configured AI', async () => {
    const state = createServerState();
    const artifactsDir = await mkdtemp(join(tmpdir(), 'fliwright-agent-ai-'));
    const result = await handleAgentDiagnose({
      failure: {
        code: 'assertion_failed',
        title: 'Next enabled',
        message: 'enabled=false',
      },
    }, state, {
      artifactsDir,
      adapter: new MockAiAdapter([{
        text: '{"summary":"disabled","rootCause":"validation","suggestedActions":["inspect form"],"confidence":0.7}',
        json: {
          summary: 'disabled',
          rootCause: 'validation',
          suggestedActions: ['inspect form'],
          confidence: 0.7,
        },
      }]),
    });

    expect(result.diagnosis).toMatchObject({
      summary: 'disabled',
      rootCause: 'validation',
      suggestedActions: ['inspect form'],
      confidence: 0.7,
    });
  });

  it('reads the latest timeline failure from server state', async () => {
    const path = await writeTimeline();
    const artifactsDir = await mkdtemp(join(tmpdir(), 'fliwright-agent-ai-'));
    const state = createServerState();
    state.setLastRunResult({
      passed: false,
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
      duration: 1,
      results: [],
      artifacts: {
        runId: 'run-1',
        outputDir: '/tmp/run-1',
        screenshots: [],
        timelines: [path],
      },
    });

    const result = await handleAgentDiagnose({}, state, {
      artifactsDir,
      adapter: new MockAiAdapter([{
        text: '{"summary":"missing button","rootCause":"wrong page","suggestedActions":["navigate"],"confidence":0.9}',
        json: {
          summary: 'missing button',
          rootCause: 'wrong page',
          suggestedActions: ['navigate'],
          confidence: 0.9,
        },
      }]),
    });

    expect(result.diagnosis?.rootCause).toBe('wrong page');
  });
});

async function writeTimeline(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fliwright-agent-diagnose-'));
  const path = join(dir, 'timeline.json');
  await writeFile(path, JSON.stringify({
    version: 1,
    runId: 'run-1',
    testName: 'timeline test',
    mode: 'test',
    status: 'failed',
    startedAt: '2026-06-18T00:00:00.000Z',
    nodes: [
      { id: 'assertion-1', kind: 'assertion', title: 'Next visible', status: 'failed', startedAt: 'x', endedAt: 'x' },
    ],
    agentVisibleFailures: [{
      code: 'assertion_failed',
      title: 'Next visible',
      message: 'visible=false',
      timelineNodeId: 'assertion-1',
      recoveryHints: [],
    }],
  }), 'utf8');
  return path;
}
