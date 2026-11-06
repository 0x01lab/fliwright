import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Run current production sources in an actual Node process without requiring stale dist. */
export function nativeModuleCompiler(outputRoot: string): (name: string) => Promise<string> {
  const sourceRoot = resolve(import.meta.dirname, '../../src');
  const cache = new Map<string, Promise<string>>();
  const compile = (name: string): Promise<string> => {
    const existing = cache.get(name);
    if (existing) return existing;
    const work = (async () => {
      const path = resolve(sourceRoot, `${name}.ts`);
      let source = ts.transpileModule(await readFile(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      // Temporary output has no node_modules ancestor; resolve production package
      // imports from this package while retaining the real dependency modules.
      source = source.replace(/(\bfrom\s+)(['"])([^.'"/][^'"\n]+)\2/g,
        (_match, prefix: string, _quote: string, specifier: string) =>
          `${prefix}${JSON.stringify(import.meta.resolve(specifier))}`);
      for (const match of [...source.matchAll(/(['"])(\.\.?\/[^'"\n]+)\.js\1/g)]) {
        const dependency = relative(sourceRoot, resolve(dirname(path), match[2]));
        source = source.replaceAll(match[0], JSON.stringify(await compile(dependency)));
      }
      const output = resolve(outputRoot, `${name}.mjs`);
      await mkdir(dirname(output), { recursive: true }); await writeFile(output, source);
      return pathToFileURL(output).href;
    })();
    cache.set(name, work);
    return work;
  };
  return compile;
}
