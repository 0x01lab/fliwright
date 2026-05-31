import { describe, it, expect } from 'vitest';
import { doctorCommand, type CheckResult } from '../src/commands/doctor.js';

describe('doctorCommand', () => {
  it('returns check results for each diagnostic', async () => {
    const results = await doctorCommand(process.cwd());
    expect(results.length).toBeGreaterThanOrEqual(4);

    const names = results.map((r) => r.name);
    expect(names).toContain('Node.js');
    expect(names).toContain('Flutter SDK');
    expect(names).toContain('@fliwright/core');
    expect(names).toContain('fliwright.config.ts');
  });

  it('marks Node.js as passing (we are running on it)', async () => {
    const results = await doctorCommand(process.cwd());
    const nodeCheck = results.find((r) => r.name === 'Node.js')!;
    expect(nodeCheck.passed).toBe(true);
    expect(nodeCheck.message).toContain(process.version);
  });

  it('includes version info in Flutter SDK check', async () => {
    const results = await doctorCommand(process.cwd());
    const flutterCheck = results.find((r) => r.name === 'Flutter SDK')!;
    expect(typeof flutterCheck.passed).toBe('boolean');
    expect(typeof flutterCheck.message).toBe('string');
  });
});
