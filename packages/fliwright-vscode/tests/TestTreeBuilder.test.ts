import { describe, expect, it } from 'vitest';
import { buildTestTree } from '../src/testing/TestTreeBuilder.js';

describe('TestTreeBuilder', () => {
  it('parses a flat file with multiple tests', () => {
    const src = `
      import { test } from 'vitest';
      test('login ok', async () => {});
      test('login fail', async () => {});
    `;
    const file = buildTestTree(src);
    expect(file.nodes).toHaveLength(2);
    expect(file.nodes[0]).toMatchObject({ title: 'login ok' });
    expect(file.nodes[1]).toMatchObject({ title: 'login fail' });
  });

  it('parses nested describe > test', () => {
    const src = `
      import { describe, test } from 'vitest';
      describe('suite A', () => {
        test('inner', () => {});
        describe('suite B', () => {
          test('deep', () => {});
        });
      });
    `;
    const file = buildTestTree(src);
    expect(file.nodes).toHaveLength(1);
    const a = file.nodes[0];
    expect(a).toMatchObject({ title: 'suite A' });
    if (a.kind !== 'group') throw new Error('expected group');
    expect(a.children).toHaveLength(2);
    expect(a.children[0]).toMatchObject({ title: 'inner' });
    const b = a.children[1];
    if (b.kind !== 'group') throw new Error('expected group');
    expect(b.children[0]).toMatchObject({ title: 'deep' });
  });

  it('treats it() as a test', () => {
    const file = buildTestTree(`it('works', () => {})`);
    expect(file.nodes[0]).toMatchObject({ title: 'works' });
  });

  it('marks dynamic titles without crashing', () => {
    const file = buildTestTree(`test(\`case \${i}\`, () => {})`);
    expect(file.nodes[0].title).toBe('<dynamic>');
  });

  it('ignores commented-out test() calls', () => {
    const src = `
      // test('skipped', () => {});
      test('real', () => {});
    `;
    const file = buildTestTree(src);
    expect(file.nodes).toHaveLength(1);
    expect(file.nodes[0]).toMatchObject({ title: 'real' });
  });

  // Regression: real fliwright .test.ts files pass strings like
  // `toContain("test('login flow'")` to expect(). The substring `test(`
  // appears inside a string literal and must NOT be treated as a test
  // declaration. Only true call sites in code position count.
  it('ignores test( / describe( that appear inside string literals', () => {
    const src = `
      import { describe, test, expect } from 'vitest';
      describe('outer', () => {
        test('asserts generated snippet', () => {
          expect(code).toContain("test('login flow'");
          expect(code).toContain('describe("nested",');
        });
        test('after', () => {});
      });
    `;
    const file = buildTestTree(src);
    expect(file.nodes).toHaveLength(1);
    const outer = file.nodes[0];
    if (outer.kind !== 'group') throw new Error('expected group');
    expect(outer.children).toHaveLength(2);
    expect(outer.children[0]).toMatchObject({ title: 'asserts generated snippet' });
    expect(outer.children[1]).toMatchObject({ title: 'after' });
  });

  // Regression: regex literals containing `{` or `)` must be lexed as opaque
  // tokens. Otherwise `/foo{/` increments brace depth (eating siblings) and
  // `/bar)/` corrupts paren balance in skipCallArgs.
  it('ignores regex literals containing braces and parens', () => {
    const src = `test('a', () => { const r = /foo{/; expect(x).toMatch(/bar)/); });
  describe('after', () => { test('inner', () => {}); });
  test('top', () => {});`;
    const f = buildTestTree(src);
    expect(f.nodes.map((n) => n.title)).toEqual(['a', 'after', 'top']);
  });

  // Regression: `/` after arithmetic/bitwise binary operators must start a
  // regex literal (previously mis-detected as division, consuming the line).
  it('treats regex after arithmetic/bitwise binary operators as regex', () => {
    const src = `test('a', () => { const x = 1 + /foo{}/; });
  describe('after', () => { test('inner', () => {}); });`;
    const f = buildTestTree(src);
    expect(f.nodes.map((n) => n.title)).toEqual(['a', 'after']);
  });

  // Edge cases for division-vs-regex disambiguation: a `/` after an operand
  // is division, not a regex literal. Must not consume the rest of the line.
  it('treats / after an identifier as division, not regex', () => {
    const src = `
      test('div', () => {
        const x = a / b / c;
        expect(x).toBeDefined();
      });
      test('next', () => {});
    `;
    const f = buildTestTree(src);
    expect(f.nodes.map((n) => n.title)).toEqual(['div', 'next']);
  });

  // Edge case: regex with flags and a character class containing `/`.
  it('handles regex flags and character classes', () => {
    const src = `
      test('re', () => {
        const re = /^https?:\\/\\//gi;
        const re2 = /[/]/;
        expect(re).toBeDefined();
      });
      test('after', () => {});
    `;
    const f = buildTestTree(src);
    expect(f.nodes.map((n) => n.title)).toEqual(['re', 'after']);
  });

  // Regression: block comments and multi-line strings must not cause phantom
  // nodes or break brace-depth tracking.
  it('skips block comments and strings spanning the body', () => {
    const src = `
      /*
       * describe('fake', () => { test('nope', () => {}) })
       */
      test('real one', () => {
        const s = 'unbalanced { brace inside string';
        expect(s).toBeDefined();
      });
      test('real two', () => {});
    `;
    const file = buildTestTree(src);
    expect(file.nodes).toHaveLength(2);
    expect(file.nodes[0]).toMatchObject({ title: 'real one' });
    expect(file.nodes[1]).toMatchObject({ title: 'real two' });
  });
});
