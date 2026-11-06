import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

/** Real fake-host executables; Simulator lifetime is represented independently of the host process. */
export async function writeFakeXctestTools(root: string, options: {
  deviceId: string; runnerJournalPath?: string; startMarker?: string; crash?: boolean;
}) {
  const files = {
    xcodebuild: join(root, 'xcodebuild'), xcrun: join(root, 'xcrun'), xctestrunPath: join(root, 'Runner.xctestrun'),
    started: options.startMarker ?? join(root, 'runner-started'), stopped: join(root, 'runner-stopped'),
    terminated: join(root, 'simctl-terminated'), rebooted: join(root, 'simulator-rebooted'),
    replaced: join(root, 'runner-replaced'), wrongKey: join(root, 'wrong-key'), lostAck: join(root, 'lost-ack'),
    ignoreShutdown: join(root, 'ignore-shutdown'), shutdowns: join(root, 'shutdown-count'),
  };
  await writeFile(files.xctestrunPath, 'fixture');
  await writeFile(files.xcrun, String.raw`#!/usr/bin/env node
const fs=require('node:fs'),f=${JSON.stringify(files)};
if(process.argv.includes('terminate')) { fs.writeFileSync(f.terminated,'yes'); fs.writeFileSync(f.stopped,'yes'); }
else if(process.argv.includes('-j')) process.stdout.write(JSON.stringify({devices:{runtime:[{
  udid:${JSON.stringify(options.deviceId)},state:'Booted',lastBootedAt:fs.existsSync(f.rebooted)?'2026-11-04T03:00:00Z':'2026-11-04T02:00:00Z'
}]}}));
else if(process.argv.includes('spawn')) {
  process.stdout.write('PID Status Label\n');
  if(fs.existsSync(f.started)&&!fs.existsSync(f.stopped)) process.stdout.write((fs.existsSync(f.replaced)?'987':'456')+' 0 UIKitApplication:dev.fliwright.NativeRunner.xctrunner[AB12][rb-legacy]\n');
}
`, { mode: 0o700 });
  await writeFile(files.xcodebuild, String.raw`#!/usr/bin/env node
const fs=require('node:fs'),http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const env=process.env,f=${JSON.stringify(files)};
const credentialsPath=${JSON.stringify(options.runnerJournalPath ?? '')}||env.FLIWRIGHT_TEST_RUNNER_JOURNAL_PATH;
if(credentialsPath){
  const intent=JSON.parse(fs.readFileSync(credentialsPath,'utf8'));
  if(intent.phase!=='launching'||intent.schemaVersion!==2||intent.sessionId!==env.TEST_RUNNER_FLIWRIGHT_RUNNER_SESSION
    ||intent.recoveryKey!==env.TEST_RUNNER_FLIWRIGHT_RUNNER_RECOVERY_KEY)process.exit(4);
}
let toolRecord;
if(${JSON.stringify(!!options.crash)})toolRecord=JSON.parse(fs.readFileSync(env.FLIWRIGHT_TEST_JOURNAL_PATH,'utf8'));
const server=net.createServer(socket=>{
  socket.on('error',()=>{});
  let input='';
  socket.on('data',chunk=>{
    input+=chunk.toString();if(!input.endsWith('\n'))return;
    const body=JSON.parse(input);
    const key=fs.existsSync(f.wrongKey)?'ff'.repeat(32):env.TEST_RUNNER_FLIWRIGHT_RUNNER_RECOVERY_KEY;
    const signature=value=>crypto.createHmac('sha256',Buffer.from(key,'hex')).update([
      'fliwright-runner-recovery','1',value.direction,value.operation,value.nonce,value.sessionId,value.generation,
      value.deviceId,value.simulatorBootedAt,String(value.runnerPid),value.status||''
    ].join('\n')).digest('hex');
    if(body.signature!==signature(body)||body.sessionId!==env.TEST_RUNNER_FLIWRIGHT_RUNNER_SESSION
      ||body.generation!==env.TEST_RUNNER_FLIWRIGHT_RUNNER_GENERATION||body.deviceId!==env.TEST_RUNNER_FLIWRIGHT_RUNNER_DEVICE
      ||body.simulatorBootedAt!==env.TEST_RUNNER_FLIWRIGHT_RUNNER_BOOT||body.runnerPid!==456){socket.destroy();return;}
    const reply={...body,direction:'response',status:body.operation==='identify'?'identified':'stopping'};
    reply.signature=signature(reply);
    if(body.operation==='shutdown'){
      fs.appendFileSync(f.shutdowns,'1');
      if(!fs.existsSync(f.ignoreShutdown))fs.writeFileSync(f.stopped,'yes');
    }
    if(body.operation==='shutdown'&&fs.existsSync(f.lostAck))socket.destroy();
    else socket.end(JSON.stringify(reply)+'\n');
    if(body.operation==='shutdown'&&!fs.existsSync(f.ignoreShutdown))setTimeout(()=>process.exit(0),20);
  });
});
server.listen(0,'127.0.0.1',()=>{
  fs.writeFileSync(f.started,toolRecord?JSON.stringify({pid:process.pid,group:toolRecord.group,ownerPid:toolRecord.ownerPid}):'yes');
  const body=JSON.stringify({protocolVersion:2,sessionId:env.TEST_RUNNER_FLIWRIGHT_RUNNER_SESSION,
    generation:env.TEST_RUNNER_FLIWRIGHT_RUNNER_GENERATION,deviceId:env.TEST_RUNNER_FLIWRIGHT_RUNNER_DEVICE,
    appId:env.TEST_RUNNER_FLIWRIGHT_RUNNER_APP,runnerPid:456,recoveryPort:server.address().port});
  const request=http.request(env.TEST_RUNNER_FLIWRIGHT_RUNNER_URL+'/ready',{method:'POST',
    headers:{authorization:'Bearer '+env.TEST_RUNNER_FLIWRIGHT_RUNNER_TOKEN,'content-type':'application/json'}},response=>{
    response.resume();response.on('end',()=>{
      if(response.statusCode!==200)process.exit(2);
      if(toolRecord){
        const timer=setInterval(()=>{
          if(!fs.existsSync(f.started+'.owner-ready'))return;clearInterval(timer);
          process.kill(toolRecord.ownerPid,'SIGKILL');process.kill(toolRecord.wrapperPid,'SIGKILL');
        },10);
      }
    });
  });
  request.on('error',()=>process.exit(2));request.end(body);
});
`, { mode: 0o700 });
  return files;
}
