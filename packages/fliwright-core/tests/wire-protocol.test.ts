/**
 * Wire Protocol Contract Tests
 *
 * Validates that every Selector type produces JSON output conforming
 * to the wire protocol schema. These tests serve as the TS-side
 * contract guarantee — if they pass, the Dart side should be able
 * to parse the output correctly.
 *
 * The generated JSON Schema file can be used by Dart tests for
 * cross-language validation.
 */

import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Selector } from '../src/Selector.js';
import {
  selectorQuerySchema,
  matchCriteriaSchema,
  filterCriteriaSchema,
  fallbackCriteriaSchema,
  positionFilterSchema,
  parseSelectorJson,
} from '../src/wire-protocol.js';

/** Helper: get parsed JSON from a Selector's wire output */
function wire(selector: Selector) {
  return parseSelectorJson(selector.toWireParams().selector as string);
}

/** Helper: validate raw JSON against schema */
function validate(selector: Selector) {
  const json = selector.toWireParams().selector as string;
  return parseSelectorJson(json);
}

// ── Generate JSON Schema file for Dart-side reference ──────────────

describe('wire protocol JSON Schema export', () => {
  it('exports valid JSON Schema for all protocol types', () => {
    // Export each sub-schema individually (zodToJsonSchema handles non-lazy schemas well)
    const matchCriteriaJson = zodToJsonSchema(matchCriteriaSchema, { target: 'draft7' });
    const filterCriteriaJson = zodToJsonSchema(filterCriteriaSchema, { target: 'draft7' });
    const fallbackCriteriaJson = zodToJsonSchema(fallbackCriteriaSchema, { target: 'draft7' });
    const positionFilterJson = zodToJsonSchema(positionFilterSchema, { target: 'draft7' });

    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Fliwright Wire Protocol',
      description: 'JSON contract between fliwright-core (TS) and fliwright-bridge (Dart). Auto-generated from Zod schemas.',
      definitions: {
        MatchCriteria: matchCriteriaJson,
        FilterCriteria: filterCriteriaJson,
        FallbackCriteria: fallbackCriteriaJson,
        PositionFilter: positionFilterJson,
      },
    };

    // Validate the schema itself is serializable and has real content
    const jsonStr = JSON.stringify(schema, null, 2);
    expect(jsonStr.length).toBeGreaterThan(500);
    expect(jsonStr).toContain('type');
    expect(jsonStr).toContain('key');
    expect(jsonStr).toContain('enabled');

    // Write to shared location for Dart-side reference
    const outPath = resolve(__dirname, '../../fliwright-bridge/test/fixtures/wire-protocol-schema.json');
    writeFileSync(outPath, jsonStr, 'utf-8');
  });
});

// ── Basic selectors ────────────────────────────────────────────────

describe('wire protocol: basic selectors', () => {
  it('text selector', () => {
    expect(validate(new Selector({ text: 'Login' }))).toEqual({ match: { text: 'Login' } });
  });

  it('key selector', () => {
    expect(validate(new Selector({ key: 'submit_btn' }))).toEqual({ match: { key: 'submit_btn' } });
  });

  it('type selector', () => {
    expect(validate(new Selector({ type: 'ElevatedButton' }))).toEqual({ match: { type: 'ElevatedButton' } });
  });

  it('subtype selector', () => {
    expect(validate(new Selector({ subtype: 'Widget' }))).toEqual({ match: { subtype: 'Widget' } });
  });

  it('id selector', () => {
    expect(validate(new Selector({ id: 'w-123' }))).toEqual({ match: { id: 'w-123' } });
  });

  it('name selector', () => {
    expect(validate(new Selector({ name: 'emailField' }))).toEqual({ match: { name: 'emailField' } });
  });

  it('ancestorKey selector', () => {
    expect(validate(new Selector({ ancestorKey: 'form' }))).toEqual({ match: { ancestorKey: 'form' } });
  });

  it('tooltip selector', () => {
    expect(validate(new Selector({ tooltip: 'Increment' }))).toEqual({ match: { tooltip: 'Increment' } });
  });

  it('icon selector', () => {
    const q = validate(new Selector({ icon: { codePoint: 0xE8B3, fontFamily: 'MaterialIcons' } }));
    expect(q.match?.iconCodePoint).toBe(0xE8B3);
    expect(q.match?.iconFontFamily).toBe('MaterialIcons');
  });

  it('semantics selector', () => {
    const q = validate(new Selector({ semantics: { label: 'Submit', role: 'button' } }));
    expect(q.match?.semanticsLabel).toBe('Submit');
    expect(q.match?.role).toBe('button');
  });

  it('state selector (enabled)', () => {
    expect(validate(new Selector({ type: 'ElevatedButton', enabled: true }))).toEqual({
      match: { type: 'ElevatedButton', enabled: true },
    });
  });

  it('state selector (checked)', () => {
    expect(validate(new Selector({ type: 'Checkbox', checked: true }))).toEqual({
      match: { type: 'Checkbox', checked: true },
    });
  });

  it('text regex selector', () => {
    expect(validate(new Selector(/log in/i))).toEqual({ match: { textRegex: 'log in' } });
  });

  it('text contains selector', () => {
    expect(validate(new Selector('textContains=Sub'))).toEqual({
      match: { textContains: 'Sub' },
    });
  });
});

// ── String prefix selectors ────────────────────────────────────────

describe('wire protocol: string prefix selectors', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['text=Login', { match: { text: 'Login' } }],
    ['textContains=Sub', { match: { textContains: 'Sub' } }],
    ['key=btn', { match: { key: 'btn' } }],
    ['type=ElevatedButton', { match: { type: 'ElevatedButton' } }],
    ['byType=ElevatedButton', { match: { type: 'ElevatedButton' } }],
    ['id=w-1', { match: { id: 'w-1' } }],
    ['name=email', { match: { name: 'email' } }],
    ['ancestorKey=form', { match: { ancestorKey: 'form' } }],
    ['semanticsId=btn.submit', { match: { semanticIdentifier: 'btn.submit' } }],
    ['semantics=Submit', { match: { semanticsLabel: 'Submit' } }],
    ['semanticsLabel=Submit', { match: { semanticsLabel: 'Submit' } }],
    ['role=button', { match: { role: 'button' } }],
    ['tooltip=Save', { match: { tooltip: 'Save' } }],
    ['subtype=Widget', { match: { subtype: 'Widget' } }],
  ];

  for (const [input, expected] of cases) {
    it(`${input}`, () => {
      expect(validate(new Selector(input))).toEqual(expected);
    });
  }
});

// ── Composition selectors ──────────────────────────────────────────

describe('wire protocol: composition', () => {
  it('descendant (within)', () => {
    const q = validate(new Selector({ text: 'Login', ancestor: { type: 'ListView' } }));
    expect(q.match).toEqual({ text: 'Login' });
    expect(q.within).toEqual({ match: { type: 'ListView' } });
  });

  it('.and() composition', () => {
    const q = validate(new Selector({ type: 'ListTile' }).and({ text: 'Settings' }));
    expect(q.and).toHaveLength(2);
    expect(q.and![0]).toEqual({ match: { type: 'ListTile' } });
    expect(q.and![1]).toEqual({ match: { text: 'Settings' } });
  });

  it('.or() composition', () => {
    const q = validate(new Selector({ text: 'Login' }).or({ text: 'Sign in' }));
    expect(q.or).toHaveLength(2);
  });

  it('.nth() position', () => {
    const q = validate(new Selector({ type: 'ListTile' }).nth(2));
    expect(q.match).toEqual({ type: 'ListTile' });
    expect(q.position).toEqual({ nth: 2 });
  });

  it('.first()', () => {
    const q = validate(new Selector({ type: 'ListTile' }).first());
    expect(q.position).toEqual({ nth: 0 });
  });

  it('.last()', () => {
    const q = validate(new Selector({ type: 'ListTile' }).last());
    expect(q.position).toEqual({ last: true });
  });
});

// ── Advanced selectors ──────────────────────────────────────────────

describe('wire protocol: advanced selectors', () => {
  it('.filter()', () => {
    const q = validate(new Selector({ type: 'ListTile' }).filter({ enabled: true, hasTextContains: 'Delete' }));
    expect(q.match).toEqual({ type: 'ListTile' });
    expect(q.filter).toEqual({ enabled: true, hasTextContains: 'Delete' });
  });

  it('.containing()', () => {
    const q = validate(new Selector({ type: 'ListTile' }).containing({ text: 'Delete' }));
    expect(q.match).toEqual({ type: 'ListTile' });
    expect(q.containing).toEqual({ match: { text: 'Delete' } });
  });

  it('chained: .containing().filter().last()', () => {
    const s = new Selector({ type: 'ListTile' })
      .containing({ text: 'Delete' })
      .filter({ enabled: true })
      .last();
    const q = validate(s);
    expect(q.match).toEqual({ type: 'ListTile' });
    expect(q.containing).toBeDefined();
    expect(q.filter).toEqual({ enabled: true });
    expect(q.position).toEqual({ last: true });
  });
});

// ── Schema rejects invalid inputs ──────────────────────────────────

describe('wire protocol: schema validation rejects invalid', () => {
  it('rejects unknown fields in MatchCriteria', () => {
    expect(() => matchCriteriaSchema.parse({ unknownField: 'bad' })).toThrow();
  });

  it('rejects unknown fields in FilterCriteria', () => {
    expect(() => filterCriteriaSchema.parse({ badField: true })).toThrow();
  });

  it('rejects unknown fields in SelectorQuery', () => {
    expect(() => selectorQuerySchema.parse({ badTopLevel: true })).toThrow();
  });

  it('rejects empty strings in text fields', () => {
    expect(() => matchCriteriaSchema.parse({ text: '' })).toThrow();
  });

  it('rejects negative nth', () => {
    expect(() => positionFilterSchema.parse({ nth: -1 })).toThrow();
  });

  it('rejects non-integer nth', () => {
    expect(() => positionFilterSchema.parse({ nth: 1.5 })).toThrow();
  });
});
