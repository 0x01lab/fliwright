import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { commandSchema } from '@fliwright/cloud-protocol';
export const workerConfigSchema = z
  .object({
    serverUrl: z.string().url(),
    tokenEnv: z.string().min(1),
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
    allowedEnv: z.array(z.string()).default([]),
    pollMs: z.number().int().min(500).default(2000),
    heartbeatMs: z.number().int().min(500).max(10000).default(5000),
  })
  .strict();
/** Host-only discovery uses the authenticated Worker identity, without an executor. */
export const discoveryConfigSchema = workerConfigSchema.pick({
  serverUrl: true,
  tokenEnv: true,
  deviceTools: true,
});
export const loadJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));
export function credential(name: string) {
  const token = process.env[name];
  if (!token || token.length < 16)
    throw new Error(`Missing service credential in ${name}`);
  return token;
}
