import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../../../.agents/skills/', import.meta.url);
const target = new URL('../dist/skills/', import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of ['fliwright-cli-workflows', 'fliwright-agent-memory', 'write-fliwright-tests', 'write-fliwright-mock-rules']) {
  await cp(fileURLToPath(new URL(`${name}/`, source)), fileURLToPath(new URL(`${name}/`, target)), { recursive: true });
}
console.log('Bundled project automation Skills with the CLI.');
