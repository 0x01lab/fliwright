import { describe, expect, it } from 'vitest';
import { bestLocatorHint, synthesizeSelector } from '../../src/index.js';

describe('SelectorSynthesizer', () => {
  it('prefers stable key hints over text', () => {
    const result = synthesizeSelector({
      id: 'submit',
      role: 'button',
      name: 'Submit',
      text: 'Submit',
      locatorHints: [{ strategy: 'key', value: 'submitButton' }],
    }, [
      { key: 'submitButton', text: 'Submit', type: 'ElevatedButton' },
    ]);

    expect(result.status).toBe('resolved');
    expect(result.candidates[0].hint).toEqual({ strategy: 'key', value: 'submitButton' });
    expect(result.stabilityHints).toEqual([]);
  });

  it('marks text locators as ambiguous when multiple widgets match', () => {
    const result = synthesizeSelector({
      id: 'save',
      role: 'button',
      name: 'Save',
      text: 'Save',
    }, [
      { text: 'Save', type: 'TextButton' },
      { text: 'Save', type: 'ElevatedButton' },
    ]);

    expect(result.status).toBe('ambiguous');
    expect(result.stabilityHints.map((hint) => hint.kind)).toEqual(expect.arrayContaining(['add-key', 'refine-copy']));
  });

  it('returns hint-only diagnostics when no widget snapshot is provided', () => {
    const result = synthesizeSelector({
      id: 'email',
      role: 'textbox',
      name: 'Email',
      placeholder: 'Email',
    });

    expect(result.status).toBe('hint-only');
    expect(bestLocatorHint({
      id: 'email',
      role: 'textbox',
      name: 'Email',
      placeholder: 'Email',
    })).toEqual({ strategy: 'semantics', value: 'Email' });
  });

  it('promotes a stable key from a unique matching widget candidate', () => {
    const element = {
      id: 'save',
      role: 'button' as const,
      name: 'Save',
      text: 'Save',
    };

    const result = synthesizeSelector(element, [
      { role: 'button', text: 'Save', key: 'saveButton', type: 'ElevatedButton' },
    ]);

    expect(result.status).toBe('resolved');
    expect(result.candidates[0].hint).toEqual({ strategy: 'key', value: 'saveButton' });
    expect(bestLocatorHint(element, [
      { role: 'button', text: 'Save', key: 'saveButton', type: 'ElevatedButton' },
    ])).toEqual({ strategy: 'key', value: 'saveButton' });
    expect(result.stabilityHints).toEqual([]);
  });

  it('does not let a stale stable hint outrank a unique snapshot match', () => {
    const element = {
      id: 'save',
      role: 'button' as const,
      name: 'Save',
      text: 'Save',
      locatorHints: [{ strategy: 'key' as const, value: 'oldSaveButton' }],
    };

    const result = synthesizeSelector(element, [
      { role: 'button', text: 'Save', type: 'ElevatedButton' },
    ]);

    expect(result.status).toBe('resolved');
    expect(result.candidates[0].hint).toEqual({ strategy: 'text', value: 'Save' });
    expect(result.candidates.find((candidate) => candidate.hint.value === 'oldSaveButton')).toMatchObject({
      confidence: 0.1,
    });
    expect(result.stabilityHints).toEqual([expect.objectContaining({
      kind: 'stale-hint',
    })]);
  });
});
