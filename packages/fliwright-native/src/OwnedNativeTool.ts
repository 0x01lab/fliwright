import { execFile, spawn, type ExecFileException } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeError, type NativeOperationContext } from '@fliwright/core';
import { NativeToolJournal } from './NativeToolOwnership.js';

// The wrapper receives the actual program only after the parent syncs running
// evidence. It stays alive as the process-group anchor until cleanup is decided.
const wrapperSource = String.raw`
const {spawn}=require('node:child_process');
let identified=false,started=false,finished=false,intentional=false,stopping=false;
const finish=()=>{intentional=true;process.disconnect();process.exit(0)};
process.on('SIGTERM',()=>{});
process.on('disconnect',()=>{if(!intentional){try{process.kill(-process.pid,'SIGKILL')}catch{process.exit(70)}}});
process.on('message',message=>{
  if(message?.type==='identify'&&!identified){
    identified=true;process.title='fliwright-tool:'+message.resourceId;
    process.send({type:'ready',pid:process.pid});return;
  }
  if(message?.type==='exit'){
    stopping=true;
    if(!started||finished)finish();
    else{try{process.kill(-process.pid,'SIGTERM')}catch{}}
    return;
  }
  if(message?.type!=='run'||!identified||started||stopping)return;
  started=true;
  let tool;
  try{tool=spawn(message.program,message.args,{env:message.env,stdio:['ignore','inherit','inherit'],detached:false});}
  catch{finished=true;process.send({type:'result',code:null,failed:true});return;}
  let failed=false;
  tool.once('error',()=>{failed=true;});
  tool.once('close',code=>{finished=true;if(process.connected)process.send({type:'result',code,failed},()=>{if(stopping)finish()});});
});
`;

interface ToolResult { code: number | null; failed: boolean; }
/** Unix group ownership with a pre-dispatch durable gate when inside a device operation. */
export async function executeOwnedNativeTool(program: string, args: readonly string[], context: NativeOperationContext,
  options: { env?: NodeJS.ProcessEnv } = {}): Promise<Buffer> {
  if (context.signal.aborted) throw toolError('cancelled');
  if (Date.now() >= context.deadline) throw toolError('timeout');
  let journal: NativeToolJournal | undefined;
  try { journal = await NativeToolJournal.reserve(); }
  catch { throw toolError('cleanup_failed'); }
  if (process.platform === 'win32') return executeWindowsTool(program, args, context, journal, options.env);
  if (context.signal.aborted || Date.now() >= context.deadline) {
    try { await journal?.cancelBeforeSpawn(); } catch { throw toolError('cleanup_failed'); }
    throw toolError(context.signal.aborted ? 'cancelled' : 'timeout');
  }
  const child = spawn(process.execPath, ['-e', wrapperSource], { detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const pid = child.pid;
  let exited = false, closed = false, fenced = false, workSettled = false;
  let resolveReady!: (value: boolean) => void, resolveResult!: (value: ToolResult) => void;
  const ready = new Promise<boolean>(resolve => { resolveReady = resolve; });
  const result = new Promise<ToolResult>(resolve => { resolveResult = resolve; });
  const done = new Promise<void>(resolve => {
    child.once('exit', () => { exited = true; resolveReady(false); resolveResult({ code: null, failed: true }); resolve(); });
    child.once('error', () => { exited = true; resolveReady(false); resolveResult({ code: null, failed: true }); resolve(); });
  });
  const pipesClosed = new Promise<void>(resolve => { child.once('close', () => { closed = true; resolve(); }); });
  child.on('message', value => {
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    if (message.type === 'ready' && message.pid === pid) resolveReady(true);
    if (message.type === 'result' && (message.code === null || Number.isSafeInteger(message.code)) && typeof message.failed === 'boolean') {
      resolveResult({ code: message.code as number | null, failed: message.failed });
    }
  });
  let rejectStop!: (error: NativeError) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const onAbort = () => rejectStop(toolError('cancelled'));
  context.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => rejectStop(toolError('timeout')), Math.max(0, context.deadline - Date.now()));
  if (context.signal.aborted) onAbort();
  const chunks: Buffer[] = [];
  let size = 0;
  const capture = (chunk: Buffer, stdout: boolean) => {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) { rejectStop(toolError('transport_lost')); return; }
    if (stdout) chunks.push(chunk);
  };
  child.stdout!.on('data', chunk => capture(chunk, true));
  child.stderr!.on('data', chunk => capture(chunk, false));
  const check = () => {
    if (fenced || context.signal.aborted) throw toolError('cancelled');
    if (Date.now() >= context.deadline) throw toolError('timeout');
  };
  const send = (message: object) => new Promise<void>((resolve, reject) => {
    if (!child.connected) { reject(toolError('transport_lost')); return; }
    child.send(message, error => error ? reject(toolError('transport_lost')) : resolve());
  });
  const work = (async () => {
    check();
    await send({ type: 'identify', resourceId: journal?.resourceId ?? randomUUID() });
    if (!await ready || !pid) throw toolError('transport_lost');
    check(); await journal?.checkpoint('gated', pid);
    check(); await journal?.checkpoint('running', pid);
    check(); await send({ type: 'run', program, args: [...args], env: options.env });
    const output = await result;
    check();
    if (output.failed || output.code !== 0) throw toolError('transport_lost');
    const members = await groupMembers(pid);
    check();
    if (members.some(member => member !== pid)) throw toolError('transport_lost');
  })().finally(() => { workSettled = true; });
  let primary: unknown;
  try { await Promise.race([work, stopped]); }
  catch (error) { primary = error; }
  finally {
    fenced = true; clearTimeout(timer); context.signal.removeEventListener('abort', onAbort);
  }
  const cleanupDeadline = Date.now() + 2500;
  try {
    if (!pid) throw toolError('cleanup_failed');
    if (!exited) {
      let members = await groupMembers(pid);
      if (members.some(member => member !== pid)) {
        // Signal the known-live group anchor, never a PID adopted from disk.
        if (!exited) signalGroup(pid, 'SIGTERM');
        const grace = Math.min(cleanupDeadline, Date.now() + 250);
        do { await delay(20); members = await groupMembers(pid); }
        while (!exited && members.some(member => member !== pid) && Date.now() < grace);
      }
      if (!exited && !members.some(member => member !== pid)) await send({ type: 'exit' });
      else if (!exited) signalGroup(pid, 'SIGKILL');
      if (!exited) {
        await until(done, Math.min(cleanupDeadline, Date.now() + 250)).catch(() => undefined);
        if (!exited) signalGroup(pid, 'SIGKILL');
      }
    }
    await until(done, cleanupDeadline);
    // A dead wrapper does not prove that its descendants or inherited pipes ended.
    while ((await groupMembers(pid)).length) {
      if (Date.now() >= cleanupDeadline) throw toolError('cleanup_failed');
      await delay(20);
    }
    await until(pipesClosed, cleanupDeadline);
    await until(work.catch(() => undefined), cleanupDeadline);
    if (!closed || !workSettled) throw toolError('cleanup_failed');
    await journal?.checkpoint('settled', pid);
    await journal?.complete();
  } catch {
    child.stdout?.destroy(); child.stderr?.destroy();
    if (child.connected) child.disconnect();
    // Retain all durable evidence, even when only the journal commit failed.
    throw new NativeError('cleanup_failed', 'Native tool process or recovery cleanup could not be confirmed.',
      primary instanceof NativeError ? { cause: primary } : undefined);
  }
  if (primary) throw primary instanceof NativeError ? primary : toolError('transport_lost');
  return Buffer.concat(chunks);
}

/** Windows keeps the pre-existing direct-child executor; crash evidence stays invalid. */
async function executeWindowsTool(program: string, args: readonly string[], context: NativeOperationContext,
  journal?: NativeToolJournal, env?: NodeJS.ProcessEnv): Promise<Buffer> {
  const remaining = context.deadline - Date.now();
  if (remaining <= 0) {
    try { await journal?.cancelBeforeSpawn(); } catch { throw toolError('cleanup_failed'); }
    throw toolError('timeout');
  }
  let child: ReturnType<typeof execFile> | undefined;
  const result = new Promise<{ output?: Buffer; error?: ExecFileException }>(resolve => {
    child = execFile(program, [...args], { encoding: 'buffer', timeout: remaining, signal: context.signal, env,
      killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      resolve(error ? { error } : { output: stdout as Buffer });
    });
  });
  try {
    if (journal && child?.pid) {
      await journal.checkpoint('gated', child.pid);
      await journal.checkpoint('running', child.pid);
    }
    const settled = await result;
    if (context.signal.aborted) throw toolError('cancelled');
    if (Date.now() >= context.deadline) throw toolError('timeout');
    if (settled.error) {
      if (settled.error.code === 'ENOENT') throw new NativeError('transport_lost', 'Native platform tool is not installed or executable.');
      throw toolError(settled.error.killed ? 'timeout' : 'transport_lost');
    }
    if (journal && child?.pid) await journal.checkpoint('settled', child.pid);
    await journal?.complete();
    return settled.output ?? Buffer.alloc(0);
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await result;
    throw error;
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw toolError('cleanup_failed'); }
}
async function groupMembers(group: number): Promise<number[]> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile('/bin/ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8', timeout: 1000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => error ? reject(toolError('cleanup_failed')) : resolve(stdout));
  });
  const records = output.trim().split('\n').map(line => /^\s*([1-9]\d*)\s+([1-9]\d*)\s+(\S+)\s*$/.exec(line));
  if (records.some(record => !record)) throw toolError('cleanup_failed');
  return records.filter(record => Number(record![2]) === group && !record![3].includes('Z')).map(record => Number(record![1]));
}
async function until(work: Promise<unknown>, deadline: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(toolError('cleanup_failed')), Math.max(0, deadline - Date.now())); })]); }
  finally { clearTimeout(timer); }
}
function toolError(code: 'cancelled' | 'timeout' | 'transport_lost' | 'cleanup_failed'): NativeError {
  return new NativeError(code, code === 'cancelled' ? 'Native platform tool request cancelled.' : code === 'timeout' ? 'Native platform tool deadline exceeded.'
    : code === 'cleanup_failed' ? 'Native tool ownership or cleanup could not be confirmed.' : 'Native platform tool failed; inspect tool availability and device connection.');
}
