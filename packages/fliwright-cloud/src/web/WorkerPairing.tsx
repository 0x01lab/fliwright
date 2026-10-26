import React, { useState } from 'react';
import type { WorkerPairingStatus } from '@fliwright/cloud-protocol';
import { api, useData } from './data.js';
import { Button } from './components/ui/button.js';
import { Card } from './components/ui/card.js';
import { Input } from './components/ui/input.js';
const stateLabel = { pending: '等待输入配对码', paired: '已配对', expired: '已过期', revoked: '已撤销' };

/** Administrator enrollment and durable credential revocation, without displaying tokens. */
export function WorkerPairing({ role }: { role?: string }) {
  return role === 'admin' ? <PairingControls /> : null;
}
function PairingControls() {
  const [workerId, setWorkerId] = useState('');
  const [created, setCreated] = useState<(WorkerPairingStatus & { code: string })>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: pairings, reload, error: loadError } = useData<WorkerPairingStatus[]>('/api/worker-pairings', 3000);
  const current = pairings?.find(pairing => pairing.id === created?.id) ?? created;
  async function revoke(id: string) {
    setBusy(true);
    try {
      await api(`/api/worker-pairings/${id}`, 'DELETE');
      if (created?.id === id) setCreated(undefined);
      setError(''); reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Card className="p-5 space-y-4">
    <h2>添加 Worker 主机</h2>
    <p className="text-sm text-muted-foreground">生成配对码后，在打包机输入即可连接。配对码 10 分钟内有效且只能使用一次。</p>
    {(error || loadError) && <p role="alert">{error || loadError}</p>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError('');
      try {
        setCreated(await api<WorkerPairingStatus & { code: string }>('/api/worker-pairings', 'POST', { workerId }));
        reload();
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}>
      <label className="space-y-2">主机 ID<Input aria-label="主机 ID" value={workerId} placeholder="mac-mini-01" onChange={event => setWorkerId(event.target.value)} /></label>
      <Button type="submit" disabled={busy || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(workerId)}>生成配对码</Button>
    </form>
    {created && current?.state === 'pending' && <div className="space-y-3 rounded-lg bg-muted p-4" role="status">
      <p>配对码：<strong className="font-mono select-all">{created.code}</strong></p>
      <p>有效至 {new Date(created.expiresAt).toLocaleTimeString()}。请仅在目标打包机输入。</p>
      <p>在打包机运行（目录需尚不存在）：</p>
      <pre className="overflow-x-auto"><code>{`fliwright-worker pair ${JSON.stringify(window.location.origin)} ./cloud-worker`}</code></pre>
      <p>配对成功后，按终端提示运行 fliwright-worker run，再到“设备”页面选择允许的应用。槽位和本机执行环境自动配置。</p>
      <Button variant="secondary" disabled={busy} onClick={() => void revoke(created.id)}>撤销配对码</Button>
    </div>}
    {created && current?.state === 'paired' && <p role="status">主机 {created.workerId} 已配对，请按终端提示启动 Worker。</p>}
    {created && current?.state === 'expired' && <p role="status">配对码已过期，请重新生成。</p>}
    <div className="space-y-2" aria-label="配对记录">
      {pairings?.map(pairing => <div key={pairing.id} className="flex flex-wrap items-center gap-3 py-2">
        <span>{pairing.workerId}</span><span className="text-sm text-muted-foreground">{stateLabel[pairing.state]}</span>
        {['pending', 'paired'].includes(pairing.state) && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke(pairing.id)}>{pairing.state === 'paired' ? '撤销主机凭据' : '撤销配对码'}</Button>}
      </div>)}
    </div>
  </Card>;
}
