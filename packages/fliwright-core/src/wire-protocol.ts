/**
 * Wire Protocol Schema — Single Source of Truth for TS↔Dart JSON contract.
 *
 * This file defines the Zod schemas for the selector wire protocol
 * sent between fliwright-core (TypeScript) and fliwright-bridge (Dart)
 * via VM Service `ext.fliwright.resolve` extension.
 *
 * To regenerate the JSON Schema file for Dart-side reference:
 *   import { selectorQuerySchema } from './wire-protocol.js';
 *   import { zodToJsonSchema } from 'zod-to-json-schema';
 *   const jsonSchema = zodToJsonSchema(selectorQuerySchema);
 */

import { z } from 'zod';

// ── Primitive helpers ──────────────────────────────────────────────

const nonEmptyString = z.string().min(1);

// ── MatchCriteria ──────────────────────────────────────────────────

export const matchCriteriaSchema = z.object({
  type: nonEmptyString.optional(),
  key: nonEmptyString.optional(),
  id: nonEmptyString.optional(),
  name: nonEmptyString.optional(),
  ancestorKey: nonEmptyString.optional(),
  text: nonEmptyString.optional(),
  textContains: nonEmptyString.optional(),
  textRegex: nonEmptyString.optional(),
  semanticIdentifier: nonEmptyString.optional(),
  semanticsLabel: nonEmptyString.optional(),
  semanticsHint: nonEmptyString.optional(),
  role: nonEmptyString.optional(),
  tooltip: nonEmptyString.optional(),
  subtype: nonEmptyString.optional(),
  enabled: z.boolean().optional(),
  checked: z.boolean().optional(),
  iconCodePoint: z.number().int().nonnegative().optional(),
  iconFontFamily: nonEmptyString.optional(),
  iconFontPackage: nonEmptyString.optional(),
}).strict();

// ── FilterCriteria ─────────────────────────────────────────────────

export const filterCriteriaSchema = z.object({
  hasText: nonEmptyString.optional(),
  hasTextContains: nonEmptyString.optional(),
  hasTextRegex: nonEmptyString.optional(),
  visible: z.boolean().optional(),
  enabled: z.boolean().optional(),
  checked: z.boolean().optional(),
}).strict();

// ── FallbackCriteria ───────────────────────────────────────────────

export const fallbackCriteriaSchema = z.object({
  semanticsLabel: nonEmptyString.optional(),
  semanticsHint: nonEmptyString.optional(),
  hintText: nonEmptyString.optional(),
  textContains: nonEmptyString.optional(),
}).strict();

// ── PositionFilter ─────────────────────────────────────────────────

export const positionFilterSchema = z.object({
  nth: z.number().int().nonnegative().optional(),
  first: z.boolean().optional(),
  last: z.boolean().optional(),
  visible: z.boolean().optional(),
}).strict();

// ── KeyedAncestor / WidgetInfo (hitTest response) ──────────────────

export const keyedAncestorSchema = z.object({
  key: nonEmptyString,
  type: nonEmptyString,
}).strict();

export const descendantIconSchema = z.object({
  codePoint: z.number().int().nonnegative(),
  fontFamily: nonEmptyString.optional(),
  fontPackage: nonEmptyString.optional(),
}).strict();

export const widgetInfoSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: nonEmptyString.optional(),
  key: nonEmptyString.optional(),
  name: nonEmptyString.optional(),
  ancestorKey: nonEmptyString.optional(),
  semanticsId: nonEmptyString.optional(),
  semanticsLabel: nonEmptyString.optional(),
  semanticsHint: nonEmptyString.optional(),
  role: nonEmptyString.optional(),
  tooltip: nonEmptyString.optional(),
  descendantText: nonEmptyString.optional(),
  descendantIcon: descendantIconSchema.optional(),
  keyedAncestors: z.array(keyedAncestorSchema).optional(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).strict().optional(),
  hitTestable: z.boolean().optional(),
  properties: z.record(z.unknown()),
}).strict();

// ── SelectorQuery (recursive) ──────────────────────────────────────

export const selectorQuerySchema: z.ZodType<import('./types.js').SelectorQuery> = z.lazy(() =>
  z.object({
    match: matchCriteriaSchema.optional(),
    within: selectorQuerySchema.optional(),
    fallback: fallbackCriteriaSchema.optional(),
    position: positionFilterSchema.optional(),
    and: z.array(selectorQuerySchema).min(1).optional(),
    or: z.array(selectorQuerySchema).min(1).optional(),
    filter: filterCriteriaSchema.optional(),
    containing: selectorQuerySchema.optional(),
  }).strict()
);

// ── Resolve params (top-level wire message) ────────────────────────

export const resolveParamsSchema = z.object({
  selector: z.string().min(1),  // JSON-encoded SelectorQuery
  strict: z.enum(['true', 'false']).optional(),
  visible: z.enum(['any', 'hitTestable']).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  alignment: z.enum([
    'topLeft', 'topCenter', 'topRight',
    'centerLeft', 'center', 'centerRight',
    'bottomLeft', 'bottomCenter', 'bottomRight',
  ]).optional(),
});

// ── Validate helper ────────────────────────────────────────────────

/**
 * Validates a SelectorQuery JSON object against the wire protocol schema.
 * Throws a ZodError with detailed path info on mismatch.
 */
export function validateSelectorQuery(query: unknown): import('./types.js').SelectorQuery {
  return selectorQuerySchema.parse(query);
}

/**
 * Parses and validates the selector JSON string from a wire message.
 */
export function parseSelectorJson(selectorJson: string): import('./types.js').SelectorQuery {
  const parsed = JSON.parse(selectorJson);
  return validateSelectorQuery(parsed);
}
