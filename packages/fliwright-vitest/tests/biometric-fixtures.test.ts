import { expect, it } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('observes app-local callbacks and cleans unresolved challenges after failure and skip in a real worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'biometric-fixtures-'));
  try {
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default {root:${JSON.stringify(root)},test:{
      include:['.fliwright/tests/biometric.test.mjs'],runner:${JSON.stringify(resolve(import.meta.dirname, '../src/runner.ts'))},
      maxWorkers:1,reporters:['dot']}};`);
    await writeFile(join(root, '.fliwright/tests/biometric.test.mjs'), `
      import {createFliwrightTest} from ${JSON.stringify(resolve(import.meta.dirname, '../src/index.ts'))};
      import {expect} from 'vitest';
      let generation=0,pending=[],results={},rejections={};
      const status=()=>({schemaVersion:1,surface:'app-test-seam',generation:String(generation),pendingChallenges:[...pending],results:{...results},rejections:{...rejections}});
      const app={listCapabilities:async()=>[{name:'biometricTest',methods:['reset','getStatus']}],
        invoke:async(_capability,method,input={})=>{
          if(input.generation!==undefined&&input.generation!==String(generation))throw Error('stale generation');
          if(method==='reset'){generation++;pending=[];results={};rejections={};return status();}
          if(method!=='getStatus')throw Error('Unknown remote method');
          return status();
        }};
      const test=createFliwrightTest({vmServiceUrl:'ws://biometric-fixtures/ws',requireAssertions:false,
        recording:{mode:'standard'},log:{format:'silent'},runsRoot:${JSON.stringify(join(root, 'runs'))}}, {
        driverProvider:async()=>({app,getDiagnostics:()=>[],healing:{getReports:()=>[]},dispose:async()=>{}})
      });
      test('observes prompt and callback without claiming device injection',async({biometricTest})=>{
        const challenge=biometricTest.waitForChallenge('login');
        pending.push('login');
        await expect(challenge).resolves.toEqual({challengeId:'login'});
        const result=biometricTest.waitForResult('login');
        pending=[];results.login='reject';
        await expect(result).resolves.toBe('reject');
      });
      test('dispatches once and verifies app result',async({biometricTest})=>{
        pending.push('unlock');
        const rejected=await biometricTest.exerciseRejection('unlock',async()=>{rejections.unlock=1;return {acknowledged:true};});
        expect(rejected.rejectionSequence).toBe(1);
        const receipt=await biometricTest.exerciseChallenge('unlock',async()=>{
          pending=[];results.unlock='match';return {acknowledged:true};
        },'match');
        expect(receipt.result).toBe('match');
      });
      test('unresolved challenge',async({biometricTest})=>{await biometricTest.getStatus();pending.push('unfinished');});
      test('body failure',async({biometricTest})=>{await biometricTest.getStatus();pending.push('unfinished');throw Error('original-biometric-body-failure');});
      test('skip with unresolved challenge',async({biometricTest,skip})=>{await biometricTest.getStatus();pending.push('unfinished');skip();});
      test('next attempt has empty observations',async({biometricTest})=>{
        expect(await biometricTest.getStatus()).toMatchObject({pendingChallenges:[],results:{}});
      });
    `);
    const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../node_modules/vitest/vitest.mjs'), 'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        FLIWRIGHT_CONFIG_PATH: '', FLIWRIGHT_RECORDING_MODE: '', FLIWRIGHT_DEFAULT_SCENARIO: '',
        FLIWRIGHT_SCENARIO_MODE: '', FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_RUN_ID: 'biometric-fixtures',
      },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    expect(code, output).toBe(1);
    expect(stripVTControlCharacters(output)).toContain('3 failed | 3 passed');
    expect(stripVTControlCharacters(output)).toContain('unresolved challenge');
    expect(stripVTControlCharacters(output)).toContain('original-biometric-body-failure');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);
