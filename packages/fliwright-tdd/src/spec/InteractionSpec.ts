export type SpecElementRole =
  | 'button'
  | 'textbox'
  | 'text'
  | 'list'
  | 'image'
  | 'checkbox'
  | 'switch'
  | 'tab';

export interface LocatorHint {
  strategy: 'key' | 'semantics' | 'text' | 'type';
  value: string;
}

export interface SpecElement {
  id: string;
  role: SpecElementRole;
  name: string;
  text?: string;
  placeholder?: string;
  figmaNodeId?: string;
  importance?: 'required' | 'optional';
  locatorHints?: LocatorHint[];
}

export type SpecStep =
  | { action: 'tap'; target: string }
  | { action: 'type'; target: string; value: string }
  | { action: 'select'; target: string; value: string }
  | { action: 'waitFor'; target: string }
  | { action: 'assertVisible'; target: string };

export type SpecAssertion =
  | { kind: 'visible'; target: string }
  | { kind: 'text'; target: string; equals?: string; contains?: string }
  | { kind: 'route'; equals: string }
  | { kind: 'mockCalled'; endpoint: string; method?: string }
  | { kind: 'state'; path: string; equals: unknown };

export interface SpecFlow {
  id: string;
  name: string;
  steps: SpecStep[];
  expectedOutcome?: SpecAssertion[];
}

export interface InteractionSpec {
  app?: {
    platform?: 'flutter';
    route?: string;
    screenName?: string;
  };
  initialState?: {
    route?: string;
    mockProfile?: string;
    riverpodOverrides?: unknown[];
    storageSeed?: Record<string, unknown>;
    authState?: 'guest' | 'authenticated';
  };
  elements: SpecElement[];
  flows: SpecFlow[];
  assertions?: SpecAssertion[];
}

export interface InteractionSpecValidationIssue {
  path: string;
  message: string;
}

export type InteractionSpecValidationResult =
  | { ok: true; spec: InteractionSpec; issues: [] }
  | { ok: false; issues: InteractionSpecValidationIssue[] };

export class InteractionSpecValidationError extends Error {
  constructor(readonly issues: InteractionSpecValidationIssue[]) {
    super(`Invalid InteractionSpec: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
    this.name = 'InteractionSpecValidationError';
  }
}

const elementRoles = new Set<SpecElementRole>([
  'button',
  'textbox',
  'text',
  'list',
  'image',
  'checkbox',
  'switch',
  'tab',
]);

const locatorStrategies = new Set<LocatorHint['strategy']>(['key', 'semantics', 'text', 'type']);
const stepActions = new Set<SpecStep['action']>(['tap', 'type', 'select', 'waitFor', 'assertVisible']);
const assertionKinds = new Set<SpecAssertion['kind']>(['visible', 'text', 'route', 'mockCalled', 'state']);

export function parseInteractionSpec(value: unknown): InteractionSpec {
  const result = validateInteractionSpec(value);
  if (!result.ok) throw new InteractionSpecValidationError(result.issues);
  return result.spec;
}

export function validateInteractionSpec(value: unknown): InteractionSpecValidationResult {
  const issues: InteractionSpecValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '$', message: 'must be an object.' }] };
  }

  const elements = readElements(value.elements, issues);
  const elementIds = new Set(elements.map((element) => element.id));
  const flows = readFlows(value.flows, elementIds, issues);
  const assertions = readAssertions(value.assertions, '$.assertions', elementIds, issues);

  if (elements.length === 0) issues.push({ path: '$.elements', message: 'must include at least one element.' });
  if (flows.length === 0) issues.push({ path: '$.flows', message: 'must include at least one flow.' });

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    spec: {
      app: readApp(value.app),
      initialState: readInitialState(value.initialState),
      elements,
      flows,
      assertions,
    },
    issues: [],
  };
}

function readElements(value: unknown, issues: InteractionSpecValidationIssue[]): SpecElement[] {
  if (!Array.isArray(value)) {
    issues.push({ path: '$.elements', message: 'must be an array.' });
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((raw, index) => {
    const path = `$.elements[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ path, message: 'must be an object.' });
      return [];
    }

    const id = readRequiredString(raw.id, `${path}.id`, issues);
    const name = readRequiredString(raw.name, `${path}.name`, issues);
    const role = readRequiredEnum(raw.role, elementRoles, `${path}.role`, issues);
    if (id) {
      if (seen.has(id)) issues.push({ path: `${path}.id`, message: `duplicates element id '${id}'.` });
      seen.add(id);
    }
    if (!id || !name || !role) return [];

    return [{
      id,
      role,
      name,
      text: readOptionalString(raw.text),
      placeholder: readOptionalString(raw.placeholder),
      figmaNodeId: readOptionalString(raw.figmaNodeId),
      importance: raw.importance === 'optional' ? 'optional' : raw.importance === 'required' ? 'required' : undefined,
      locatorHints: readLocatorHints(raw.locatorHints, `${path}.locatorHints`, issues),
    }];
  });
}

function readLocatorHints(
  value: unknown,
  path: string,
  issues: InteractionSpecValidationIssue[],
): LocatorHint[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'must be an array when provided.' });
    return undefined;
  }

  const hints = value.flatMap((raw, index) => {
    const hintPath = `${path}[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ path: hintPath, message: 'must be an object.' });
      return [];
    }
    const strategy = readRequiredEnum(raw.strategy, locatorStrategies, `${hintPath}.strategy`, issues);
    const hintValue = readRequiredString(raw.value, `${hintPath}.value`, issues);
    return strategy && hintValue ? [{ strategy, value: hintValue }] : [];
  });
  return hints.length > 0 ? hints : undefined;
}

function readFlows(
  value: unknown,
  elementIds: Set<string>,
  issues: InteractionSpecValidationIssue[],
): SpecFlow[] {
  if (!Array.isArray(value)) {
    issues.push({ path: '$.flows', message: 'must be an array.' });
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((raw, index) => {
    const path = `$.flows[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ path, message: 'must be an object.' });
      return [];
    }

    const id = readRequiredString(raw.id, `${path}.id`, issues);
    const name = readRequiredString(raw.name, `${path}.name`, issues);
    if (id) {
      if (seen.has(id)) issues.push({ path: `${path}.id`, message: `duplicates flow id '${id}'.` });
      seen.add(id);
    }
    const steps = readSteps(raw.steps, `${path}.steps`, elementIds, issues);
    const expectedOutcome = readAssertions(raw.expectedOutcome, `${path}.expectedOutcome`, elementIds, issues);
    return id && name ? [{ id, name, steps, expectedOutcome }] : [];
  });
}

function readSteps(
  value: unknown,
  path: string,
  elementIds: Set<string>,
  issues: InteractionSpecValidationIssue[],
): SpecStep[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'must be an array.' });
    return [];
  }

  return value.flatMap((raw, index) => {
    const stepPath = `${path}[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ path: stepPath, message: 'must be an object.' });
      return [];
    }
    const action = readRequiredEnum(raw.action, stepActions, `${stepPath}.action`, issues);
    const target = readTarget(raw.target, `${stepPath}.target`, elementIds, issues);
    if (!action || !target) return [];
    if (action === 'type' || action === 'select') {
      const stepValue = readRequiredString(raw.value, `${stepPath}.value`, issues);
      return stepValue ? [{ action, target, value: stepValue }] : [];
    }
    return [{ action, target } as SpecStep];
  });
}

function readAssertions(
  value: unknown,
  path: string,
  elementIds: Set<string>,
  issues: InteractionSpecValidationIssue[],
): SpecAssertion[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'must be an array when provided.' });
    return undefined;
  }

  const assertions: SpecAssertion[] = value.flatMap<SpecAssertion>((raw, index) => {
    const assertionPath = `${path}[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ path: assertionPath, message: 'must be an object.' });
      return [];
    }
    const kind = readRequiredEnum(raw.kind, assertionKinds, `${assertionPath}.kind`, issues);
    if (!kind) return [];

    if (kind === 'route') {
      const equals = readRequiredString(raw.equals, `${assertionPath}.equals`, issues);
      return equals ? [{ kind, equals }] : [];
    }
    if (kind === 'mockCalled') {
      const endpoint = readRequiredString(raw.endpoint, `${assertionPath}.endpoint`, issues);
      return endpoint ? [{ kind, endpoint, method: readOptionalString(raw.method) }] : [];
    }
    if (kind === 'state') {
      const statePath = readRequiredString(raw.path, `${assertionPath}.path`, issues);
      return statePath ? [{ kind, path: statePath, equals: raw.equals }] : [];
    }

    const target = readTarget(raw.target, `${assertionPath}.target`, elementIds, issues);
    if (!target) return [];
    if (kind === 'text') {
      return [{ kind, target, equals: readOptionalString(raw.equals), contains: readOptionalString(raw.contains) }];
    }
    return [{ kind, target }];
  });
  return assertions.length > 0 ? assertions : undefined;
}

function readTarget(
  value: unknown,
  path: string,
  elementIds: Set<string>,
  issues: InteractionSpecValidationIssue[],
): string | undefined {
  const target = readRequiredString(value, path, issues);
  if (target && !elementIds.has(target)) {
    issues.push({ path, message: `references unknown element id '${target}'.` });
  }
  return target;
}

function readApp(value: unknown): InteractionSpec['app'] {
  if (!isRecord(value)) return undefined;
  return {
    platform: value.platform === 'flutter' ? 'flutter' : undefined,
    route: readOptionalString(value.route),
    screenName: readOptionalString(value.screenName),
  };
}

function readInitialState(value: unknown): InteractionSpec['initialState'] {
  if (!isRecord(value)) return undefined;
  return {
    route: readOptionalString(value.route),
    mockProfile: readOptionalString(value.mockProfile),
    riverpodOverrides: Array.isArray(value.riverpodOverrides) ? value.riverpodOverrides : undefined,
    storageSeed: isRecord(value.storageSeed) ? value.storageSeed : undefined,
    authState: value.authState === 'guest' || value.authState === 'authenticated' ? value.authState : undefined,
  };
}

function readRequiredString(
  value: unknown,
  path: string,
  issues: InteractionSpecValidationIssue[],
): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  issues.push({ path, message: 'must be a non-empty string.' });
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readRequiredEnum<T extends string>(
  value: unknown,
  allowed: Set<T>,
  path: string,
  issues: InteractionSpecValidationIssue[],
): T | undefined {
  if (typeof value === 'string' && allowed.has(value as T)) return value as T;
  issues.push({ path, message: `must be one of ${[...allowed].join(', ')}.` });
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
