import { expect, it } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('reports native cleanup, binding, disabled configuration and timeout failures without aborting peers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-fixture-failures-'));
  try {
    const eventsPath = join(root, 'events.jsonl');
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default {root:${JSON.stringify(root)},test:{include:['.fliwright/tests/probe.test.mjs'],
      runner:${JSON.stringify(resolve(import.meta.dirname, '../src/runner.ts'))},maxWorkers:1,reporters:['dot']}};`);
    await writeFile(join(root, '.fliwright/tests/probe.test.mjs'), `
      import {createFliwrightTest} from ${JSON.stringify(resolve(import.meta.dirname, '../src/index.ts'))};
      import {NativeRuntime,NativeError} from ${JSON.stringify(import.meta.resolve('@fliwright/core'))};
      import {appendFile} from 'node:fs/promises';
      import {expect,aroundEach} from 'vitest';
      aroundEach(async(run,{task,skip})=>{if(task.name==='around skip owner failure')skip();await run();});
      const log=(phase,id)=>appendFile(${JSON.stringify(eventsPath)},JSON.stringify({phase,id})+'\\n');
      function testFor(id, {binding=true,cleanup=true,ownerCleanup=true,enabled=true}={}) {
        return createFliwrightTest({vmServiceUrl:'ws://native-failure/ws',native:{enabled,platform:'android',deviceId:'chosen',targetAppId:'example.app'},
          recording:{mode:'off'},requireAssertions:false,log:{format:'silent'},runsRoot:${JSON.stringify(join(root, 'runs'))}}, {
          driverProvider:async()=>({sendRequest:async()=>({pid:4242}),getDiagnostics:()=>[],healing:{getReports:()=>[]},
            dispose:async()=>log('driver-close',id)}),
          nativeDeviceProvider:async()=>{
            await log('owner-open',id);
            return {verifyAppProcess:async()=>{if(!binding)throw new NativeError('device_mismatch','wrong selected device');},
              createRuntime:async(options)=>new NativeRuntime({identity:{platform:'android',deviceId:'chosen',appId:'example.app',backend:'probe',generation:id},
                capabilities:async()=>({}),snapshot:async()=>{},execute:async()=>{},screenshot:async()=>Buffer.alloc(0),
                dispose:async()=>{await log('adapter-close',id);if(!cleanup)throw new NativeError('cleanup_failed','owned runner remains active');}}, options.runtime),
              dispose:async()=>{await log('owner-close',id);if(!ownerCleanup)throw new NativeError('cleanup_failed','device ownership release failed');}};
          }
        });
      }
      testFor('cleanup',{cleanup:false,ownerCleanup:false})('cleanup fails',async({native})=>{await log('body','cleanup');expect(native).toBeDefined();});
      testFor('after-cleanup')('after cleanup failure',async({native})=>{await log('body','after-cleanup');expect(native).toBeDefined();});
      testFor('binding',{binding:false})('binding fails',async({native})=>{await log('body','binding');});
      testFor('disabled',{enabled:false})('disabled fixture',async({native})=>{await log('body','disabled');});
      testFor('timeout')('body timeout',{timeout:30},async({native})=>{await log('body','timeout');await new Promise(()=>{});});
      testFor('after-timeout')('after timeout',async({native})=>{await log('body','after-timeout');expect(native).toBeDefined();});
      testFor('owner',{ownerCleanup:false})('owner release fails',async({native})=>{await log('body','owner');expect(native).toBeDefined();});
      testFor('skip-owner',{ownerCleanup:false})('skip owner failure',async({native,skip})=>{expect(native).toBeDefined();skip();});
      testFor('around-skip-owner',{ownerCleanup:false})('around skip owner failure',async({native})=>{throw new Error('must not run');});
      testFor('skip-adapter',{cleanup:false})('skip adapter failure',async({native,skip})=>{expect(native).toBeDefined();skip();});
      testFor('after-owner')('after owner failure',async({native})=>{await log('body','after-owner');expect(native).toBeDefined();});
    `);
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../node_modules/vitest/vitest.mjs'), 'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        FLIWRIGHT_CONFIG_PATH: '', FLIWRIGHT_RECORDING_MODE: '', FLIWRIGHT_DEFAULT_SCENARIO: '', FLIWRIGHT_SCENARIO_MODE: '',
        FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_RUN_ID: 'native-failures', FLIWRIGHT_SESSION_RESULTS_PATH: join(root, 'sessions.jsonl') },
    });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode); });
    expect(code, output).toBe(1);
    expect(stripVTControlCharacters(output)).toContain('8 failed | 3 passed');
    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(item => item.phase === 'body').map(item => item.id)).toEqual(['cleanup', 'after-cleanup', 'timeout', 'after-timeout', 'owner', 'after-owner']);
    expect(events.filter(item => item.phase === 'owner-open')).toHaveLength(10);
    expect(events.filter(item => item.phase === 'owner-close')).toHaveLength(10);
    expect(events.filter(item => item.phase === 'driver-close' && item.id === 'binding')).toHaveLength(1);
    const results = (await readFile(join(root, 'sessions.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(results).toHaveLength(11);
    expect(results.find(result => result.testName === 'cleanup fails')).toMatchObject({ testOutcome: 'failed', attemptOutcome: 'failed', finalized: true });
    expect(results.find(result => result.testName === 'after timeout')).toMatchObject({ testOutcome: 'passed', finalized: true });
    expect(results.find(result => result.testName === 'owner release fails')).toMatchObject({ testOutcome: 'failed', attemptOutcome: 'failed', finalized: true });
    expect(results.find(result => result.testName === 'skip owner failure')).toMatchObject({ testOutcome: 'failed', attemptOutcome: 'failed', finalized: true });
    expect(results.find(result => result.testName === 'around skip owner failure')).toMatchObject({ testOutcome: 'failed', attemptOutcome: 'failed', finalized: true });
    expect(results.find(result => result.testName === 'skip adapter failure')).toMatchObject({ testOutcome: 'failed', attemptOutcome: 'failed', finalized: true });
    expect(results.find(result => result.testName === 'cleanup fails').runnerErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'owned runner remains active' }),
      expect.objectContaining({ message: 'device ownership release failed' }),
    ]));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);
