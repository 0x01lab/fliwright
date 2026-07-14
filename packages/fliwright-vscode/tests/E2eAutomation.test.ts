import { describe, expect, it } from 'vitest';
import {
  applyE2eAutomationEnv,
  formatE2eAutomationDartDefines,
  mergeE2eAutomationDartDefineArgs,
} from '../src/automation/E2eAutomation.js';

describe('E2eAutomation', () => {
  it('adds Exio automation environment variables when enabled', () => {
    expect(applyE2eAutomationEnv({}, true)).toMatchObject({
      FLIWRIGHT_E2E_AUTOMATION: 'true',
      EXIO_AUTOMATION: 'true',
      EXIO_DISABLE_ALIYUN_CAPTCHA: 'true',
    });
  });

  it('does not change environment variables when disabled', () => {
    const env = { EXIO_AUTOMATION: 'false' };
    expect(applyE2eAutomationEnv(env, false)).toBe(env);
  });

  it('formats dart define guidance for Flutter launches', () => {
    expect(formatE2eAutomationDartDefines()).toBe(
      '--dart-define=EXIO_E2E_AUTOMATION=true --dart-define=EXIO_DISABLE_ALIYUN_CAPTCHA=true',
    );
  });

  it('upserts dart defines without duplicating existing keys', () => {
    expect(mergeE2eAutomationDartDefineArgs([
      '--flavor',
      'dev',
      '--dart-define',
      'EXIO_ENV=dev',
      '--dart-define=EXIO_DISABLE_ALIYUN_CAPTCHA=false',
    ])).toEqual([
      '--flavor',
      'dev',
      '--dart-define',
      'EXIO_ENV=dev',
      '--dart-define',
      'EXIO_E2E_AUTOMATION=true',
      '--dart-define',
      'EXIO_DISABLE_ALIYUN_CAPTCHA=true',
    ]);
  });
});
