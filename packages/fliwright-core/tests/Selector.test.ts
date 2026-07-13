import { describe, it, expect } from 'vitest';
import { Selector } from '../src/Selector.js';

function wire(selector: Selector) {
  return JSON.parse(selector.toWireParams().selector as string);
}

describe('Selector', () => {
  describe('constructor validation', () => {
    it('throws on nullish and empty inputs', () => {
      expect(() => new Selector(null as any)).toThrow('must not be null or undefined');
      expect(() => new Selector(undefined as any)).toThrow('must not be null or undefined');
      expect(() => new Selector('')).toThrow('must not be empty');
    });

    it('validates required selector values', () => {
      expect(() => new Selector({ text: '' })).toThrow('non-empty string');
      expect(() => new Selector({ key: '' })).toThrow('non-empty string');
      expect(() => new Selector({ type: '' })).toThrow('non-empty string');
      expect(() => new Selector({} as any)).toThrow('Invalid selector input');
    });
  });

  describe('structured wire format', () => {
    it('converts text selectors to exact text AST by default', () => {
      expect(wire(new Selector({ text: 'Login' }))).toEqual({
        match: { text: 'Login' },
      });
    });

    it('converts legacy selector strings to find queries', () => {
      expect(wire(new Selector('key=submit_btn'))).toEqual({ match: { key: 'submit_btn' } });
      expect(wire(new Selector('byType=ElevatedButton'))).toEqual({ match: { type: 'ElevatedButton' } });
      expect(wire(new Selector('semanticsId=login.email'))).toEqual({
        match: { semanticIdentifier: 'login.email' },
      });
    });

    it('supports regex text selectors', () => {
      expect(wire(new Selector(/log in/i))).toEqual({
        match: { textRegex: 'log in' },
      });
    });

    it('encodes ancestor shorthand as within query', () => {
      expect(wire(new Selector({ text: 'Login', ancestor: { type: 'ListView' } }))).toEqual({
        match: { text: 'Login' },
        within: { match: { type: 'ListView' } },
      });
    });

    it('includes resolve options in wire params', () => {
      const selector = new Selector({ key: 'email' });
      expect(selector.toWireParams({ limit: 2, strict: true, visible: 'hitTestable' })).toEqual({
        selector: JSON.stringify({ match: { key: 'email' } }),
        limit: '2',
        strict: 'true',
        visible: 'hitTestable',
      });
    });
  });

  describe('composition', () => {
    it('supports descendant, ancestor, and nth composition', () => {
      const selector = new Selector({ type: 'Form' })
        .descendant({ text: 'Submit' })
        .nth(1)
        .ancestor({ type: 'Dialog' });

      // ancestor correctly preserves the matching type and the original chain as within scope
      const q = wire(selector);
      expect(q.match).toEqual({ type: 'Dialog' });
      expect(q.containing).toBeDefined();
    });

    it('validates nth index', () => {
      expect(() => new Selector({ text: 'A' }).nth(-1)).toThrow('non-negative integer');
    });
  });

  describe('and/or round-trip', () => {
    it('correctly serializes .and() composition', () => {
      const selector = new Selector({ type: 'ListTile' }).and({ text: 'Settings' });
      const q = wire(selector);
      expect(q).toEqual({
        and: [
          { match: { type: 'ListTile' } },
          { match: { text: 'Settings' } },
        ],
      });
    });

    it('correctly serializes .or() composition', () => {
      const selector = new Selector({ text: 'Login' }).or({ text: 'Sign in' });
      const q = wire(selector);
      expect(q).toEqual({
        or: [
          { match: { text: 'Login' } },
          { match: { text: 'Sign in' } },
        ],
      });
    });

    it('round-trips and through AST', () => {
      const original = new Selector({ type: 'ListTile' }).and({ text: 'Settings' });
      const ast = original.toJSON();
      const roundTripped = Selector.fromAst(ast);
      expect(wire(roundTripped)).toEqual(wire(original));
    });

    it('round-trips or through AST', () => {
      const original = new Selector({ text: 'Login' }).or({ text: 'Sign in' });
      const ast = original.toJSON();
      const roundTripped = Selector.fromAst(ast);
      expect(wire(roundTripped)).toEqual(wire(original));
    });
  });

  describe('.last()', () => {
    it('produces position.last in wire format', () => {
      const selector = new Selector({ type: 'ListTile' }).last();
      expect(wire(selector)).toEqual({
        match: { type: 'ListTile' },
        position: { last: true },
      });
    });

    it('round-trips through AST', () => {
      const original = new Selector({ type: 'ListTile' }).last();
      const ast = original.toJSON();
      expect(ast.kind).toBe('last');
      const roundTripped = Selector.fromAst(ast);
      expect(wire(roundTripped)).toEqual(wire(original));
    });
  });

  describe('.filter()', () => {
    it('adds enabled filter to wire format', () => {
      const selector = new Selector({ type: 'ElevatedButton' }).filter({ enabled: true });
      expect(wire(selector)).toEqual({
        match: { type: 'ElevatedButton' },
        filter: { enabled: true },
      });
    });

    it('adds multiple filter criteria', () => {
      const selector = new Selector({ type: 'ListTile' })
        .filter({ enabled: true, hasTextContains: 'Delete' });
      expect(wire(selector)).toEqual({
        match: { type: 'ListTile' },
        filter: { enabled: true, hasTextContains: 'Delete' },
      });
    });

    it('merges successive filter calls', () => {
      const selector = new Selector({ type: 'ListTile' })
        .filter({ enabled: true })
        .filter({ hasTextContains: 'Delete' });
      expect(wire(selector)).toEqual({
        match: { type: 'ListTile' },
        filter: { enabled: true, hasTextContains: 'Delete' },
      });
    });

    it('supports checked and visible filters', () => {
      const selector = new Selector({ type: 'Checkbox' }).filter({ checked: true, visible: true });
      expect(wire(selector)).toEqual({
        match: { type: 'Checkbox' },
        filter: { checked: true, visible: true },
      });
    });

    it('round-trips through AST', () => {
      const original = new Selector({ type: 'ElevatedButton' }).filter({ enabled: true });
      const ast = original.toJSON();
      expect(ast.kind).toBe('filter');
      const roundTripped = Selector.fromAst(ast);
      expect(wire(roundTripped)).toEqual(wire(original));
    });

    it('throws on empty filter', () => {
      expect(() => new Selector({ text: 'A' }).filter({})).toThrow('at least one criterion');
    });
  });

  describe('.containing()', () => {
    it('finds parents that contain matching descendants', () => {
      const selector = new Selector({ type: 'ListTile' }).containing({ text: 'Delete' });
      const q = wire(selector);
      expect(q).toEqual({
        match: { type: 'ListTile' },
        containing: { match: { text: 'Delete' } },
      });
    });

    it('works with complex descendant selectors', () => {
      const selector = new Selector({ type: 'Form' })
        .containing({ type: 'TextFormField' });
      const q = wire(selector);
      expect(q.match).toEqual({ type: 'Form' });
      expect(q.containing).toBeDefined();
      expect(q.containing.match).toEqual({ type: 'TextFormField' });
    });

    it('round-trips through AST', () => {
      const original = new Selector({ type: 'ListTile' }).containing({ text: 'Delete' });
      const ast = original.toJSON();
      expect(ast.kind).toBe('containing');
      const roundTripped = Selector.fromAst(ast);
      expect(wire(roundTripped)).toEqual(wire(original));
    });
  });

  describe('tooltip selector', () => {
    it('creates tooltip selector from object', () => {
      expect(wire(new Selector({ tooltip: 'Increment' }))).toEqual({
        match: { tooltip: 'Increment' },
      });
    });

    it('creates tooltip selector from string prefix', () => {
      expect(wire(new Selector('tooltip=Increment'))).toEqual({
        match: { tooltip: 'Increment' },
      });
    });

    it('supports tooltip with ancestor', () => {
      expect(wire(new Selector({ tooltip: 'Save', ancestor: { type: 'Scaffold' } }))).toEqual({
        match: { tooltip: 'Save' },
        within: { match: { type: 'Scaffold' } },
      });
    });
  });

  describe('state selectors in MatchCriteria', () => {
    it('includes enabled in type selector', () => {
      expect(wire(new Selector({ type: 'ElevatedButton', enabled: true }))).toEqual({
        match: { type: 'ElevatedButton', enabled: true },
      });
    });

    it('includes checked in type selector', () => {
      expect(wire(new Selector({ type: 'Checkbox', checked: true }))).toEqual({
        match: { type: 'Checkbox', checked: true },
      });
    });

    it('includes both enabled and checked', () => {
      expect(wire(new Selector({ type: 'Switch', enabled: true, checked: false }))).toEqual({
        match: { type: 'Switch', enabled: true, checked: false },
      });
    });
  });

  describe('subtype selector', () => {
    it('creates subtype selector from object', () => {
      expect(wire(new Selector({ subtype: 'StatelessWidget' }))).toEqual({
        match: { subtype: 'StatelessWidget' },
      });
    });

    it('creates subtype selector from string prefix', () => {
      expect(wire(new Selector('subtype=Widget'))).toEqual({
        match: { subtype: 'Widget' },
      });
    });

    it('round-trips through AST', () => {
      const original = new Selector({ subtype: 'StatelessWidget' });
      const ast = original.toJSON();
      expect(ast.kind).toBe('subtype');
      const roundTripped = Selector.fromAst(ast);
      expect(wire(roundTripped)).toEqual(wire(original));
    });
  });

  describe('icon fontPackage', () => {
    it('includes fontPackage in icon selector', () => {
      const selector = new Selector({ icon: { codePoint: 0xE8B3, fontFamily: 'MaterialIcons', fontPackage: 'my_package' } });
      const ast = selector.toJSON();
      expect(ast.kind).toBe('icon');
      if (ast.kind === 'icon') {
        expect(ast.fontPackage).toBe('my_package');
        expect(ast.codePoint).toBe(0xE8B3);
        expect(ast.fontFamily).toBe('MaterialIcons');
      }
    });
  });
});
