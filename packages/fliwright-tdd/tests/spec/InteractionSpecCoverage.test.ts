import { describe, expect, it } from 'vitest';
import { analyzeInteractionSpecCoverage } from '../../src/index.js';

describe('analyzeInteractionSpecCoverage', () => {
  it('reports complete coverage when required elements are referenced and asserted', () => {
    const report = analyzeInteractionSpecCoverage({
      elements: [
        { id: 'submit', role: 'button', name: 'Submit', text: 'Submit', importance: 'required' },
        { id: 'success', role: 'text', name: 'Success', text: 'Success', importance: 'required' },
      ],
      flows: [{
        id: 'submit-flow',
        name: 'submits form',
        steps: [{ action: 'tap', target: 'submit' }],
        expectedOutcome: [{ kind: 'visible', target: 'success' }],
      }],
    });

    expect(report).toMatchObject({
      status: 'complete',
      flowCount: 1,
      elementCount: 2,
      coveredElementIds: ['submit', 'success'],
      assertedElementIds: ['success'],
      gaps: [],
    });
  });

  it('reports gaps for flows without outcomes and unreferenced required elements', () => {
    const report = analyzeInteractionSpecCoverage({
      elements: [
        { id: 'save', role: 'button', name: 'Save', text: 'Save', importance: 'required' },
        { id: 'toast', role: 'text', name: 'Saved', text: 'Saved', importance: 'required' },
      ],
      flows: [{
        id: 'save-flow',
        name: 'save settings',
        steps: [{ action: 'tap', target: 'save' }],
      }],
    });

    expect(report.status).toBe('has-gaps');
    expect(report.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'missing-flow-outcome', flowId: 'save-flow' }),
      expect.objectContaining({ kind: 'unreferenced-required-element', elementId: 'toast' }),
      expect.objectContaining({ kind: 'unasserted-required-element', elementId: 'toast' }),
    ]));
  });
});
