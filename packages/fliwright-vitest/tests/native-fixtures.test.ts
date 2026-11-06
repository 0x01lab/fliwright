import { describe, expect, it } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('native/device fixtures in a live Vitest worker', () => {
  it('binds the current VM, records native assertions and keeps task ownership through retry and skip', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-fixtures-'));
    const integration = resolve(import.meta.dirname, '../src/index.ts');
    const runner = resolve(import.meta.dirname, '../src/runner.ts');
    const cli = resolve(import.meta.dirname, '../../../node_modules/vitest/vitest.mjs');
    const eventsPath = join(root, 'events.jsonl');
    try {
      await mkdir(join(root, '.fliwright/tests'), { recursive: true });
      await writeFile(join(root, 'vitest.config.mjs'), `export default {root:${JSON.stringify(root)},test:{include:['.fliwright/tests/native.test.mjs'],runner:${JSON.stringify(runner)},maxWorkers:1,reporters:['dot']}};`);
      await writeFile(join(root, '.fliwright/tests/native.test.mjs'), `
        import {createFliwrightTest, expect} from ${JSON.stringify(integration)};
        import {expect as check, aroundEach} from 'vitest';
        import {NativeRuntime} from ${JSON.stringify(import.meta.resolve('@fliwright/core'))};
        import {appendFile} from 'node:fs/promises';
        const log = (phase, id) => appendFile(${JSON.stringify(eventsPath)}, JSON.stringify({phase,id})+'\\n');
        let owners=0, adapters=0, attempts=0;
        const native={enabled:true,platform:'android',deviceId:'chosen-device',targetAppId:'example.app'};
        const test=createFliwrightTest({vmServiceUrl:'ws://native-fixtures/ws',native,recording:{mode:'standard'},
          requireAssertions:true,log:{format:'silent'},runsRoot:${JSON.stringify(join(root, 'runs'))}}, {
          driverProvider:async()=>({sendRequest:async(method)=>method==='getVM'?{pid:4242}:{success:true},
            getDiagnostics:()=>[],healing:{getReports:()=>[]},dispose:async()=>{}}),
          nativeDeviceProvider:async()=>{
            const owner=++owners; await log('owner-open',owner);
            return {
              verifyAppProcess:async(pid)=>{check(pid).toBe(4242);await log('binding',owner);},
              createRuntime:async(options)=>{
                const id=++adapters; await log('adapter-open',id);
                const identity={platform:'android',deviceId:'chosen-device',appId:'example.app',backend:'probe',generation:String(id)};
                const node={id:'n',appId:'example.app',resourceId:'example.app:id/confirm',text:'Confirm',enabled:true,visible:true,hittable:true,
                  frame:{x:0,y:0,width:20,height:20}};
                return new NativeRuntime({identity,capabilities:async()=>Object.fromEntries(['native.query','native.click','screen.capture']
                  .map(key=>[key,{support:'supported',ready:true,backend:'probe'}])),
                  snapshot:async()=>({id:'snapshot',identity,capturedAt:new Date().toISOString(),screen:{width:100,height:100,scale:1,orientation:'portrait'},nodes:[node]}),
                  execute:async()=>{await log('click',id);},screenshot:async()=>Buffer.from([137,80,78,71,13,10,26,10]),
                  dispose:async()=>{await log('adapter-close',id);}},options.runtime);
              },
              dispose:async()=>{await log('owner-close',owner);}
            };
          }
        });
        aroundEach(async(run,{task,skip})=>{if(task.name==='around skip')skip();await run();});
        test('native success',async({native,device})=>{
          await native.getById('example.app:id/confirm').click();
          await expect(native.getByText('Confirm'),'native confirmation').toBeVisible();
          check((await device.capabilities())['native.click'].ready).toBe(true);
        });
        test('native retry',{retry:1},async({native})=>{
          await expect(native.getById('example.app:id/confirm')).toHaveText('Confirm');
          check(++attempts).toBe(2);
        });
        test('native skip',async({native,skip})=>{check(native).toBeDefined();skip();});
        test('around skip',async({native})=>{throw new Error('must not run');});
      `);
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FLIWRIGHT_CONFIG_PATH: '',
          FLIWRIGHT_RECORDING_MODE: '', FLIWRIGHT_DEFAULT_SCENARIO: '', FLIWRIGHT_SCENARIO_MODE: '',
          FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_RUN_ID: 'native-fixtures' },
      });
      let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
      const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode); });
      expect(code, output).toBe(0);
      expect(stripVTControlCharacters(output)).toContain('2 passed | 2 skipped');
      const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(events.filter(item => item.phase === 'owner-open')).toHaveLength(4);
      expect(events.filter(item => item.phase === 'owner-close')).toHaveLength(4);
      expect(events.filter(item => item.phase === 'adapter-open')).toHaveLength(5);
      expect(events.filter(item => item.phase === 'adapter-close')).toHaveLength(5);
      expect(events.filter(item => item.phase === 'binding')).toHaveLength(4);
      // Retry creates a new Adapter while retaining the task's single device owner.
      const ownerEvents = events.filter(item => item.phase.startsWith('owner-')).map(item => item.phase);
      expect(ownerEvents).toEqual(Array.from({ length: 4 }, () => ['owner-open','owner-close']).flat());
      const { RunArtifactStore } = await import('@fliwright/core');
      const store = new RunArtifactStore({ runsRoot: join(root, 'runs'), runId: 'native-fixtures' });
      const { readdir } = await import('node:fs/promises');
      const results = [];
      for (const id of await readdir(join(store.runDir, 'tests'))) {
        const attemptsDir = join(store.runDir, 'tests', id, 'attempts');
        for (const attempt of await readdir(attemptsDir)) results.push(JSON.parse(await readFile(join(attemptsDir, attempt, 'result.json'), 'utf8')));
      }
      expect(results.filter(result => result.testName === 'native retry')).toHaveLength(2);
      const success = results.find(result => result.testName === 'native success');
      expect(success.operations).toContainEqual(expect.objectContaining({ kind: 'assertion', title: 'native confirmation', metadata: expect.objectContaining({ surface: 'native' }) }));
      expect(success.evidenceStatus).toBe('complete');
      expect(success.evidence).toContainEqual(expect.objectContaining({ surface: 'native', kind: 'screenshot', result: expect.objectContaining({ status: 'captured' }) }));
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 20000);
});
