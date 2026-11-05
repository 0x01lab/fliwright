import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { workerPairingCredentialSchema, commandSchema } from '@fliwright/cloud-protocol';
import { defaultSpoolRetention } from './spool.js';
const spoolRetentionSchema = z.object({
  maxAttempts: z.number().int().positive().default(defaultSpoolRetention.maxAttempts),
  maxAgeHours: z.number().positive().default(defaultSpoolRetention.maxAgeHours),
  maxBytes: z.number().int().positive().default(defaultSpoolRetention.maxBytes),
  maxFiles: z.number().int().positive().default(defaultSpoolRetention.maxFiles),
}).strict().default({});
const workerConfigObject = z
  .object({
    serverUrl: z.string().url(),
    tokenEnv: z.string().min(1).optional(),
    credentialFile: z.string().refine(isAbsolute, 'Credential path must be absolute').optional(),
    workerId: z.string().min(1),
    slotId: z.string().min(1),
    deviceId: z.string().min(1),
    root: z.string().min(1),
    flutterBin: z.string().default('flutter'),
    deviceTools: z
      .object({
        adb: z.string().min(1).optional(),
        emulator: z.string().min(1).optional(),
        xcrun: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    resetCommands: z
      .array(
        commandSchema.extend({
          acceptExitCodes: z.array(z.number().int()).optional(),
        }),
      )
      .min(1),
    repositoryCredentialHomes: z.record(z.string().min(1)).default({}),
    allowedEnv: z.array(z.string()).default([]),
    heartbeatMs: z.number().int().min(500).max(10000).default(5000),
    spoolRetention: spoolRetentionSchema,
  })
  .strict();
export interface WorkerAuthSettings {
  serverUrl: string;
  tokenEnv?: string;
  credentialFile?: string;
  workerId?: string;
}
const hasOneCredential = (config: WorkerAuthSettings) => Boolean(config.tokenEnv) !== Boolean(config.credentialFile);
export const workerConfigSchema = workerConfigObject.refine(hasOneCredential, 'Configure exactly one credential source');
/** Host-only discovery uses the authenticated Worker identity, without an executor. */
export const discoveryConfigSchema = workerConfigObject.pick({
  serverUrl: true,
  tokenEnv: true,
  credentialFile: true,
  deviceTools: true,
}).refine(hasOneCredential, 'Configure exactly one credential source');
/** A paired host follows Cloud device bindings without duplicating slot configuration. */
export const hostConfigSchema = workerConfigObject.pick({
  serverUrl: true, tokenEnv: true, credentialFile: true, deviceTools: true,
  flutterBin: true, repositoryCredentialHomes: true, allowedEnv: true, heartbeatMs: true,
  spoolRetention: true,
}).extend({
  root: z.string().min(1).optional(),
  resetCommands: workerConfigObject.shape.resetCommands.optional(),
}).refine(hasOneCredential, 'Configure exactly one credential source');
export const loadJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));
/** Resolve service credentials only in the supervisor, never in executor jobs. */
export function credential(config: WorkerAuthSettings) {
  if (config.credentialFile) {
    const stat = lstatSync(config.credentialFile);
    if (!stat.isFile() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())))
      throw new Error('Credential file must be private and owned by the current user');
    const saved = workerPairingCredentialSchema.extend({ serverUrl: z.string().url() }).parse(loadJson(config.credentialFile));
    if (new URL(saved.serverUrl).origin !== new URL(config.serverUrl).origin || (config.workerId && saved.workerId !== config.workerId))
      throw new Error('Credential does not belong to this server or Worker');
    return saved.token;
  }
  const token = config.tokenEnv ? process.env[config.tokenEnv] : undefined;
  if (!token || token.length < 16) throw new Error('Missing Worker service credential');
  return token;
}
