export const E2E_AUTOMATION_ENV = {
  FLIWRIGHT_E2E_AUTOMATION: 'true',
  EXIO_AUTOMATION: 'true',
  EXIO_DISABLE_ALIYUN_CAPTCHA: 'true',
} as const;

export const E2E_AUTOMATION_DART_DEFINES = [
  'EXIO_E2E_AUTOMATION=true',
  'EXIO_DISABLE_ALIYUN_CAPTCHA=true',
] as const;

export function applyE2eAutomationEnv(env: NodeJS.ProcessEnv, enabled?: boolean): NodeJS.ProcessEnv {
  if (!enabled) return env;
  return {
    ...env,
    ...E2E_AUTOMATION_ENV,
  };
}

export function formatE2eAutomationDartDefines(): string {
  return E2E_AUTOMATION_DART_DEFINES
    .map((entry) => `--dart-define=${entry}`)
    .join(' ');
}

export function mergeE2eAutomationDartDefineArgs(toolArgs: readonly unknown[] | undefined): string[] {
  const existing = Array.isArray(toolArgs) ? toolArgs.map((entry) => String(entry)) : [];
  const automationKeys = new Set(E2E_AUTOMATION_DART_DEFINES.map((define) => defineKey(define)));
  const args: string[] = [];
  for (let index = 0; index < existing.length; index += 1) {
    const entry = existing[index];
    if (entry.startsWith('--dart-define=')) {
      const define = entry.slice('--dart-define='.length);
      if (automationKeys.has(defineKey(define))) continue;
    }
    if (entry === '--dart-define' && automationKeys.has(defineKey(existing[index + 1] ?? ''))) {
      index += 1;
      continue;
    }
    args.push(entry);
  }
  for (const define of E2E_AUTOMATION_DART_DEFINES) {
    args.push('--dart-define', define);
  }
  return args;
}

function defineKey(define: string): string {
  return define.split('=')[0];
}
