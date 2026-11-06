import { expect, it } from 'vitest';
import { getAndroidScenarioPermissions, parseAndroidPermissionDeclarations, assertAndroidPermissionDeclaration } from '../../src/native/AndroidPermissionDeclaration.js';
import { ScenarioResolver, type TestScenario } from '../../src/Scenario.js';

it('extracts a complete declaration from the resolved inherited scene and snapshots its values', () => {
  const base: TestScenario = { name: 'base', layers: [{ kind: 'device', permissions: [{ permission: 'camera', state: 'prompt' }] }] };
  const resolved = new ScenarioResolver({ base, photo: { name: 'photo', extends: ['base'], layers: [{ kind: 'app', capability: 'photo', method: 'reset' }] } }).resolve('photo');
  const declaration = getAndroidScenarioPermissions(resolved);
  base.layers[0] = { kind: 'device', permissions: [] };
  expect(declaration).toEqual([{ permission: 'camera', state: 'prompt' }]);
  expect(getAndroidScenarioPermissions()).toEqual([]);
  expect(getAndroidScenarioPermissions({ name: 'ordinary', layers: [] })).toEqual([]);
  expect(getAndroidScenarioPermissions({ name: 'empty', layers: [{ kind: 'device', permissions: [] }] })).toEqual([]);
  expect(() => getAndroidScenarioPermissions({ name: 'duplicate', layers: [{ kind: 'device' }, { kind: 'device' }] })).toThrow();
  expect(() => getAndroidScenarioPermissions({ name: 'invalid', layers: [{ kind: 'device', permissions: null as never }] })).toThrow();
});

it.each([null, {}, new Array(1), [{ permission: 'photos', state: 'granted' }],
  [{ permission: 'camera', state: 'permanent-denied' }], [{ permission: 'camera', state: 'prompt', ready: true }],
  [{ permission: 'camera', state: 'prompt' }, { permission: 'camera', state: 'denied' }],
])('refuses invalid or unsupported full declarations (%j)', value => {
  expect(() => parseAndroidPermissionDeclarations(value)).toThrow();
});

it.each(['granted', 'denied', 'prompt'] as const)('independently verifies declared %s semantics and allows tracked omitted permissions', state => {
  const declaration = [{ permission: 'camera', state }];
  const camera = { permission: 'camera' as const, granted: state === 'granted', userSet: state === 'denied', userFixed: false,
    flags: state === 'denied' ? ['USER_SET'] : [] };
  expect(() => assertAndroidPermissionDeclaration(declaration, [camera,
    { permission: 'microphone', granted: true, userSet: true, userFixed: true, flags: ['USER_SET', 'USER_FIXED'] },
  ])).not.toThrow();
  expect(() => assertAndroidPermissionDeclaration(declaration, [])).toThrow();
  expect(() => assertAndroidPermissionDeclaration(declaration, [{ ...camera, granted: !camera.granted }])).toThrow();
  expect(() => assertAndroidPermissionDeclaration(declaration, [{ ...camera, userFixed: true, flags: [...camera.flags, 'USER_FIXED'] }])).toThrow();
  expect(() => assertAndroidPermissionDeclaration(declaration, [{ ...camera, userSet: !camera.userSet }])).toThrow();
});
