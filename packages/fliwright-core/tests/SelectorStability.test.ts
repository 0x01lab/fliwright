import { describe, expect, it } from 'vitest';
import { Selector } from '../src/Selector.js';
import { Page } from '../src/Page.js';
import type { SelectorQuery } from '../src/types.js';

const queryOf = (selector: Selector) => JSON.parse(selector.toWireParams().selector as string);

describe('selector stability', () => {
  it('preserves all match predicates when composing selectors', () => {
    const query: SelectorQuery = { match: { type: 'Checkbox', checked: true, key: 'agree' } };
    expect(queryOf(new Selector(query).and({ type: 'Checkbox' })).and[0]).toEqual(query);
    expect(queryOf(new Selector(query).or({ key: 'other' })).or[0]).toEqual(query);
    expect(queryOf(new Selector(query).containing({ text: 'Agree' }))).toMatchObject(query);
    expect(queryOf(new Selector({ key: 'child' }).ancestor(query))).toMatchObject(query);
  });

  it('preserves scoped composition, filters, fallback and position', () => {
    const query: SelectorQuery = {
      or: [{ match: { key: 'a' } }, { match: { key: 'b' } }],
      within: { match: { key: 'form' } },
      filter: { enabled: true },
      fallback: { semanticsLabel: 'Save' },
      position: { nth: 0, visible: true },
    };
    expect(queryOf(new Selector(query).and({ type: 'ElevatedButton' })).and[0]).toEqual(query);
    expect(queryOf(new Selector(query).containing({ text: 'Save' }))).toMatchObject(query);
  });

  it('preserves text case sensitivity and supported regex flags', () => {
    expect(queryOf(new Selector(/save/ims))).toEqual({
      match: { textRegex: 'save', textCaseSensitive: false, textMultiline: true, textDotAll: true },
    });
    expect(queryOf(new Selector({ text: 'Save', caseSensitive: false }))).toEqual({
      match: { text: 'Save', textCaseSensitive: false },
    });
  });

  it('preserves semantics matching options', () => {
    expect(queryOf(new Selector({ semantics: { label: '^Save$', match: 'regex', caseSensitive: false } }))).toEqual({
      match: { semanticsLabel: '^Save$', semanticsMatch: 'regex', semanticsCaseSensitive: false },
    });
    expect(queryOf(new Selector({ semantics: { label: 'Save', match: 'exact' } }))).toEqual({
      match: { semanticsLabel: 'Save', semanticsMatch: 'exact' },
    });
  });

  it('retains compound criteria and all modifiers through AST round trips', () => {
    const queries: SelectorQuery[] = [
      { match: { type: 'Checkbox', key: 'agree', checked: true, enabled: true } },
      { fallback: { hintText: 'Email' } },
      { match: { textRegex: 'save', textCaseSensitive: false, textMultiline: true } },
      { or: [{ match: { key: 'a' } }, { match: { key: 'b' } }], within: { match: { key: 'form' } },
        filter: { enabled: true }, fallback: { hintText: 'Save' }, position: { nth: 0, visible: true } },
    ];
    for (const query of queries) {
      expect(queryOf(Selector.fromAst(new Selector(query).toJSON()))).toEqual(query);
    }
  });

  it('last replaces an earlier positional selection', () => {
    expect(queryOf(new Selector({ type: 'Checkbox' }).first().last()).position).toEqual({ last: true });
  });

  it('allows scrolling to mounted elements before they are hit testable', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const page = new Page(async (_method, params) => { calls.push(params); return { success: true }; });
    await page.getByKey('far').scrollIntoView({ duration: 0 });
    expect(calls[0]?.visible).toBe('any');
  });
});
