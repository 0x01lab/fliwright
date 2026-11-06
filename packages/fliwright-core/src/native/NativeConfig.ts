import { z } from 'zod';

/** Runtime configuration; machine device IDs belong in local runtime config. */
export interface NativeConfig {
  enabled: boolean;
  platform: 'android' | 'ios';
  deviceId: string;
  targetAppId: string;
  backend?: 'adb' | 'xctest';
  systemAppIds?: string[];
  externalAppIds?: string[];
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
  tools?: { adb?: string; apkAnalyzer?: string; xcrun?: string; xcodebuild?: string };
  /** Candidate emulator IDs; these do not certify enrollment or readiness. */
  fingerprints?: { enrolledId: number; unenrolledId: number };
  ios?: { xctestrunPath: string; startupTimeoutMs?: number };
}

const nonempty = z.string().min(1).refine(value => !value.includes('\0'), 'NUL is not allowed');
const positiveMs = z.number().int().positive().finite();

/** Validate the same contract at config, process and native-session boundaries. */
export const nativeConfigSchema = z.object({
  enabled: z.boolean(), platform: z.enum(['android', 'ios']), deviceId: nonempty,
  targetAppId: nonempty, backend: z.enum(['adb', 'xctest']).optional(),
  systemAppIds: z.array(nonempty).optional(), externalAppIds: z.array(nonempty).optional(),
  timeoutMs: positiveMs.optional(), cleanupTimeoutMs: positiveMs.optional(),
  tools: z.object({ adb: nonempty.optional(), apkAnalyzer: nonempty.optional(), xcrun: nonempty.optional(), xcodebuild: nonempty.optional() }).strict().optional(),
  fingerprints: z.object({ enrolledId: z.number().int().min(1).max(10), unenrolledId: z.number().int().min(1).max(10) }).strict().refine(value => value.enrolledId !== value.unenrolledId, 'Fingerprint IDs must differ').optional(),
  ios: z.object({ xctestrunPath: nonempty, startupTimeoutMs: positiveMs.optional() }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.backend && value.backend !== (value.platform === 'android' ? 'adb' : 'xctest')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['backend'], message: 'Native backend must match the selected platform' });
  }
});
