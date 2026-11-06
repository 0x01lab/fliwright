import { collectTestCases } from '@fliwright/cli/run';
import { catalogTree } from './TestCatalogTree.js';

export const catalogResultMarker = 'FLIWRIGHT_EDITOR_CATALOG=';

try {
  const { cwd, files } = JSON.parse(process.argv[2]) as { cwd: string; files: string[] };
  const patterns = files.map(file => file.replace(/([*?\[\]{}()!+@])/g, '\\$1'));
  const catalog = await collectTestCases({ cwd, patterns });
  const byFile = new Map(catalog.map(file => [file.file, file]));
  const results = Object.fromEntries(files.map(file => {
    const collected = byFile.get(file);
    return [file, collected?.errors.length ? { nodes: [], error: collected.errors.join('\n') }
      : catalogTree(collected?.cases ?? [])];
  }));
  process.stdout.write(`\n${catalogResultMarker}${JSON.stringify({ files: results })}\n`);
  // Vitest marks module errors on process.exitCode; per-file errors are in the response.
  process.exitCode = 0;
} catch (error) {
  const messages: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const detail = typeof current === 'object' ? current as { message?: string; cause?: unknown } : undefined;
    messages.push(detail?.message ?? (detail ? JSON.stringify(detail) : String(current)));
    current = detail?.cause;
  }
  process.stderr.write(messages.join('\n') + '\n');
  process.exitCode = 1;
}
