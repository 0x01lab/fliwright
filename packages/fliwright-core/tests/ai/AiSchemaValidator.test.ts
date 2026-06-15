import { describe, expect, it } from 'vitest';

import { AiSchemaValidationError, validateJsonSchema, type JsonSchema } from '../../src/index.js';

describe('validateJsonSchema', () => {
  it('accepts objects satisfying required property schemas', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['name', 'phone'],
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
      },
    };
    const value = { name: 'Ada', phone: '+15551234567' };

    expect(validateJsonSchema(value, schema)).toBe(value);
  });

  it('rejects missing required properties with path', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['phone'],
      properties: {
        phone: { type: 'string' },
      },
    };

    expect(() => validateJsonSchema({}, schema)).toThrow(AiSchemaValidationError);
    expect(() => validateJsonSchema({}, schema)).toThrow('$.phone is required');
  });

  it('rejects nested type mismatches with path', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    };

    expect(() =>
      validateJsonSchema(
        {
          user: {
            tags: ['admin', 42],
          },
        },
        schema,
      ),
    ).toThrow('$.user.tags[1] expected string');
  });

  it('rejects enum values outside allowed set', () => {
    const schema: JsonSchema = {
      enum: ['success', 'error'],
    };

    expect(() => validateJsonSchema('pending', schema)).toThrow('$ expected one of: success, error');
  });

  it('accepts union type schemas and reports all expected types', () => {
    const schema: JsonSchema = {
      type: ['string', 'number'],
    };

    expect(validateJsonSchema('ready', schema)).toBe('ready');
    expect(validateJsonSchema(200, schema)).toBe(200);
    expect(() => validateJsonSchema(false, schema)).toThrow('$ expected string or number');
  });

  it('accepts nullable object unions when properties are present', () => {
    const schema: JsonSchema = {
      type: ['object', 'null'],
      properties: {
        name: { type: 'string' },
      },
    };

    expect(validateJsonSchema(null, schema)).toBeNull();
  });

  it('accepts nullable array unions when items are present', () => {
    const schema: JsonSchema = {
      type: ['array', 'null'],
      items: { type: 'string' },
    };

    expect(validateJsonSchema(null, schema)).toBeNull();
  });

  it('rejects additional properties when additionalProperties is false', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      additionalProperties: false,
    };

    expect(() => validateJsonSchema({ name: 'Ada', extra: true }, schema)).toThrow('$.extra is not allowed');
  });
});
