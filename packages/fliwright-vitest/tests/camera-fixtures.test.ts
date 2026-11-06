import { expect, it } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('isolates app camera queues per attempt, verifies leftovers and cleans after body failures in a real worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'camera-fixtures-'));
  const eventsPath = join(root, 'events.jsonl');
  try {
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default {root:${JSON.stringify(root)},test:{
      include:['.fliwright/tests/camera.test.mjs'],runner:${JSON.stringify(resolve(import.meta.dirname, '../src/runner.ts'))},
      maxWorkers:1,reporters:['dot']}};`);
    await writeFile(join(root, '.fliwright/tests/camera.test.mjs'), `
      import {createFliwrightTest} from ${JSON.stringify(resolve(import.meta.dirname, '../src/index.ts'))};
      import {expect} from 'vitest';
      import {appendFile} from 'node:fs/promises';
      let generation=0,pending=[],consumed=[],tries=0;
      const log=(phase,data)=>appendFile(${JSON.stringify(eventsPath)},JSON.stringify({phase,...data})+'\\n');
      const status=()=>({schemaVersion:1,surface:'app-test-seam',generation:String(generation),pending:pending.length,
        consumed:consumed.length,enqueued:pending.length+consumed.length,loading:false,consumedResults:consumed});
      const app={listCapabilities:async()=>[{name:'cameraTest',methods:['reset','enqueueResult','getStatus']}],
        invoke:async(capability,method,input)=>{
          if(capability==='demo')return;
          if(input?.generation&&input.generation!==String(generation))throw Error('stale generation');
          if(method==='reset'){await log('reset',{discarded:pending.length});generation++;pending=[];consumed=[];}
          if(method==='enqueueResult')pending.push(input.result);
          return status();
        }};
      const test=createFliwrightTest({vmServiceUrl:'ws://camera-fixtures/ws',requireAssertions:false,
        recording:{mode:'standard'},log:{format:'silent'},runsRoot:${JSON.stringify(join(root, 'runs'))},
        scenarios:{camera:{name:'camera',layers:[{kind:'app',capability:'demo',method:'reset'}]}}}, {
        driverProvider:async()=>({app,getDiagnostics:()=>[],healing:{getReports:()=>[]},dispose:async()=>{}})
      });
      test.scenario('camera')('camera retry',async({cameraTest})=>{
        expect(await cameraTest.getStatus()).toMatchObject({pending:0,consumed:0});
        await cameraTest.enqueueResult({kind:'cancel'});
        consumed.push(pending.shift());
        expect(++tries).toBe(2);
      });
      test('unused result',async({cameraTest})=>{await cameraTest.enqueueResult({kind:'cancel'});});
      test('body failure',async({cameraTest})=>{await cameraTest.enqueueResult({kind:'cancel'});throw Error('original-camera-body-failure');});
      test('skip with unused result',async({cameraTest,skip})=>{await cameraTest.enqueueResult({kind:'cancel'});skip();});
      test('after failures',async({cameraTest})=>{expect(await cameraTest.getStatus()).toMatchObject({pending:0,consumed:0});});
    `);
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../node_modules/vitest/vitest.mjs'), 'run', '--retry=1', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        FLIWRIGHT_CONFIG_PATH: '', FLIWRIGHT_RECORDING_MODE: '', FLIWRIGHT_DEFAULT_SCENARIO: '',
        FLIWRIGHT_SCENARIO_MODE: '', FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_RUN_ID: 'camera-fixtures',
      },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    expect(code, output).toBe(1);
    expect(stripVTControlCharacters(output)).toContain('3 failed | 2 passed');
    expect(stripVTControlCharacters(output)).toContain('original-camera-body-failure');
    expect(stripVTControlCharacters(output)).toContain('unconsumed');
    const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(events).toHaveLength(12); // Six attempts; fixture cleanup errors prevent a retry.
    expect(events.filter((_, index) => index % 2 === 0).every(event => event.discarded === 0)).toBe(true);
    expect(events.at(-1)).toMatchObject({ discarded: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);
