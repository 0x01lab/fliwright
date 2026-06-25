import { describe, it, expect } from 'vitest';
import {
  decideSync,
  isStructuralFileChange,
  looksStructuralAfterReload,
} from '../../src/daemon/ReloadStrategy.js';

describe('decideSync', () => {
  it('returns none when there are no changes', () => {
    expect(decideSync([])).toBe('none');
    expect(decideSync()).toBe('none');
  });

  it('returns reload for plain Dart body changes', () => {
    expect(decideSync(['lib/features/login/login_page.dart'])).toBe('reload');
    expect(decideSync(['lib/main.dart', 'lib/app.dart'])).toBe('reload');
  });

  it.each([
    'lib/models/user.freezed.dart',
    'lib/api/client.g.dart',
    'lib/router/app_router.gr.dart',
    'test/mocks/mocks.mocks.dart',
    'pubspec.yaml',
    'pubspec.lock',
    'assets/images/logo.png',
    'lib/l10n/app_en.arb',
    'lib/i18n/strings.json',
  ])('returns restart for structural path %s', (path) => {
    expect(decideSync([path])).toBe('restart');
  });

  it('restarts if any change in the set is structural', () => {
    expect(decideSync(['lib/login_page.dart', 'lib/api/client.g.dart'])).toBe('restart');
  });

  it('reloads only when every change is non-structural', () => {
    expect(decideSync(['lib/a.dart', 'lib/b.dart'])).toBe('reload');
  });
});

describe('isStructuralFileChange', () => {
  it('is case-insensitive on generated suffixes', () => {
    expect(isStructuralFileChange('lib/X.G.DART')).toBe(true);
  });
});

describe('looksStructuralAfterReload', () => {
  const base = { status: 'red', lastSync: 'reload' as const };

  it('flags missing-element / state-mismatch / navigation failures after reload', () => {
    expect(looksStructuralAfterReload({ ...base, failureContext: { kind: 'missing-element' } as never })).toBe(true);
    expect(looksStructuralAfterReload({ ...base, failureContext: { kind: 'state-mismatch' } as never })).toBe(true);
    expect(looksStructuralAfterReload({ ...base, failureContext: { kind: 'ambiguous-element' } as never })).toBe(true);
    expect(looksStructuralAfterReload({ ...base, failureContext: { kind: 'navigation-failed' } as never })).toBe(true);
  });

  it('does not flag wrong-text or mock failures', () => {
    expect(looksStructuralAfterReload({ ...base, failureContext: { kind: 'wrong-text' } as never })).toBe(false);
    expect(looksStructuralAfterReload({ ...base, failureContext: { kind: 'mock-not-called' } as never })).toBe(false);
  });

  it('does not flag green results or non-reload syncs', () => {
    expect(looksStructuralAfterReload({ status: 'green', lastSync: 'reload', failureContext: undefined })).toBe(false);
    expect(looksStructuralAfterReload({ ...base, failureContext: { kind: 'missing-element' } as never, lastSync: 'restart' })).toBe(false);
    expect(looksStructuralAfterReload({ status: 'red', lastSync: 'none', failureContext: undefined })).toBe(false);
  });
});
