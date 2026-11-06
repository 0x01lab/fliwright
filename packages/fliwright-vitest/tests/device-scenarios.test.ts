import { expect, it } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ManagedAppLifecycle } from '@fliwright/core';

it('prepares explicit/default device scenarios before the Bridge and checks every retry in a real worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'device-scenarios-'));
  const eventsPath = join(root, 'events.jsonl');
  try {
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default { root:${JSON.stringify(root)}, test:{
      include:['.fliwright/tests/device.test.mjs'],runner:${JSON.stringify(resolve(import.meta.dirname, '../src/runner.ts'))},
      maxWorkers:1,reporters:['dot']}};`);
    await writeFile(join(root, '.fliwright/tests/device.test.mjs'), `
      import {createFliwrightTest,extendFliwrightTest} from ${JSON.stringify(resolve(import.meta.dirname, '../src/index.ts'))};
      import {expect} from 'vitest';
      import {NativeRuntime} from ${JSON.stringify(import.meta.resolve('@fliwright/core'))};
      import {appendFile} from 'node:fs/promises';
      const log=(tag,phase,id)=>appendFile(${JSON.stringify(eventsPath)},JSON.stringify({tag,phase,id})+'\\n');
      const scenarios={ready:{name:'ready',layers:[{kind:'device',requiredCapabilities:['native.query']}]},
        missing:{name:'missing',layers:[{kind:'device',requiredCapabilities:['native.fill.unicode']}]},
        destructive:{name:'destructive',layers:[{kind:'device',permissions:[{permission:'camera',state:'prompt'}]}]}};
      const make=(tag,extra={})=>{
        let generation=0;
        return createFliwrightTest({vmServiceUrl:'ws://device-scenarios/ws',
          native:{enabled:true,platform:'android',deviceId:'owned',targetAppId:'example.app'},scenarios,
          requireAssertions:false,recording:{mode:'off'},log:{format:'silent'},runsRoot:${JSON.stringify(join(root, 'runs'))},...extra},{
          driverProvider:async()=>{await log(tag,'bridge');return {
            sendRequest:async()=>({pid:42}),getDiagnostics:()=>[],healing:{getReports:()=>[]},dispose:async()=>{}};},
          nativeDeviceProvider:async()=>{await log(tag,'owner');return {
            verifyAppProcess:async()=>{},dispose:async()=>{await log(tag,'release');},
            createRuntime:async(options)=>{const id=++generation;await log(tag,'adapter',id);return new NativeRuntime({
              identity:{platform:'android',deviceId:'owned',appId:'example.app',backend:'probe',generation:String(id)},
              capabilities:async()=>{await log(tag,'capabilities',id);return {'native.query':{support:'supported',ready:true,backend:'probe'}};},
              snapshot:async()=>{throw Error('no snapshot');},execute:async()=>{throw Error('no writes');},screenshot:async()=>{throw Error('no screenshot');},
              dispose:async()=>{await log(tag,'close',id);}},options.runtime);}};}
        });
      };
      let tries=0;
      extendFliwrightTest(make('explicit'),{}).scenario('ready')('explicit retry',async()=>{await log('explicit','body');expect(++tries).toBe(2);});
      make('default',{defaultScenario:'ready'})('default',async()=>{await log('default','body');});
      make('missing').scenario('missing')('missing',async()=>{throw Error('unexpected-body');});
      make('destructive').scenario('destructive')('destructive',async()=>{throw Error('unexpected-body');});
      make('disabled',{native:undefined}).scenario('ready')('disabled',async()=>{throw Error('unexpected-body');});
    `);
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../node_modules/vitest/vitest.mjs'), 'run', '--retry=1', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        FLIWRIGHT_CONFIG_PATH: '', FLIWRIGHT_RECORDING_MODE: '', FLIWRIGHT_DEFAULT_SCENARIO: '',
        FLIWRIGHT_SCENARIO_MODE: '', FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_RUN_ID: 'device-scenarios',
      },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    expect(code, output).toBe(1);
    expect(stripVTControlCharacters(output)).toContain('3 failed | 2 passed');
    expect(output).not.toContain('unexpected-body');
    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    for (const tag of ['explicit', 'default']) {
      const tagged = events.filter(event => event.tag === tag);
      expect(tagged.findIndex(event => event.phase === 'capabilities')).toBeLessThan(tagged.findIndex(event => event.phase === 'bridge'));
      expect(tagged.filter(event => event.phase === 'owner')).toHaveLength(1);
      expect(tagged.filter(event => event.phase === 'release')).toHaveLength(1);
    }
    expect(events.filter(event => event.tag === 'explicit' && event.phase === 'adapter')).toHaveLength(2);
    for (const id of [1, 2]) expect(events.filter(event => event.tag === 'explicit' && event.phase === 'capabilities' && event.id === id)).toHaveLength(2);
    expect(events.some(event => event.tag === 'missing' && event.phase === 'bridge')).toBe(false);
    expect(events.some(event => event.tag === 'destructive')).toBe(false);
    expect(events.some(event => event.tag === 'disabled')).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

it('rejects permission scenarios in a real worker before contacting the managed supervisor or device', async () => {
  const root = await mkdtemp(join(tmpdir(), 'device-permission-gate-'));
  const eventsPath = join(root, 'events.jsonl');
  let preparations = 0;
  const lifecycle = new ManagedAppLifecycle({ async prepare() {
    preparations++;
    await appendFile(eventsPath, 'supervisor\n');
    return { url: 'ws://127.0.0.1:9123/ws' };
  } });
  try {
    const control = await lifecycle.start();
    await writeFile(eventsPath, '');
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default { root:${JSON.stringify(root)}, test:{
      include:['.fliwright/tests/permission.test.mjs'],runner:${JSON.stringify(resolve(import.meta.dirname, '../src/runner.ts'))},
      maxWorkers:1,reporters:['dot']}};`);
    await writeFile(join(root, '.fliwright/tests/permission.test.mjs'), `
      import {createFliwrightTest} from ${JSON.stringify(resolve(import.meta.dirname, '../src/index.ts'))};
      import {appendFile} from 'node:fs/promises';
      const log=phase=>appendFile(${JSON.stringify(eventsPath)},phase+'\\n');
      const make=(defaultScenario)=>createFliwrightTest({vmServiceUrl:'',scenarioMode:'managed-start',defaultScenario,
        native:{enabled:true,platform:'android',deviceId:'owned',targetAppId:'example.app'},
        scenarios:{camera:{name:'camera',layers:[{kind:'device',permissions:[{permission:'camera',state:'prompt'}]}]}},
        recording:{mode:'off'},log:{format:'silent'},runsRoot:${JSON.stringify(join(root, 'runs'))}},{
        nativeDeviceProvider:async()=>{await log('owner');throw Error('unexpected owner');},
        driverProvider:async()=>{await log('bridge');throw Error('unexpected Bridge');}
      });
      make().scenario('camera')('explicit',async()=>{await log('body');});
      make('camera')('default',async()=>{await log('body');});
    `);
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../node_modules/vitest/vitest.mjs'), 'run', '--retry=1', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        FLIWRIGHT_MANAGED_APP_CONTROL: JSON.stringify(control), FLIWRIGHT_CONFIG_PATH: '', FLIWRIGHT_DEFAULT_SCENARIO: '', FLIWRIGHT_SCENARIO_MODE: '', FLIWRIGHT_RECORDING_MODE: '',
        FLIWRIGHT_RUN_ID: 'permission-gate', FLIWRIGHT_RUNS_ROOT: join(root, 'runs'),
      },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    expect(code, output).toBe(1);
    expect(stripVTControlCharacters(output)).toContain('2 failed');
    expect(output).toMatch(/permissions requires a verified preboot\/prelaunch/);
    expect(await readFile(eventsPath, 'utf8')).toBe('');
    expect(preparations).toBe(0);
  } finally {
    await lifecycle.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
