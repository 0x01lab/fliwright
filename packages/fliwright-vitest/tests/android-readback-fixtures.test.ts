import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ManagedAppLifecycle } from '@fliwright/core';

it.each(['success', 'apk', 'uid', 'pid', 'permissions', 'missing', 'adapter'] as const)('requires child readback before body (%s)', async fault => {
  const root = await mkdtemp(join(tmpdir(), 'android-readback-'));
  const events = join(root, 'events.jsonl'), runs = join(root, 'runs');
  const observation = { platform: 'android' as const, deviceKey: createHash('sha256').update('android\0owned').digest('hex'),
    appId: 'example.app', apkSha256: 'b'.repeat(64), uid: 10123, pid: 42,
    permissions: [{ permission: 'camera' as const, granted: false, userSet: false, userFixed: false, flags: [] }] };
  let launches = 0;
  const lifecycle = new ManagedAppLifecycle({ async prepare(request) {
    const n = ++launches;
    return { url: `ws://127.0.0.1:${9000 + n}/private-token/ws`, nativeApp: { ...observation, pid: 41 + n,
      attemptKey: request.attemptKey, scenarioFingerprint: request.scenarioFingerprint, launchGeneration: `launch-${n}` } };
  } });
  const control = await lifecycle.start();
  try {
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default {root:${JSON.stringify(root)},test:{
      include:['.fliwright/tests/readback.test.mjs'],runner:${JSON.stringify(resolve(import.meta.dirname, '../src/runner.ts'))},maxWorkers:1,reporters:['dot']}};`);
    await writeFile(join(root, '.fliwright/tests/readback.test.mjs'), `
      import {createFliwrightTest} from ${JSON.stringify(resolve(import.meta.dirname, '../src/index.ts'))};
      import {NativeRuntime} from ${JSON.stringify(import.meta.resolve('@fliwright/core'))};
      import {expect} from 'vitest';
      import {appendFile} from 'node:fs/promises';
      const fault=${JSON.stringify(fault)}, observation=${JSON.stringify(observation)};
      const log=(phase,data={})=>appendFile(${JSON.stringify(events)},JSON.stringify({phase,...data})+'\\n');
      let pid=42,adapters=0,tries=0,active;
      const test=createFliwrightTest({vmServiceUrl:'',scenarioMode:'managed-start',
        native:{enabled:true,platform:'android',deviceId:'owned',targetAppId:'example.app'},
        scenarios:{system:{name:'system',layers:[{kind:'device',requiredCapabilities:['native.query']}]}},
        recording:{mode:'standard'},log:{format:'silent'},runsRoot:${JSON.stringify(runs)}}, {
        nativeDeviceProvider:async()=>({
          verifyAppProcess:async value=>{pid=value;await log('binding',{pid});},
          inspectAppState:fault==='missing'?undefined:async()=>{
            await log('read',{pid});const actual=structuredClone({...observation,pid});
            if(fault==='apk')actual.apkSha256='c'.repeat(64);
            if(fault==='uid')actual.uid++;
            if(fault==='pid')actual.pid++;
            if(fault==='permissions')actual.permissions=[];
            if(fault==='adapter')active.identity={...active.identity,generation:'replacement'};
            return actual;
          },
          createRuntime:async options=>{const generation='adapter-'+(++adapters);active={
            identity:{platform:'android',deviceId:'owned',appId:'example.app',backend:'adb',generation},
            capabilities:async()=>({'native.query':{support:'supported',ready:true,backend:'adb'}}),
            snapshot:async()=>{throw Error('unused');},execute:async()=>{},screenshot:async()=>Buffer.alloc(0),
            dispose:async()=>log('adapter-close',{generation})
          };return new NativeRuntime(active,options.runtime);},dispose:async()=>log('release')
        }),
        driverProvider:async({vmServiceUrl})=>({
          sendRequest:async method=>method==='getVM'?{pid:Number(new URL(vmServiceUrl).port)-8959}: {success:true},
          getDiagnostics:()=>[],healing:{getReports:()=>[]},dispose:async()=>log('connection-close')
        })
      });
      test.skip('static skip',async({driver})=>{throw Error('unreachable');});
      if(fault==='uid'||fault==='adapter')test('ordinary body without driver',async()=>{await log('body');expect(true).toBe(true);});
      else test.scenario('system')('body',async({driver})=>{void driver;await log('body');expect(++tries).toBe(1);});
      if(fault==='success'){
        test('retry',{retry:1},async({driver})=>{void driver;await log('body');expect(++tries).toBe(3);});
        test('skip',async({driver,skip})=>{void driver;skip();});
        test('peer without driver',async()=>{await log('body');expect(true).toBe(true);});
      }
    `);
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../node_modules/vitest/vitest.mjs'), 'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        FLIWRIGHT_MANAGED_APP_CONTROL: JSON.stringify(control), FLIWRIGHT_CONFIG_PATH: '', FLIWRIGHT_DEFAULT_SCENARIO: '', FLIWRIGHT_SCENARIO_MODE: '', FLIWRIGHT_RECORDING_MODE: '',
        FLIWRIGHT_RUN_ID: 'readback', FLIWRIGHT_RUNS_ROOT: runs,
      },
    });
    let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    const log = (await readFile(events, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(code, output).toBe(fault === 'success' ? 0 : 1);
    if (fault !== 'success') {
      expect(log.filter(item => item.phase === 'body')).toEqual([]);
      expect(output).toMatch(/readback|observation/);
      expect(launches).toBe(1);
      expect(log.filter(item => item.phase === 'release')).toHaveLength(1);
      return;
    }
    expect(launches).toBe(5);
    expect(log.filter(item => item.phase === 'read').map(item => item.pid)).toEqual([42, 43, 44, 45, 46]);
    expect(log.filter(item => item.phase === 'body')).toHaveLength(4);
    const reports: unknown[] = [];
    for (const id of await readdir(join(runs, 'readback/tests'))) {
      const attempts = join(runs, 'readback/tests', id, 'attempts');
      for (const name of await readdir(attempts)) {
        const timeline = JSON.parse(await readFile(join(attempts, name, 'timeline.json'), 'utf8'));
        for (const node of timeline.nodes) if (node.title === 'Android app readback') reports.push(node.metadata);
      }
    }
    expect(reports).toHaveLength(5);
    expect(reports).toEqual(expect.arrayContaining([expect.objectContaining({ coverage: 'platform-readback', launchGeneration: 'launch-1', adapterGeneration: 'adapter-1' })]));
    expect(JSON.stringify(reports)).not.toMatch(/owned|private-token|apkPath|127\.0\.0\.1/);
  } finally { await lifecycle.dispose(); await rm(root, { recursive: true, force: true }); }
}, 25000);
