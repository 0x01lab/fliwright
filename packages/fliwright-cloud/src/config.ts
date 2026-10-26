import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { targetSchema, workerSchema } from '@fliwright/cloud-protocol';
const secret = z
  .string()
  .min(1)
  .transform((value) => {
    const actual = value.startsWith('env:')
      ? process.env[value.slice(4)]
      : value;
    if (!actual || actual.length < 16)
      throw new Error('Configured secret must contain at least 16 characters');
    return actual;
  });
export const serverConfigSchema = z
  .object({
    dataRoot: z.string().min(1),
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(4780),
    publicUrl: z.string().url(),
    localUser: z.string().min(1).optional(),
    proxySecret: secret,
    publicationSecret: secret,
    users: z.record(z.enum(['member', 'operator', 'admin'])),
    ciTokens: z.array(
      z.object({
        name: z.string().min(1),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    ),
    workerTokens: z.array(
      z.object({
        workerId: z.string(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    ).default([]),
    targets: z.array(targetSchema).default([]),
    repositoryHosts: z.array(z.string().min(1).max(253)).default([]),
    workers: z.array(workerSchema).default([]),
    retentionDays: z.number().int().min(1).max(365).default(30),
    minFreeBytes: z
      .number()
      .int()
      .nonnegative()
      .default(1024 ** 3),
    maxStorageBytes: z
      .number()
      .int()
      .positive()
      .default(100 * 1024 ** 3),
  })
  .strict()
  .superRefine((config, context) => {
    if (!config.localUser) return;
    const url = new URL(config.publicUrl);
    if (!['127.0.0.1', '::1'].includes(config.host) ||
        !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
        !['http:', 'https:'].includes(url.protocol) ||
        !Object.hasOwn(config.users, config.localUser)) {
      context.addIssue({ code: 'custom', message: 'localUser requires a loopback host, loopback publicUrl and a registered user' });
    }
  });

/** Explicit path wins over the environment; relative data paths belong to the config directory. */
export function loadServerConfig(path?: string) {
  const configPath = resolve(path || process.env.FLIWRIGHT_CLOUD_CONFIG || '.fliwright/cloud/server.json');
  const config = serverConfigSchema.parse(loadJson(configPath));
  return { ...config, dataRoot: resolve(dirname(configPath), config.dataRoot) };
}
export const clientConfigSchema = z
  .object({
    serverUrl: z.string().url(),
    tokenEnv: z.string().min(1),
    pollMs: z.number().int().min(500).default(2000),
    waitTimeoutMs: z.number().int().positive().default(3600000),
  })
  .strict();
export const loadJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));
export function credential(name: string) {
  const token = process.env[name];
  if (!token || token.length < 16)
    throw new Error(`Missing service credential in ${name}`);
  return token;
}
