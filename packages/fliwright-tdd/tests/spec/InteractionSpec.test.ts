import { describe, expect, it } from 'vitest';
import {
  generateRedFirstTest,
  InteractionSpecValidationError,
  parseInteractionSpec,
  validateInteractionSpec,
} from '../../src/index.js';

describe('InteractionSpec validation', () => {
  it('parses a valid spec and normalizes optional collections', () => {
    const spec = parseInteractionSpec({
      app: { platform: 'flutter', route: '/checkout' },
      elements: [{
        id: 'pay',
        role: 'button',
        name: 'Pay now',
        text: 'Pay now',
        locatorHints: [{ strategy: 'key', value: 'payButton' }],
      }],
      flows: [{
        id: 'pay-flow',
        name: 'customer pays',
        steps: [{ action: 'tap', target: 'pay' }],
      }],
    });

    expect(spec.app?.route).toBe('/checkout');
    expect(spec.elements[0].locatorHints?.[0]).toEqual({ strategy: 'key', value: 'payButton' });
    expect(spec.flows[0].steps).toEqual([{ action: 'tap', target: 'pay' }]);
  });

  it('reports path-level issues for invalid references and duplicate elements', () => {
    const result = validateInteractionSpec({
      elements: [
        { id: 'save', role: 'button', name: 'Save' },
        { id: 'save', role: 'not-a-role', name: 'Save again' },
      ],
      flows: [{
        id: 'save-flow',
        name: 'saves',
        steps: [{ action: 'tap', target: 'missing' }],
      }],
      assertions: [{ kind: 'visible', target: 'missing' }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '$.elements[1].id' }),
        expect.objectContaining({ path: '$.elements[1].role' }),
        expect.objectContaining({ path: '$.flows[0].steps[0].target' }),
        expect.objectContaining({ path: '$.assertions[0].target' }),
      ]));
    }
  });

  it('makes the red-first generator fail with the shared validation error', () => {
    expect(() => generateRedFirstTest({
      elements: [{ id: 'save', role: 'button', name: 'Save' }],
      flows: [{ id: 'bad-flow', name: 'bad', steps: [{ action: 'tap', target: 'missing' }] }],
    })).toThrow(InteractionSpecValidationError);
  });
});
