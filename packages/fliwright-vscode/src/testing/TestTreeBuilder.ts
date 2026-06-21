export interface ParsedTest { kind: 'test'; title: string; }
export interface ParsedGroup { kind: 'group'; title: string; children: ParsedNode[]; }
export type ParsedNode = ParsedGroup | ParsedTest;
export interface ParsedFile { nodes: ParsedNode[]; }

const CALL_START = /(?:describe|test|it)\s*\(/;

/**
 * Parse fliwright `.test.ts` source into a describe/test tree.
 *
 * Single forward char-scan over the source tracking lexer state — string
 * literals (single/double/backtick, with escapes and template `${...}`),
 * line/block comments, and brace depth. A `describe(`/`test(`/`it(` token at a
 * real code position emits a node; matches inside strings or comments are
 * ignored. No AST library — regex + brace-depth tracking only.
 *
 * Title = first argument when it is a plain string literal (no interpolation);
 * otherwise `<dynamic>`. A `describe(` opens a group tracked on a depth stack;
 * the group closes when its opening brace is balanced.
 */
export function buildTestTree(source: string): ParsedFile {
  const root: ParsedNode[] = [];
  const stack: { group: ParsedGroup; openDepth: number }[] = [];
  let depth = 0;

  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];

    if (c === '\\') { i += 2; continue; }

    if (c === "'" || c === '"' || c === '`') {
      const end = findStringEnd(source, i, c);
      i = end < 0 ? n : end + 1;
      continue;
    }

    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }

    if (c === '/' && source[i + 1] === '*') {
      const ce = source.indexOf('*/', i + 2);
      i = ce < 0 ? n : ce + 2;
      continue;
    }

    if (c === '/' && isRegexStart(source, i)) {
      const end = findRegexEnd(source, i);
      i = end < 0 ? n : end + 1;
      continue;
    }

    if (c === '{') { depth++; i++; continue; }
    if (c === '}') {
      depth--;
      i++;
      while (stack.length > 0 && depth < stack[stack.length - 1].openDepth) {
        stack.pop();
      }
      continue;
    }

    // Potential call site at a word boundary (previous char not identifier).
    if (isWordChar(c) && !isWordChar(source[i - 1])) {
      const call = matchCall(source, i);
      if (call) {
        const callName = call.name;
        const parenPos = i + call.keywordLength - 1; // index of '('
        const title = readTitle(source, parenPos + 1);

        if (callName === 'describe') {
          const braceOpen = findOpeningBrace(source, parenPos, title.end);
          if (braceOpen >= 0) {
            const group: ParsedGroup = { kind: 'group', title: title.value, children: [] };
            pushNode(stack, root, group);
            // Step into the body: count the opening brace and record the depth
            // at which the group is "open". The group closes when depth returns
            // below openDepth.
            depth++;
            stack.push({ group, openDepth: depth });
            i = braceOpen + 1;
          } else {
            const group: ParsedGroup = { kind: 'group', title: title.value, children: [] };
            pushNode(stack, root, group);
            i = title.end;
          }
          continue;
        }

        // test() / it()
        const node: ParsedTest = { kind: 'test', title: title.value };
        pushNode(stack, root, node);
        const closeParen = skipCallArgs(source, parenPos);
        i = closeParen < 0 ? n : closeParen + 1;
        continue;
      }
    }

    i++;
  }

  return { nodes: root };
}

function pushNode(
  stack: { group: ParsedGroup; openDepth: number }[],
  root: ParsedNode[],
  node: ParsedNode,
): void {
  if (stack.length > 0) {
    stack[stack.length - 1].group.children.push(node);
  } else {
    root.push(node);
  }
}

function isWordChar(c: string | undefined): boolean {
  return !!c && /[A-Za-z0-9_$]/.test(c);
}

function matchCall(
  source: string,
  pos: number,
): { name: 'describe' | 'test' | 'it'; keywordLength: number } | null {
  const slice = source.slice(pos);
  const m = CALL_START.exec(slice);
  if (!m || m.index !== 0) return null;
  const name = m[0].replace(/\s*\($/, '');
  if (name !== 'describe' && name !== 'test' && name !== 'it') return null;
  return { name, keywordLength: m[0].length };
}

interface TitleResult { value: string; end: number; }

function readTitle(source: string, from: number): TitleResult {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i++;
  const ch = source[i];
  if (ch === "'" || ch === '"' || ch === '`') {
    const end = findStringEnd(source, i, ch);
    if (end > i) {
      const raw = source.slice(i, end + 1);
      if (ch === '`' && raw.includes('${')) {
        return { value: '<dynamic>', end: end + 1 };
      }
      return { value: unquote(raw), end: end + 1 };
    }
  }
  return { value: '<dynamic>', end: i };
}

function unquote(literal: string): string {
  const body = literal.slice(1, -1);
  let out = '';
  for (let j = 0; j < body.length; j++) {
    if (body[j] === '\\' && j + 1 < body.length) {
      const next = body[++j];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else out += next;
    } else {
      out += body[j];
    }
  }
  return out;
}

/**
 * Find the closing quote for a string starting at `start`. Handles escapes; for
 * backtick templates, skips `${...}` interpolations (nested braces/strings).
 */
function findStringEnd(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') { i += 2; continue; }
    if (quote === '`' && c === '$' && source[i + 1] === '{') {
      i += 2;
      let bd = 1;
      while (i < source.length && bd > 0) {
        const cc = source[i];
        if (cc === '\\') { i += 2; continue; }
        if (cc === '{') { bd++; i++; continue; }
        if (cc === '}') { bd--; i++; continue; }
        if (cc === "'" || cc === '"' || cc === '`') {
          const se = findStringEnd(source, i, cc);
          if (se < 0) return -1;
          i = se + 1;
          continue;
        }
        i++;
      }
      continue;
    }
    if (c === quote) return i;
    i++;
  }
  return -1;
}

/**
 * Find the `{` opening the callback body, starting just after the title. The
 * body's `{` lives INSIDE the call's parens (`describe(t, () => { ... })`), so
 * we balance parens (skipping strings/comments) and return the first `{`.
 */
function findOpeningBrace(source: string, callParenPos: number, from: number): number {
  let i = from;
  let parenDepth = 1;
  while (i < source.length && parenDepth > 0) {
    const c = source[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const se = findStringEnd(source, i, c);
      if (se < 0) return -1;
      i = se + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const ce = source.indexOf('*/', i + 2);
      i = ce < 0 ? source.length : ce + 2;
      continue;
    }
    if (c === '/' && isRegexStart(source, i)) {
      const end = findRegexEnd(source, i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (c === '{') return i;
    if (c === '(') parenDepth++;
    else if (c === ')') parenDepth--;
    i++;
  }
  return -1;
}

/** Given the `(` of a call, return the index of its matching `)`. */
function skipCallArgs(source: string, openParen: number): number {
  let depth = 0;
  let i = openParen;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const se = findStringEnd(source, i, c);
      if (se < 0) return -1;
      i = se + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const ce = source.indexOf('*/', i + 2);
      i = ce < 0 ? source.length : ce + 2;
      continue;
    }
    if (c === '/' && isRegexStart(source, i)) {
      const end = findRegexEnd(source, i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (c === '{') {
      const close = findMatchingBrace(source, i);
      i = close < 0 ? source.length : close + 1;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Given an opening `{`, return the index of its matching `}`. */
function findMatchingBrace(source: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const se = findStringEnd(source, i, c);
      if (se < 0) return -1;
      i = se + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const ce = source.indexOf('*/', i + 2);
      i = ce < 0 ? source.length : ce + 2;
      continue;
    }
    if (c === '/' && isRegexStart(source, i)) {
      const end = findRegexEnd(source, i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Decide whether the `/` at `pos` opens a regex literal (vs. division). Scan
 * backwards from `pos - 1` skipping whitespace and comments; the previous
 * significant character determines it. Regex follows operator/punctuation that
 * cannot end an expression; division follows an operand (identifier, number,
 * `)`, `]`, or string end — which we approximate by "any other char"). The
 * start-of-file case is regex.
 */
function isRegexStart(source: string, pos: number): boolean {
  let j = pos - 1;
  while (j >= 0) {
    const c = source[j];
    if (/\s/.test(c)) { j--; continue; }
    // Line comment: scan back to its `//` start.
    if (c === '/' && source[j - 1] === '/') {
      let k = j - 2;
      while (k >= 0 && source[k] !== '\n') k--;
      j = k - 1;
      continue;
    }
    // Block comment close `*/`: scan back to its `/*` start.
    if (c === '/' && source[j - 1] === '*') {
      const open = source.lastIndexOf('/*', j - 2);
      if (open < 0) return false;
      j = open - 1;
      continue;
    }
    // First significant char.
    return '(,=:[!&|?{};>'.includes(c);
  }
  return true; // start of file
}

/**
 * Given the opening `/` of a regex literal at `start`, return the index of the
 * last character belonging to the literal (the closing `/`, or the last flag
 * letter after it). Handles `\/` escapes and character classes `[...]` (where
 * `/` is literal). Returns -1 if unterminated.
 */
function findRegexEnd(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  let close = -1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') { i += 2; continue; }
    if (inClass) {
      if (c === ']') inClass = false;
      i++;
      continue;
    }
    if (c === '[') { inClass = true; i++; continue; }
    if (c === '/') { close = i; break; }
    if (c === '\n') return -1; // regex literals can't span lines
    i++;
  }
  if (close < 0) return -1;
  // Skip trailing flag letters (gimsuy, etc.). Don't consume a `/` that is
  // actually the next regex/division start.
  let j = close + 1;
  while (j < source.length && /[a-z]/.test(source[j])) j++;
  return j - 1;
}
