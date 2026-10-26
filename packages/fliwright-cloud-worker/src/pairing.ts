import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { workerPairCodeSchema, workerPairingCredentialSchema } from '@fliwright/cloud-protocol';

/** Enroll once and save supervisor-only credentials in a new private directory. */
export async function pairWorker(serverUrl: string, code: string, directory: string): Promise<string> {
  const url = new URL(serverUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Pairing requires an HTTPS server origin (HTTP is allowed on loopback only)');
  const normalizedCode = workerPairCodeSchema.parse(code);
  const destination = resolve(directory);
  // Exclusive mkdir checks the destination before consuming a one-time code.
  mkdirSync(destination, { mode: 0o700 });
  try {
    const response = await fetch(`${url.origin}/api/worker/pair`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: normalizedCode }),
    });
    if (!response.ok) throw new Error('Pairing rejected');
    const saved = workerPairingCredentialSchema.parse(await response.json());
    const credentialFile = join(destination, 'credentials.json');
    writeFileSync(credentialFile, JSON.stringify({ serverUrl: url.origin, ...saved }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    const configPath = join(destination, 'worker.json');
    writeFileSync(configPath, JSON.stringify({ serverUrl: url.origin, credentialFile }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return configPath;
  } catch {
    // Do not expose server bodies, tokens, or raw fetch diagnostics. No automatic retry.
    throw new Error('Pairing failed. Revoke the pairing in Cloud and generate a new code; use a new local directory.');
  }
}
