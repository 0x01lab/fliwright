import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { commandSchema, targetSchema, workerSchema } from './contracts.js';
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
    ),
    targets: z.array(targetSchema),
    workers: z.array(workerSchema),
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
  .strict();
export const workerConfigSchema = z
  .object({
    serverUrl: z.string().url(),
    tokenEnv: z.string().min(1),
    workerId: z.string().min(1),
    slotId: z.string().min(1),
    deviceId: z.string().min(1),
    root: z.string().min(1),
    flutterBin: z.string().default('flutter'),
    resetCommands: z
      .array(
        commandSchema.extend({
          acceptExitCodes: z.array(z.number().int()).optional(),
        }),
      )
      .min(1),
    allowedEnv: z.array(z.string()).default([]),
    pollMs: z.number().int().min(500).default(2000),
    heartbeatMs: z.number().int().min(500).max(10000).default(5000),
  })
  .strict();
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
