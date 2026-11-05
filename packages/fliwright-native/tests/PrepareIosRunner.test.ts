import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareIosRunner } from '../src/ios/PrepareIosRunner.js';
import type { ToolExecutor } from '../src/ToolExecutor.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-runner-build-')); roots.push(root);
  const sourceRoot = join(root, 'source');
  await mkdir(join(sourceRoot, 'FliwrightRunner.xcodeproj/xcshareddata/xcschemes'), { recursive: true });
  await writeFile(join(sourceRoot, 'FliwrightRunner.swift'), 'import XCTest\n');
  await writeFile(join(sourceRoot, 'RunnerRecoveryControl.swift'), 'import Foundation\n');
  await writeFile(join(sourceRoot, 'FliwrightRunner.xcodeproj/project.pbxproj'), 'project');
  await writeFile(join(sourceRoot, 'FliwrightRunner.xcodeproj/xcshareddata/xcschemes/FliwrightRunner.xcscheme'), 'scheme');
  let xcode = 'Xcode 26.6\nBuild version ABC';
  const executor = vi.fn<ToolExecutor>(async (_program, args) => {
    if (args.includes('--show-sdk-build-version')) return Buffer.from('SDK123');
    if (args.includes('-version')) return Buffer.from(xcode);
    const products = join(args[args.indexOf('-derivedDataPath') + 1], 'Build/Products');
    const runner = join(products, 'Debug-iphonesimulator/FliwrightRunner-Runner.app');
    await mkdir(join(runner, 'PlugIns/FliwrightRunner.xctest'), { recursive: true });
    await writeFile(join(runner, 'FliwrightRunner-Runner'), 'executable');
    await writeFile(join(runner, 'PlugIns/FliwrightRunner.xctest/FliwrightRunner'), 'test-bundle');
    await writeFile(join(products, 'FliwrightRunner_iphonesimulator.xctestrun'), 'product');
    return Buffer.alloc(0);
  });
  return { sourceRoot, cacheRoot: join(root, 'cache'), executor, changeXcode: () => { xcode += 'changed'; } };
}

describe('explicit iOS Runner preparation', () => {
  it('invalidates prepared products when the recovery protocol source changes', async () => {
    const options = await setup();
    const original = await prepareIosRunner(options);
    await writeFile(join(options.sourceRoot, 'RunnerRecoveryControl.swift'), 'import Foundation\n// changed recovery protocol\n');
    expect((await prepareIosRunner(options)).cacheKey).not.toBe(original.cacheKey);
  });
  it('rebuilds a cache whose test executable was removed', async () => {
    const options = await setup();
    const product = await prepareIosRunner(options);
    await rm(join(options.cacheRoot, product.cacheKey, 'Build/Products/Debug-iphonesimulator/FliwrightRunner-Runner.app/PlugIns/FliwrightRunner.xctest/FliwrightRunner'));
    expect((await prepareIosRunner(options)).cached).toBe(false);
  });
  it('builds once, shares a complete cache across callers and invalidates source/toolchain changes', async () => {
    const options = await setup();
    const [one, two] = await Promise.all([prepareIosRunner(options), prepareIosRunner(options)]);
    expect(one.xctestrunPath).toBe(two.xctestrunPath);
    expect(options.executor.mock.calls.filter(([, args]) => args.includes('build-for-testing'))).toHaveLength(1);
    expect(one.cacheKey).toBe(two.cacheKey);
    await writeFile(join(options.sourceRoot, 'FliwrightRunner.swift'), 'import XCTest\n// new protocol\n');
    const changed = await prepareIosRunner(options);
    expect(changed.cacheKey).not.toBe(one.cacheKey);
    options.changeXcode();
    expect((await prepareIosRunner(options)).cacheKey).not.toBe(changed.cacheKey);
  });

  it('does not cache failed builds or publish incomplete products', async () => {
    const options = await setup();
    const normal = options.executor.getMockImplementation()!;
    options.executor.mockImplementation(async (...args) => {
      if (args[1].includes('build-for-testing')) throw new Error('build failed');
      return normal(...args);
    });
    await expect(prepareIosRunner(options)).rejects.toThrow('build failed');
    options.executor.mockImplementation(normal);
    expect((await prepareIosRunner(options)).cached).toBe(false);
  });

  it('checks cancellation and invalid budgets before launching tools', async () => {
    const options = await setup();
    await expect(prepareIosRunner({ ...options, timeoutMs: 0 })).rejects.toMatchObject({ code: 'precondition_failed' });
    await expect(prepareIosRunner({ ...options, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'cancelled' });
    expect(options.executor).not.toHaveBeenCalled();
  });
});
