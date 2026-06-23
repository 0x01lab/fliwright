import { createFliwrightTest } from '@fliwright/vitest';

let providerCalls = 0;
const driver = {
  page: {},
  mock: {},
  healing: { getReports: () => [] },
  sendRequest: async () => ({}),
  connect: async () => {},
  dispose: async () => {},
  listenToDiagnostics: async () => {},
  getDiagnostics: () => [],
};

const test = createFliwrightTest(
  { vmServiceUrl: 'ws://placeholder/ws', requireAssertions: false, mode: 'script' },
  { driverProvider: async () => {
    providerCalls += 1;
    return driver;
  } },
);

console.log('created test function:', typeof test);
console.log('providerCalls before fixture execution (expected 0):', providerCalls);
console.log('Use packages/fliwright-vitest/tests/create-fliwright-test.driverProvider.test.ts for automated fixture proof.');
