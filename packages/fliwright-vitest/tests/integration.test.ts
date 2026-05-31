import { describe, it, expect } from 'vitest';
import { Assertion, Locator } from '@fliwright/core';
import {
  createFliwrightTest,
  defineConfig,
  expect as fliwrightExpect,
  test as fliwrightTest,
} from '../src/index.js';

describe('createFliwrightTest', () => {
  it('creates a test function with page fixture', () => {
    const test = createFliwrightTest({
      vmServiceUrl: 'ws://localhost:12345/ws',
    });
    expect(test).toBeDefined();
    expect(typeof test).toBe('function');
  });

  it('exports a default test function for generated tests', () => {
    expect(fliwrightTest).toBeDefined();
    expect(typeof fliwrightTest).toBe('function');
  });

  it('exports a fliwright expect function', () => {
    const locator = new Locator('text=Login', async () => ({ widgets: [] }));
    const assertion = fliwrightExpect(locator);
    expect(assertion).toBeInstanceOf(Assertion);
  });

  it('defineConfig merges defaults', () => {
    const config = defineConfig({
      vmServiceUrl: 'ws://localhost:12345/ws',
      timeout: 10000,
    });
    expect(config.vmServiceUrl).toBe('ws://localhost:12345/ws');
    expect(config.timeout).toBe(10000);
    expect(config.screenshot).toBe('file');
  });
});
