import type { SelectorInput } from './types.js';

export class Selector {
  readonly ancestor?: Selector;

  constructor(private readonly input: SelectorInput) {
    if (input == null) {
      throw new Error('Selector input must not be null or undefined');
    }
    if (typeof input === 'string') {
      if (input.length === 0) {
        throw new Error('Selector string must not be empty');
      }
      return;
    }
    if ('text' in input) {
      if (typeof input.text !== 'string' || input.text.length === 0) {
        throw new Error('Selector text must be a non-empty string');
      }
    } else if ('key' in input) {
      if (typeof input.key !== 'string' || input.key.length === 0) {
        throw new Error('Selector key must be a non-empty string');
      }
    } else if ('type' in input) {
      if (typeof input.type !== 'string' || input.type.length === 0) {
        throw new Error('Selector type must be a non-empty string');
      }
    } else {
      throw new Error('Invalid selector input: must be a string, or object with text, key, or type');
    }

    if (input.ancestor != null) {
      this.ancestor = new Selector(input.ancestor);
    }
  }

  toWireFormat(): string {
    if (typeof this.input === 'string') {
      return this.input;
    }
    if ('text' in this.input) {
      return `text=${this.input.text}`;
    }
    if ('key' in this.input) {
      return `key=${this.input.key}`;
    }
    if ('type' in this.input) {
      return `byType=${this.input.type}`;
    }
    // Should be unreachable due to constructor validation
    throw new Error('Invalid selector input');
  }

  toWireParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {
      selector: this.toWireFormat(),
    };
    if (this.ancestor) {
      params.ancestorSelector = this.ancestor.toWireFormat();
    }
    return params;
  }
}
