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

      expect(wire(selector)).toEqual({ match: { type: 'ancestor' } });
    });

    it('validates nth index', () => {
      expect(() => new Selector({ text: 'A' }).nth(-1)).toThrow('non-negative integer');
    });
  });
});
