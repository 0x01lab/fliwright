import { AiSchemaValidationError } from './errors.js';
import type { JsonSchema, JsonSchemaType } from './types.js';

export function validateJsonSchema<T = unknown>(value: unknown, schema: JsonSchema): T {
  validateValue(value, schema, '$');
  return value as T;
}

function validateValue(value: unknown, schema: JsonSchema, path: string): void {
  if (schema.enum && !schema.enum.some((allowed) => Object.is(allowed, value))) {
    throw new AiSchemaValidationError(`${path} expected one of: ${schema.enum.map(formatEnumValue).join(', ')}`);
  }

  if (schema.type) {
    validateType(value, schema.type, path);
  }

  if (shouldValidateObjectKeywords(value, schema)) {
    validateObject(value, schema, path);
  }

  if (shouldValidateArrayKeywords(value, schema)) {
    validateArray(value, schema, path);
  }
}

function validateType(value: unknown, type: JsonSchemaType | JsonSchemaType[], path: string): void {
  const types = Array.isArray(type) ? type : [type];
  if (!types.some((candidate) => matchesType(value, candidate))) {
    throw new AiSchemaValidationError(`${path} expected ${formatTypeList(types)}`);
  }
}

function matchesType(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
  }
}

function validateObject(value: unknown, schema: JsonSchema, path: string): void {
  if (!isRecord(value)) {
    throw new AiSchemaValidationError(`${path} expected object`);
  }

  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) {
      throw new AiSchemaValidationError(`${propertyPath(path, key)} is required`);
    }
  }

  const properties = schema.properties ?? {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (Object.hasOwn(value, key)) {
      validateValue(value[key], propertySchema, propertyPath(path, key));
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        throw new AiSchemaValidationError(`${propertyPath(path, key)} is not allowed`);
      }
    }
  }
}

function validateArray(value: unknown, schema: JsonSchema, path: string): void {
  if (!Array.isArray(value)) {
    throw new AiSchemaValidationError(`${path} expected array`);
  }

  if (!schema.items) {
    return;
  }

  value.forEach((item, index) => {
    validateValue(item, schema.items!, `${path}[${index}]`);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propertyPath(path: string, key: string): string {
  return `${path}.${key}`;
}

function formatEnumValue(value: unknown): string {
  return String(value);
}

function hasType(schema: JsonSchema, type: JsonSchemaType): boolean {
  return Array.isArray(schema.type) ? schema.type.includes(type) : schema.type === type;
}

function formatTypeList(types: JsonSchemaType[]): string {
  return types.join(' or ');
}

function shouldValidateObjectKeywords(value: unknown, schema: JsonSchema): boolean {
  if (!hasObjectKeywords(schema)) {
    return false;
  }

  if (!schema.type) {
    return true;
  }

  if (Array.isArray(schema.type)) {
    return isRecord(value);
  }

  return schema.type === 'object';
}

function shouldValidateArrayKeywords(value: unknown, schema: JsonSchema): boolean {
  if (!hasArrayKeywords(schema)) {
    return false;
  }

  if (!schema.type) {
    return true;
  }

  if (Array.isArray(schema.type)) {
    return Array.isArray(value);
  }

  return schema.type === 'array';
}

function hasObjectKeywords(schema: JsonSchema): boolean {
  return Boolean(schema.properties || schema.required || schema.additionalProperties === false);
}

function hasArrayKeywords(schema: JsonSchema): boolean {
  return Boolean(schema.items);
}
