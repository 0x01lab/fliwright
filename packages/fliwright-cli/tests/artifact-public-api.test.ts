import { expect, it } from 'vitest';
import { artifactReferences } from '../src/run.js';

it('exposes schema-owned references for portable report consumers without treating source and metadata as evidence', () => {
  const document = { nodes: [{ artifacts: [{ path: 'artifacts/screenshot.png' }], codeRef: { file: '/source/test.ts' }, metadata: { path: '/business/api' } }] };
  const references = artifactReferences(document, 'timeline');
  expect(references.map(ref => ref.path)).toEqual(['artifacts/screenshot.png']);
  references[0].set('rewritten.png');
  expect(document.nodes[0].artifacts[0].path).toBe('rewritten.png');
});
