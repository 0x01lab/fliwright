import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

it('runs the Cloud CLI without loading the host Worker runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-isolation-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    symlinkSync(
      fileURLToPath(new URL('../node_modules', import.meta.url)),
      join(root, 'node_modules'),
    );
    const source = fileURLToPath(new URL('../src', import.meta.url));
    for (const name of readdirSync(source).filter((name) =>
      name.endsWith('.ts'),
    )) {
      writeFileSync(
        join(root, name.replace(/\.ts$/, '.js')),
        ts.transpileModule(readFileSync(join(source, name), 'utf8'), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
        }).outputText,
      );
    }
    writeFileSync(
      join(root, 'isolate.mjs'),
      `import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, next) {
        if (specifier === '@fliwright/devices' || specifier === '@fliwright/cloud-worker' || ['worker.js', 'WorkerAgent.js', 'executor.js', 'device-reporting.js'].includes(specifier.split('/').at(-1)))
          throw new Error('Cloud cannot load host runtime: ' + specifier);
        return next(specifier, context);
      }});`,
    );
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        join(root, 'isolate.mjs'),
        join(root, 'main.js'),
        'hash-token',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, FLIWRIGHT_CLOUD_TOKEN: 'synthetic-cloud-token' },
      },
    );
    expect(output.trim()).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
