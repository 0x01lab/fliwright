import { describe, expect, it } from 'vitest';
import { prepareRedFirstWorkflow } from '../../src/workflow/RedFirstWorkflow.js';

describe('prepareRedFirstWorkflow', () => {
  it('returns a ready-to-run workflow when selectors are resolved and a test file is known', () => {
    const result = prepareRedFirstWorkflow({
      elements: [{
        id: 'submit',
        role: 'button',
        name: 'Submit',
        text: 'Submit',
        locatorHints: [{ strategy: 'key', value: 'submitButton' }],
      }],
      flows: [{
        id: 'submit-flow',
        name: 'submits form',
        steps: [{ action: 'tap', target: 'submit' }],
        expectedOutcome: [{ kind: 'route', equals: '/done' }],
      }],
    }, {
      testFile: '/tmp/generated.test.ts',
      widgets: [{ key: 'submitButton', text: 'Submit', role: 'button' }],
    });

    expect(result.workflow.status).toBe('ready-to-run');
    expect(result.workflow.context).toMatchObject({
      testName: 'submits form',
      flowId: 'submit-flow',
      testFile: '/tmp/generated.test.ts',
    });
    expect(result.workflow).not.toHaveProperty('nextActions');
  });

  it('asks for an output file before runtime focus when no test file is available', () => {
    const result = prepareRedFirstWorkflow({
      elements: [{ id: 'submit', role: 'button', name: 'Submit', text: 'Submit' }],
      flows: [{
        id: 'submit-flow',
        name: 'submits form',
        steps: [{ action: 'tap', target: 'submit' }],
        expectedOutcome: [{ kind: 'route', equals: '/done' }],
      }],
    }, {
      widgets: [{ text: 'Submit', role: 'button' }],
    });

    expect(result.workflow.status).toBe('needs-output-file');
    expect(result.workflow).not.toHaveProperty('nextActions');
  });

  it('surfaces coverage review when selectors are resolved but the spec has no outcome', () => {
    const result = prepareRedFirstWorkflow({
      elements: [{ id: 'submit', role: 'button', name: 'Submit', text: 'Submit' }],
      flows: [{ id: 'submit-flow', name: 'submits form', steps: [{ action: 'tap', target: 'submit' }] }],
    }, {
      testFile: '/tmp/generated.test.ts',
      widgets: [{ text: 'Submit', role: 'button' }],
    });

    expect(result.workflow.status).toBe('needs-coverage-review');
    expect(result.workflow.coverage.gaps).toEqual([expect.objectContaining({
      kind: 'missing-flow-outcome',
      flowId: 'submit-flow',
    })]);
  });

  it('surfaces selector review before marking the workflow ready when selectors are ambiguous', () => {
    const result = prepareRedFirstWorkflow({
      elements: [{ id: 'save', role: 'button', name: 'Save', text: 'Save' }],
      flows: [{ id: 'save-flow', name: 'saves', steps: [{ action: 'tap', target: 'save' }] }],
    }, {
      testFile: '/tmp/save.test.ts',
      widgets: [
        { text: 'Save', type: 'TextButton', role: 'button' },
        { text: 'Save', type: 'ElevatedButton', role: 'button' },
      ],
    });

    expect(result.workflow.status).toBe('needs-selector-review');
    expect(result.workflow).not.toHaveProperty('nextActions');
  });
});
