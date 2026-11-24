import React, { useState, type FormEvent } from 'react';
import { Settings2 } from 'lucide-react';
import type { ProjectWorkerBinding } from '../catalog-scan-status.js';
import { api, useData } from './data.js';
import { Alert } from './components/ui/alert.js';
import { Badge } from './components/ui/badge.js';
import { Button } from './components/ui/button.js';
import { Card } from './components/ui/card.js';
import { Checkbox } from './components/ui/checkbox.js';
import { CloudDialog, DialogFooter } from './components/ui/dialog.js';

const healthLabels = { healthy: '在线', offline: '已离线', unseen: '尚未连接', quarantined: '已隔离' };

export function ProjectWorkers({ project, editable }: { project: { id: string; name: string }; editable: boolean }) {
  const path = `/api/projects/${encodeURIComponent(project.id)}/workers`;
  const { data, error, reload, update } = useData<ProjectWorkerBinding[]>(path, 5000);
  const [edit, setEdit] = useState<{ original: string[]; selected: string[] }>();
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const bound = data?.filter(worker => worker.bound) ?? [];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!edit || busy) return;
    setBusy(true);
    setSaveError('');
    try {
      update(await api<ProjectWorkerBinding[]>(path, 'PUT', { workerIds: edit.selected, expectedWorkerIds: edit.original }));
      setEdit(undefined);
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <Card asChild><section aria-label="绑定 Worker" className="space-y-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3>绑定 Worker</h3>
      {editable && <Button variant="outline" size="sm" disabled={!data?.length || !!error} onClick={() => {
        const selected = bound.map(worker => worker.id);
        setEdit({ original: selected, selected });
        setSaveError('');
      }}><Settings2 />选择 Worker</Button>}
    </div>
    {error && <Alert role="alert">{error}<Button variant="ghost" size="sm" onClick={reload}>重试</Button></Alert>}
    {!data && !error && <p role="status" className="text-muted-foreground">正在读取 Worker…</p>}
    {data && (bound.length ? <ul className="divide-y">{bound.map(worker => <li key={worker.id} className="flex flex-wrap items-center gap-2 py-2">
      <span className="wrap-anywhere font-medium">{worker.id}</span><Badge variant="secondary">{healthLabels[worker.health]}</Badge>{worker.paused && <Badge variant="secondary">执行调度已暂停</Badge>}
    </li>)}</ul> : <p className="text-muted-foreground">{data.length ? '尚未绑定 Worker' : '尚无已注册的 Worker'}</p>)}
    {edit && <CloudDialog title="选择 Worker" description={project.name} busy={busy} onClose={() => setEdit(undefined)}>
      <form onSubmit={save}>
        <div className="space-y-2 p-4">
          {saveError && <Alert role="alert" variant="destructive">{saveError}</Alert>}
          <fieldset disabled={busy} className="max-h-72 space-y-1 overflow-y-auto">
            <legend className="sr-only">项目 Worker</legend>
            {data?.map(worker => <label key={worker.id} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
              <Checkbox aria-label={worker.id} checked={edit.selected.includes(worker.id)} onCheckedChange={checked => {
                setEdit({ ...edit, selected: checked === true ? [...edit.selected, worker.id] : edit.selected.filter(id => id !== worker.id) });
              }} />
              <span className="min-w-0 flex-1 wrap-anywhere">{worker.id}</span><span className="text-xs text-muted-foreground">{healthLabels[worker.health]}</span>
            </label>)}
          </fieldset>
        </div>
        <DialogFooter className="border-t p-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setEdit(undefined)}>取消</Button>
          <Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存绑定'}</Button>
        </DialogFooter>
      </form>
    </CloudDialog>}
  </section></Card>;
}
