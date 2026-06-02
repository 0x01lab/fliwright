import type { MatchCriteria, SelectorAst, SelectorInput, SelectorQuery, TextMatchMode } from './types.js';

export class Selector {
  readonly query: SelectorQuery;

  constructor(input: SelectorInput | SelectorAst | SelectorQuery) {
    if (input == null) {
      throw new Error('Selector input must not be null or undefined');
    }
    this.query = Selector.normalize(input);
  }

  static fromAst(ast: SelectorAst): Selector {
    return new Selector(ast);
  }

  static normalize(input: SelectorInput | SelectorAst | SelectorQuery): SelectorQuery {
    if (input == null) {
      throw new Error('Selector input must not be null or undefined');
    }

    if (input instanceof RegExp) {
      return Selector.astToQuery(Selector.regexText(input));
    }

    if (typeof input === 'string') {
      if (input.length === 0) {
        throw new Error('Selector string must not be empty');
      }
      return Selector.astToQuery(Selector.parseString(input));
    }

    if (Selector.isQuery(input)) {
      return Selector.validateQuery(input);
    }

    if (Selector.isAst(input)) {
      return Selector.astToQuery(Selector.validateAst(input));
    }

    const ancestor = 'ancestor' in input && input.ancestor != null
      ? Selector.normalize(input.ancestor)
      : undefined;

    let query: SelectorQuery;
    if ('text' in input) {
      query = Selector.astToQuery(Selector.textAst(input.text, {
        match: input.exact === true ? 'exact' : input.match,
        caseSensitive: input.caseSensitive,
      }));
    } else if ('key' in input) {
      query = { match: { key: Selector.nonEmptyString('key', input.key) } };
    } else if ('type' in input) {
      query = { match: { type: Selector.nonEmptyString('type', input.type) } };
    } else if ('id' in input) {
      query = { match: { id: Selector.nonEmptyString('id', input.id) } };
    } else if ('name' in input) {
      query = { match: { name: Selector.nonEmptyString('name', input.name) } };
    } else if ('ancestorKey' in input) {
      query = { match: { ancestorKey: Selector.nonEmptyString('ancestorKey', input.ancestorKey) } };
    } else if ('semantics' in input) {
      query = Selector.astToQuery(Selector.semanticsAst(input.semantics));
    } else if ('icon' in input) {
      query = Selector.astToQuery(Selector.iconAst(input.icon));
    } else {
      throw new Error('Invalid selector input');
    }

    return ancestor ? { ...query, within: ancestor } : query;
  }

  descendant(matching: SelectorInput): Selector {
    const child = Selector.normalize(matching);
    return new Selector({ ...child, within: this.query });
  }

  ancestor(matching: SelectorInput): Selector {
    return Selector.fromAst({
      kind: 'ancestor',
      of: Selector.queryToAst(this.query),
      matching: Selector.queryToAst(Selector.normalize(matching)),
    });
  }

  and(...selectors: SelectorInput[]): Selector {
    return Selector.fromAst({
      kind: 'and',
      selectors: [this.query, ...selectors.map((selector) => Selector.normalize(selector))].map(Selector.queryToAst),
    });
  }

  or(...selectors: SelectorInput[]): Selector {
    return Selector.fromAst({
      kind: 'or',
      selectors: [this.query, ...selectors.map((selector) => Selector.normalize(selector))].map(Selector.queryToAst),
    });
  }

  nth(index: number): Selector {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('Selector index must be a non-negative integer');
    }
    return new Selector({ ...this.query, position: { ...this.query.position, nth: index } });
  }

  first(): Selector {
    return this.nth(0);
  }

  get ast(): SelectorAst {
    return this.toJSON();
  }

  toWireParams(options?: {
    limit?: number;
    strict?: boolean;
    visible?: 'any' | 'hitTestable';
    include?: string[];
  }): Record<string, unknown> {
    return {
      selector: JSON.stringify(this.query),
      ...(options?.limit != null ? { limit: String(options.limit) } : {}),
      ...(options?.strict != null ? { strict: String(options.strict) } : {}),
      ...(options?.visible != null ? { visible: options.visible } : {}),
      ...(options?.include != null ? { include: options.include.join(',') } : {}),
    };
  }

  toJSON(): SelectorAst {
    return Selector.queryToAst(this.query);
  }

  toQuery(): SelectorQuery {
    return this.query;
  }

  toString(): string {
    return JSON.stringify(this.query);
  }

  private static parseString(input: string): SelectorAst {
    const eq = input.indexOf('=');
    if (eq === -1) {
      return { kind: 'text', value: input, match: 'exact' };
    }

    const field = input.slice(0, eq);
    const value = input.slice(eq + 1);
    if (value.length === 0) {
      throw new Error(`Selector ${field} must be a non-empty string`);
    }

    switch (field) {
      case 'text':
        return { kind: 'text', value, match: 'exact' };
      case 'textContains':
        return { kind: 'text', value, match: 'contains' };
      case 'key':
        return { kind: 'key', value };
      case 'byType':
      case 'type':
        return { kind: 'type', value };
      case 'id':
        return { kind: 'id', value };
      case 'name':
        return { kind: 'name', value };
      case 'ancestorKey':
        return { kind: 'ancestorKey', value };
      case 'semanticsId':
        return { kind: 'semantics', identifier: value };
      case 'semantics':
      case 'semanticsLabel':
        return { kind: 'semantics', label: value, match: 'contains' };
      case 'role':
        return { kind: 'semantics', role: value };
      default:
        throw new Error(`Unsupported selector string prefix: ${field}`);
    }
  }

  private static regexText(input: RegExp): SelectorAst {
    return {
      kind: 'text',
      value: input.source,
      match: 'regex',
      caseSensitive: !input.ignoreCase,
    };
  }

  private static textAst(
    input: string | RegExp,
    options?: { match?: TextMatchMode; caseSensitive?: boolean },
  ): SelectorAst {
    if (input instanceof RegExp) return Selector.regexText(input);
    if (typeof input !== 'string' || input.length === 0) {
      throw new Error('Selector text must be a non-empty string');
    }
    return {
      kind: 'text',
      value: input,
      match: options?.match ?? 'exact',
      caseSensitive: options?.caseSensitive,
    };
  }

  private static valueAst<K extends 'key' | 'type' | 'id' | 'name' | 'ancestorKey'>(
    kind: K,
    value: unknown,
  ): Extract<SelectorAst, { kind: K }> {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Selector ${kind} must be a non-empty string`);
    }
    return { kind, value } as Extract<SelectorAst, { kind: K }>;
  }

  private static semanticsAst(input: {
    identifier?: string;
    label?: string;
    hint?: string;
    role?: string;
    match?: TextMatchMode;
    caseSensitive?: boolean;
  }): SelectorAst {
    const hasValue = Object.values(input).some((value) => typeof value === 'string' && value.length > 0);
    if (!hasValue) {
      throw new Error('Semantics selector must include identifier, label, hint, or role');
    }
    return { kind: 'semantics', ...input };
  }

  private static iconAst(input: { codePoint: number; fontFamily?: string }): SelectorAst {
    if (!Number.isInteger(input.codePoint) || input.codePoint < 0) {
      throw new Error('Icon selector codePoint must be a non-negative integer');
    }
    return { kind: 'icon', ...input };
  }

  private static isAst(input: object): input is SelectorAst {
    return 'kind' in input && typeof (input as { kind?: unknown }).kind === 'string';
  }

  private static isQuery(input: object): input is SelectorQuery {
    return 'match' in input || 'within' in input || 'fallback' in input || 'position' in input;
  }

  private static validateAst(ast: SelectorAst): SelectorAst {
    switch (ast.kind) {
      case 'text':
        return Selector.textAst(ast.value, {
          match: ast.match,
          caseSensitive: ast.caseSensitive,
        });
      case 'key':
      case 'type':
      case 'id':
      case 'name':
      case 'ancestorKey':
        return Selector.valueAst(ast.kind, ast.value);
      case 'semantics':
        return Selector.semanticsAst(ast);
      case 'icon':
        return Selector.iconAst(ast);
      case 'descendant':
      case 'ancestor':
        return {
          ...ast,
          of: Selector.validateAst(ast.of),
          matching: Selector.validateAst(ast.matching),
        };
      case 'and':
      case 'or':
        if (!Array.isArray(ast.selectors) || ast.selectors.length === 0) {
          throw new Error(`${ast.kind} selector must include at least one child selector`);
        }
        return { ...ast, selectors: ast.selectors.map((selector) => Selector.validateAst(selector)) };
      case 'nth':
        if (!Number.isInteger(ast.index) || ast.index < 0) {
          throw new Error('Selector index must be a non-negative integer');
        }
        return { ...ast, selector: Selector.validateAst(ast.selector) };
      default:
        throw new Error('Invalid selector input');
    }
  }

  private static validateQuery(query: SelectorQuery): SelectorQuery {
    return {
      ...(query.match ? { match: Selector.validateMatch(query.match) } : {}),
      ...(query.within ? { within: Selector.validateQuery(query.within) } : {}),
      ...(query.fallback ? { fallback: Selector.validateFallback(query.fallback) } : {}),
      ...(query.position ? { position: Selector.validatePosition(query.position) } : {}),
    };
  }

  private static validateMatch(match: MatchCriteria): MatchCriteria {
    const out: MatchCriteria = {};
    for (const key of [
      'type',
      'key',
      'id',
      'name',
      'ancestorKey',
      'text',
      'textContains',
      'textRegex',
      'semanticIdentifier',
      'semanticsLabel',
      'semanticsHint',
      'role',
    ] as const) {
      const value = match[key];
      if (value != null) out[key] = Selector.nonEmptyString(key, value);
    }
    if (Object.keys(out).length === 0) {
      throw new Error('Selector match must include at least one criterion');
    }
    return out;
  }

  private static validateFallback(fallback: NonNullable<SelectorQuery['fallback']>): NonNullable<SelectorQuery['fallback']> {
    const out: NonNullable<SelectorQuery['fallback']> = {};
    for (const key of ['semanticsLabel', 'semanticsHint', 'hintText', 'textContains'] as const) {
      const value = fallback[key];
      if (value != null) out[key] = Selector.nonEmptyString(key, value);
    }
    if (Object.keys(out).length === 0) {
      throw new Error('Selector fallback must include at least one criterion');
    }
    return out;
  }

  private static validatePosition(position: NonNullable<SelectorQuery['position']>): NonNullable<SelectorQuery['position']> {
    if (position.nth != null && (!Number.isInteger(position.nth) || position.nth < 0)) {
      throw new Error('Selector position.nth must be a non-negative integer');
    }
    return {
      ...(position.nth != null ? { nth: position.nth } : {}),
      ...(position.first != null ? { first: position.first } : {}),
      ...(position.last != null ? { last: position.last } : {}),
      ...(position.visible != null ? { visible: position.visible } : {}),
    };
  }

  private static nonEmptyString(name: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Selector ${name} must be a non-empty string`);
    }
    return value;
  }

  private static astToQuery(ast: SelectorAst): SelectorQuery {
    switch (ast.kind) {
      case 'text':
        if (ast.match === 'regex') return { match: { textRegex: ast.value } };
        if (ast.match === 'contains') return { match: { textContains: ast.value } };
        return { match: { text: ast.value } };
      case 'key':
        return { match: { key: ast.value } };
      case 'type':
        return { match: { type: ast.value } };
      case 'id':
        return { match: { id: ast.value } };
      case 'name':
        return { match: { name: ast.value } };
      case 'ancestorKey':
        return { match: { ancestorKey: ast.value } };
      case 'semantics':
        return {
          match: {
            ...(ast.identifier ? { semanticIdentifier: ast.identifier } : {}),
            ...(ast.label ? { semanticsLabel: ast.label } : {}),
            ...(ast.hint ? { semanticsHint: ast.hint } : {}),
            ...(ast.role ? { role: ast.role } : {}),
          },
        };
      case 'descendant':
        return { ...Selector.astToQuery(ast.matching), within: Selector.astToQuery(ast.of) };
      case 'nth':
        return { ...Selector.astToQuery(ast.selector), position: { nth: ast.index } };
      default:
        return { match: { type: ast.kind } };
    }
  }

  private static queryToAst(query: SelectorQuery): SelectorAst {
    const base = Selector.matchToAst(query.match);
    const scoped = query.within
      ? { kind: 'descendant' as const, of: Selector.queryToAst(query.within), matching: base }
      : base;
    if (query.position?.nth != null) {
      return { kind: 'nth', selector: scoped, index: query.position.nth };
    }
    return scoped;
  }

  private static matchToAst(match?: MatchCriteria): SelectorAst {
    if (!match) return { kind: 'type', value: 'Widget' };
    if (match.text) return { kind: 'text', value: match.text, match: 'exact' };
    if (match.textContains) return { kind: 'text', value: match.textContains, match: 'contains' };
    if (match.textRegex) return { kind: 'text', value: match.textRegex, match: 'regex' };
    if (match.key) return { kind: 'key', value: match.key };
    if (match.type) return { kind: 'type', value: match.type };
    if (match.id) return { kind: 'id', value: match.id };
    if (match.name) return { kind: 'name', value: match.name };
    if (match.ancestorKey) return { kind: 'ancestorKey', value: match.ancestorKey };
    if (match.semanticIdentifier || match.semanticsLabel || match.semanticsHint || match.role) {
      return {
        kind: 'semantics',
        ...(match.semanticIdentifier ? { identifier: match.semanticIdentifier } : {}),
        ...(match.semanticsLabel ? { label: match.semanticsLabel } : {}),
        ...(match.semanticsHint ? { hint: match.semanticsHint } : {}),
        ...(match.role ? { role: match.role } : {}),
      };
    }
    return { kind: 'type', value: 'Widget' };
  }
}
