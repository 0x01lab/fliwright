import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ManagedAppLifecycle } from '@fliwright/core';

it.each([false, true])('relaunches and binds fresh endpoints, fencing unconfirmed cleanup (%s)', async cleanupFails => {
  const root = await mkdtemp(join(tmpdir(), 'managed-app-fixtures-'));
  const events = join(root, 'events.jsonl');
  let generation = 0;
  const lifecycle = new ManagedAppLifecycle({ async prepare(request) {
    await appendFile(events, JSON.stringify({ phase: 'relaunch', attempt: request.attemptKey, generation: ++generation }) + '\n');
    return { url: `ws://127.0.0.1:${9000 + generation}/ws` };
  } });
  const control = await lifecycle.start();
  try {
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default {root:${JSON.stringify(root)},test:{
      include:['.fliwright/tests/managed.test.mjs'],runner:${JSON.stringify(resolve(import.meta.dirname, '../src/runner.ts'))},
      maxWorkers:1,reporters:['dot']}};`);
    await writeFile(join(root, '.fliwright/tests/managed.test.mjs'), `
      import {createFliwrightTest} from ${JSON.stringify(resolve(import.meta.dirname, '../src/index.ts'))};
      import {NativeRuntime} from ${JSON.stringify(import.meta.resolve('@fliwright/core'))};
      import {expect} from 'vitest';
      import {appendFile} from 'node:fs/promises';
      const log=(phase,data={})=>appendFile(${JSON.stringify(events)},JSON.stringify({phase,...data})+'\\n');
      let tries=0,adapters=0,dirty=false;
      const test=createFliwrightTest({vmServiceUrl:'',scenarioMode:'managed-start',
        native:{enabled:true,platform:'android',deviceId:'owned',targetAppId:'example.app'},
        scenarios:{system:{name:'system',layers:[{kind:'device',requiredCapabilities:['native.query']}]}},
        recording:{mode:'off'},log:{format:'silent'},runsRoot:${JSON.stringify(join(root,'runs'))}}, {
        nativeDeviceProvider:async()=>{if(dirty)throw Error('device quarantined');await log('acquire-device');return {
          quarantine:async()=>{dirty=true;await log('quarantine');},
          createRuntime:async(options)=>{const generation=String(++adapters);await log('adapter',{generation});return new NativeRuntime({
            identity:{platform:'android',deviceId:'owned',appId:'example.app',backend:'fake',generation},
            capabilities:async()=>({'native.query':{support:'supported',ready:true,backend:'fake'}}),
            snapshot:async()=>{throw Error('unused');},execute:async()=>{},screenshot:async()=>Buffer.alloc(0),
            dispose:async()=>log('dispose-adapter',{generation})
          },options.runtime);},
          verifyAppProcess:async pid=>log('binding',{pid}),dispose:async()=>log('release-device')
        };},
        driverProvider:async({vmServiceUrl})=>{await log('bridge-connect',{url:vmServiceUrl});return {
          sendRequest:async method=>{if(method==='getVM')return {pid:Number(new URL(vmServiceUrl).port)};throw Error(method);},
          getDiagnostics:()=>[],healing:{getReports:()=>[]},dispose:async()=>{await log('bridge-dispose',{url:vmServiceUrl});if(${cleanupFails})throw Error('connection cleanup unconfirmed');}
        };}
      });
      test.skip('static skip never starts an app',async({driver})=>{void driver;throw Error('must not run');});
      test.scenario('system')('retry uses a new VM',async({driver})=>{void driver;expect(++tries).toBe(2);});
      test('peer gets its own attempt',async({driver})=>{void driver;expect(true).toBe(true);});
      test('skip still cleans its connection',async({driver,skip})=>{void driver;skip();});
      test('peer after skip',async({driver})=>{void driver;expect(true).toBe(true);});
    `);
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../node_modules/vitest/vitest.mjs'), 'run', '--retry=1', '--config', join(root,'vitest.config.mjs')], {
      cwd: root, timeout: 20000, stdio: ['ignore','pipe','pipe'], env: { ...process.env,
        FLIWRIGHT_MANAGED_APP_CONTROL: JSON.stringify(control), FLIWRIGHT_CONFIG_PATH:'', FLIWRIGHT_DEFAULT_SCENARIO:'', FLIWRIGHT_SCENARIO_MODE:'', FLIWRIGHT_RECORDING_MODE:'',
        FLIWRIGHT_RUN_ID:'managed-attempts', FLIWRIGHT_RUNS_ROOT:join(root,'runs'),
      },
    });
    let output = ''; child.stdout.on('data', chunk=>output+=chunk); child.stderr.on('data', chunk=>output+=chunk);
    expect(await new Promise(resolve=>child.once('close',resolve)),output).toBe(cleanupFails ? 1 : 0);
    const log = (await readFile(events,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    if (cleanupFails) {
      expect(output).toContain('connection cleanup unconfirmed');
      expect(generation).toBe(1);
      expect(log.filter(item=>item.phase==='quarantine')).toHaveLength(1);
      expect(log.filter(item=>item.phase==='bridge-connect')).toHaveLength(1);
      return;
    }
    expect(generation).toBe(5);
    expect(log.filter(item=>item.phase==='binding').map(item=>item.pid)).toEqual([9001,9002,9003,9004,9005]);
    expect(log.filter(item=>item.phase==='acquire-device')).toHaveLength(4);
    expect(log.filter(item=>item.phase==='release-device')).toHaveLength(4);
    expect(log.filter(item=>item.phase==='bridge-dispose')).toHaveLength(5);
    for(let n=1;n<=5;n++) {
      const launch = log.findIndex(item=>item.phase==='relaunch'&&item.generation===n);
      const connect = log.findIndex(item=>item.phase==='bridge-connect'&&item.url.includes(':'+String(9000+n)+'/'));
      expect(connect).toBeGreaterThan(launch);
      if(n===2) {
        expect(log.findIndex(item=>item.phase==='bridge-dispose'&&item.url.includes(':9001/'))).toBeLessThan(launch);
        expect(log.findIndex(item=>item.phase==='dispose-adapter'&&item.generation==='1')).toBeLessThan(launch);
        expect(log.slice(0,launch).filter(item=>item.phase==='release-device')).toHaveLength(0);
      }
    }
  } finally { await lifecycle.dispose(); await rm(root,{recursive:true,force:true}); }
},25000);
