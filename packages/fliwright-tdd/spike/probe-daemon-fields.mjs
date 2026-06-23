import { spawn } from 'node:child_process';

const child = spawn('flutter', ['daemon'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    console.log('<<', line);
    try {
      const msgs = JSON.parse(line);
      if (msgs.some((m) => m.event === 'daemon.connected')) {
        child.stdin.write(`${JSON.stringify([{ id: '1', method: 'device.getDevices' }])}\n`);
      }
    } catch {}
  }
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

setTimeout(() => {
  child.kill();
  process.exit(0);
}, 15_000);
