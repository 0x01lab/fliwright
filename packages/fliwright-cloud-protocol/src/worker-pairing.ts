import { z } from 'zod';
import { idSchema } from './contracts.js';
/** A short-lived enrollment secret; separators and case are presentation only. */
export const workerPairCodeSchema = z.string().max(64).transform(value => value.replaceAll('-', '').trim().toUpperCase()).pipe(z.string().regex(/^[A-F0-9]{20}$/));
export const workerPairingRequestSchema = z.object({ workerId: idSchema }).strict();
export const workerPairingStatusSchema = z.object({
  id: idSchema,
  workerId: idSchema,
  expiresAt: z.number().int(),
  state: z.enum(['pending', 'paired', 'expired', 'revoked']),
}).strict();
export const workerPairingCreatedSchema = workerPairingStatusSchema.extend({ code: z.string() });
export const workerPairingRedeemSchema = z.object({ code: workerPairCodeSchema }).strict();
export const workerPairingCredentialSchema = z.object({ workerId: idSchema, token: z.string().min(32).max(256) }).strict();
export type WorkerPairingStatus = z.infer<typeof workerPairingStatusSchema>;
