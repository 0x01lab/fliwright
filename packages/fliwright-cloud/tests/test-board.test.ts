import { expect, it } from 'vitest';
import type { TestRequest } from '@fliwright/cloud-protocol';
import { testColumn, type TestColumn } from '../src/web/TestBoard.js';

it.each<[TestRequest['state'], TestRequest['verdict'], TestColumn]>([
  ['queued', 'unknown', 'pending'],
  ['assigned', 'unknown', 'running'],
  ['preparing', 'unknown', 'running'],
  ['running', 'failed', 'running'],
  ['finalizing', 'passed', 'running'],
  ['cancel_requested', 'passed', 'running'],
  ['completed', 'passed', 'passed'],
  ['completed', 'failed', 'failed'],
  ['infrastructure_failed', 'unknown', 'failed'],
  ['infrastructure_failed', 'passed', 'failed'],
  ['cancelled', 'passed', 'other'],
  ['completed', 'skipped', 'other'],
  ['completed', 'interrupted', 'other'],
  ['completed', 'unknown', 'other'],
])('places %s / %s in %s without mistaking an early verdict for a finished run', (state, verdict, column) => {
  expect(testColumn({ state, verdict })).toBe(column);
});
