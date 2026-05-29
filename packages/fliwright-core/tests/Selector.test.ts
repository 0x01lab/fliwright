import { describe, it, expect } from 'vitest';
import { Selector } from '../src/Selector.js';

describe('Selector', () => {
  describe('constructor validation', () => {
    it('throws on null input', () => {
      expect(() => new Selector(null as any)).toThrow('must not be null or undefined');
    });

    it('throws on undefined input', () => {
      expect(() => new Selector(undefined as any)).toThrow('must not be null or undefined');
    });

    it('throws on empty string', () => {
      expect(() => new Selector('')).toThrow('must not be empty');
    });

    it('throws on empty text selector', () => {
      expect(() => new Selector({ text: '' })).toThrow('non-empty string');
    });

    it('throws on empty key selector', () => {
      expect(() => new Selector({ key: '' })).toThrow('non-empty string');
    });

    it('throws on empty type selector', () => {
      expect(() => new Selector({ type: '' })).toThrow('non-empty string');
    });

    it('throws on object without text/key/type', () => {
      expect(() => new Selector({} as any)).toThrow('Invalid selector input');
    });
  });

  describe('toWireFormat', () => {
    it('returns string selector as-is', () => {
      const selector = new Selector('text=Login');
      expect(selector.toWireFormat()).toBe('text=Login');
    });

    it('converts text selector to wire format', () => {
      const selector = new Selector({ text: 'Login' });
      expect(selector.toWireFormat()).toBe('text=Login');
    });

    it('converts key selector to wire format', () => {
      const selector = new Selector({ key: 'submit_btn' });
      expect(selector.toWireFormat()).toBe('key=submit_btn');
    });

    it('converts type selector to wire format', () => {
      const selector = new Selector({ type: 'ElevatedButton' });
      expect(selector.toWireFormat()).toBe('byType=ElevatedButton');
    });
  });

  describe('toWireParams', () => {
    it('returns selector param for simple selector', () => {
      const selector = new Selector({ text: 'Login' });
      expect(selector.toWireParams()).toEqual({ selector: 'text=Login' });
    });

    it('includes ancestorSelector when ancestor is set', () => {
      const selector = new Selector({ text: 'Login', ancestor: { type: 'ListView' } });
      expect(selector.toWireParams()).toEqual({
        selector: 'text=Login',
        ancestorSelector: 'byType=ListView',
      });
    });

    it('supports nested ancestors', () => {
      const selector = new Selector({
        text: 'Login',
        ancestor: { type: 'ListView', ancestor: { key: 'main_list' } },
      });
      expect(selector.toWireParams()).toEqual({
        selector: 'text=Login',
        ancestorSelector: 'byType=ListView',
      });
    });

    it('returns selector param for string input', () => {
      const selector = new Selector('key=my_btn');
      expect(selector.toWireParams()).toEqual({ selector: 'key=my_btn' });
    });
  });

  describe('ancestor', () => {
    it('is undefined when no ancestor provided', () => {
      const selector = new Selector({ text: 'Hello' });
      expect(selector.ancestor).toBeUndefined();
    });

    it('stores ancestor as Selector instance', () => {
      const selector = new Selector({ text: 'Hello', ancestor: { type: 'Column' } });
      expect(selector.ancestor).toBeInstanceOf(Selector);
      expect(selector.ancestor!.toWireFormat()).toBe('byType=Column');
    });
  });
});
