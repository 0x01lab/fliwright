import { expect, it } from 'vitest';
import { catalogTree } from '../src/testing/TestCatalogTree.js';

it('preserves nested title paths, literal separators, duplicate tests and test/group name collisions', () => {
  expect(catalogTree([
    { titlePath: ['suite / [USD]', 'same'] }, { titlePath: ['suite / [USD]', 'same'] },
    { titlePath: ['suite / [USD]', 'nested', 'case'] }, { titlePath: ['suite / [USD]'] },
  ])).toEqual({ nodes: [
    { kind: 'group', title: 'suite / [USD]', children: [
      { kind: 'test', title: 'same' }, { kind: 'test', title: 'same' },
      { kind: 'group', title: 'nested', children: [{ kind: 'test', title: 'case' }] },
    ] },
    { kind: 'test', title: 'suite / [USD]' },
  ] });
});
