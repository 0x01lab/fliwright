import React, { useEffect, useState } from 'react';
import { Check, CircleCheck, Clock3, Copy, History, Plus, Terminal } from 'lucide-react';
import type { ExecutionWorker, WorkerPairingStatus } from '@fliwright/cloud-protocol';
import { api, useData } from './data.js';
import { Button } from './components/ui/button.js';
import { CloudDialog, DialogFooter } from './components/ui/dialog.js';
import { Input } from './components/ui/input.js';

const stateLabel = { pending: '等待配对', paired: '已配对', expired: '已过期', revoked: '已撤销' };
const steps = ['命名主机', '终端配对', '连接状态'];
const validId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
type Enrollment = WorkerPairingStatus & { code?: string };

function countdown(expiresAt: number, now: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function CopyCommand({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState('');
  return <div className="grid min-w-0 gap-1.5">
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 font-medium"><Terminal className="size-4" />{label}</span>
      <Button size="sm" variant="ghost" aria-label={`复制${label}`} onClick={async () => {
        try { await navigator.clipboard.writeText(value); setFeedback('已复制'); }
        catch { setFeedback('请选中文字后复制'); }
      }}><Copy /><span aria-live="polite">{feedback || '复制'}</span></Button>
    </div>
    <code className="select-all break-all rounded-md bg-code p-3 text-code-foreground">{value}</code>
  </div>;
}

/** Administrator-only enrollment and credential management. */
export function WorkerPairing({ role, workers }: { role?: string; workers?: ExecutionWorker[] }) {
  return role === 'admin' ? <PairingControls workers={workers} /> : null;
}

const cli = 'npx --yes @fliwright/cloud-worker';

function PairingControls({ workers }: { workers?: ExecutionWorker[] }) {
  const [panel, setPanel] = useState<'wizard' | 'history' | null>(null);
  const [workerId, setWorkerId] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [confirm, setConfirm] = useState<WorkerPairingStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data: records, update, error: loadError } = useData<WorkerPairingStatus[]>('/api/worker-pairings', 3000, !!panel || !!enrollment);
  const current = records?.find(row => row.id === enrollment?.id) ?? enrollment;
  const [, tick] = useState(0);
  const now = Date.now();
  const state = current?.state === 'pending' && current.expiresAt <= now ? 'expired' : current?.state;
  const ticking = panel === 'wizard' ? state === 'pending' : panel === 'history' && records?.some(row => row.state === 'pending' && row.expiresAt > now);
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => tick(n => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  const step = !current ? 0 : state === 'paired' ? 2 : 1;
  const host = workers?.find(w => w.id === current?.workerId);
  const online = host?.health === 'healthy';
  const duplicate = records?.find(row => row.workerId === workerId && row.state === 'pending' && row.expiresAt > now);
  const history = records?.map(row => row.state === 'pending' && row.expiresAt <= now ? { ...row, state: 'expired' as const } : row);
  const replacing = records?.some(row => row.workerId === workerId && row.state === 'paired');

  function close() { setPanel(null); setConfirm(undefined); setError(''); }
  function finish() { setEnrollment(undefined); setWorkerId(''); close(); }
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !validId.test(workerId) || duplicate) return;
    setBusy(true); setError('');
    try {
      const created = await api<Enrollment>('/api/worker-pairings', 'POST', { workerId });
      setEnrollment(created);
    } catch (e) {
      const message = (e as Error).message;
      setError(message === 'Worker ID already registered or awaiting pairing' ? '此主机 ID 已注册或正在等待配对，请检查配对记录或使用其他 ID。' : message);
    }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!confirm || busy) return;
    setBusy(true); setError('');
    try {
      const revoked = await api<WorkerPairingStatus>(`/api/worker-pairings/${confirm.id}`, 'DELETE');
      update(rows => rows?.map(row => row.id === revoked.id ? revoked : row));
      if (enrollment?.id === revoked.id) setEnrollment(revoked);
      setConfirm(undefined);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="ghost" onClick={() => { setError(''); setPanel('history'); }}><History />配对记录</Button>
    <Button onClick={() => { setError(''); setPanel('wizard'); }}><Plus />{enrollment ? '继续配对' : '添加 Worker 主机'}</Button>
    {panel && <CloudDialog title={confirm ? '确认撤销' : panel === 'history' ? '配对记录' : '添加 Worker 主机'} onClose={close} busy={busy}>
      <div className="grid min-w-0 gap-5 p-5">
        {error && <p className="text-destructive" role="alert">{error}</p>}
        {loadError && <p className="text-destructive" role="alert">配对状态更新失败，正在重试。{loadError}</p>}
        {confirm ? <>
          <p className="break-words">{confirm.state === 'paired' ? `撤销 ${confirm.workerId} 的凭据会断开该主机的连接。再次连接需要重新配对。` : `撤销 ${confirm.workerId} 的配对码后，该码立即失效。如果主机已使用此码配对，其凭据也将失效。`}</p>
          <DialogFooter><Button variant="secondary" disabled={busy} onClick={() => { setConfirm(undefined); setError(''); }}>返回</Button><Button variant="destructive" disabled={busy} onClick={() => void revoke()}>确认撤销</Button></DialogFooter>
        </> : panel === 'history' ? <>
          {!records && !loadError && <p role="status">正在读取配对记录…</p>}
          {records?.length === 0 && <p className="text-muted-foreground">暂无配对记录。</p>}
          {history?.some(row => row.state === 'pending') && <p className="text-muted-foreground">配对码仅在创建时显示。若已丢失，请撤销旧码后重新配对。</p>}
          <ul className="divide-y">{history?.map(row => <li className="flex flex-wrap items-center gap-3 py-3" key={row.id}>
            <div className="min-w-0 flex-1"><strong className="break-all">{row.workerId}</strong><p className="text-muted-foreground">{stateLabel[row.state]}{row.state === 'pending' && ` · 剩余 ${countdown(row.expiresAt, now)}`}</p></div>
            {row.state === 'paired' && state !== 'pending' && <Button variant="ghost" size="sm" onClick={() => { setEnrollment(row); setWorkerId(row.workerId); setPanel('wizard'); }}>启动指引</Button>}
            {(row.state === 'pending' || row.state === 'paired') && <Button variant="secondary" size="sm" onClick={() => setConfirm(row)}>{row.state === 'pending' ? '撤销配对码' : '撤销主机凭据'}</Button>}
          </li>)}</ul>
        </> : <>
          <ol aria-label="配对步骤" className="grid grid-cols-3 gap-2">{steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} className={`flex items-center gap-1.5 ${index === step ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
            <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${index === step ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{index < step ? <Check className="size-3" /> : index + 1}</span>{label}
          </li>)}</ol>
          {step === 0 && <form onSubmit={generate} className="grid gap-4">
            <div className="grid gap-2"><label htmlFor="worker-id" className="text-sm font-medium">主机 ID</label>
              <Input id="worker-id" value={workerId} autoComplete="off" maxLength={100} placeholder="例如 mac-mini-01" aria-describedby={workerId && !validId.test(workerId) ? 'worker-id-help' : undefined} aria-invalid={!!workerId && !validId.test(workerId)} onChange={event => { setWorkerId(event.target.value); setError(''); }} />
              {workerId && !validId.test(workerId) && <p id="worker-id-help" className="text-destructive">以字母或数字开头，仅支持字母、数字、短横线和下划线。</p>}
            </div>
            {duplicate && <p role="status">此主机已有待使用的配对码。可在配对记录中撤销后重新生成。</p>}
            {replacing && <p role="status">此 ID 已配对。新主机使用配对码后，原主机的凭据将失效。</p>}
            <DialogFooter>{duplicate && <Button variant="secondary" onClick={() => setPanel('history')}>查看配对记录</Button>}<Button type="submit" disabled={busy || !validId.test(workerId) || !!duplicate}>{busy ? '正在生成…' : '生成配对码'}</Button></DialogFooter>
          </form>}
          {current && enrollment?.code && state === 'pending' && <>
            <p>在 <strong className="break-all">{current.workerId}</strong> 的终端运行。<code>./cloud-worker</code> 必须是新目录。</p>
            <CopyCommand label="配对并启动命令" value={`${cli} pair ${shellQuote(window.location.origin)} ./cloud-worker --code ${shellQuote(enrollment.code)} --start`} />
            <p className="text-muted-foreground">配对码剩余 <span role="timer" className="font-mono tabular-nums">{countdown(current.expiresAt, now)}</span></p>
            <div className="flex flex-wrap items-center justify-between gap-2"><span role="status" className="inline-flex items-center gap-2 text-muted-foreground"><Clock3 className="size-4" />等待主机完成配对…</span><Button variant="ghost" onClick={() => setConfirm(current)}>撤销配对码</Button></div>
          </>}
          {current && (state === 'revoked' || state === 'expired') && <><p role="status">{current.workerId} 的配对码{stateLabel[state]}。</p><DialogFooter><Button onClick={() => { setEnrollment(undefined); setWorkerId(current.workerId); }}>重新配对</Button></DialogFooter></>}
          {current && state === 'paired' && <>
            <div role="status" className="flex items-center gap-2 text-sm font-semibold"><CircleCheck className="size-5 text-pass-ink" /><span className="break-all">{current.workerId} 已配对</span></div>
            {!enrollment?.code && <CopyCommand label="启动命令" value={`${cli} run ./cloud-worker/worker.json`} />}
            <p role="status" className="rounded-md bg-muted p-3">{online ? '主机在线' : '等待主机上线…'}</p>
            <DialogFooter><Button onClick={finish}>返回主机列表</Button></DialogFooter>
          </>}
        </>}
      </div>
    </CloudDialog>}
  </>;
}
