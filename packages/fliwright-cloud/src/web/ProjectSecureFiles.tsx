import React, { useState, type FormEvent } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { secureFileMaxBytes, secureFilePathSchema, type ProjectSecureFile } from '@fliwright/cloud-protocol/secure-files';
import { useData } from './data.js';
import { Alert } from './components/ui/alert.js';
import { Button } from './components/ui/button.js';
import { Card } from './components/ui/card.js';
import { CloudDialog, DialogFooter } from './components/ui/dialog.js';
import { Input } from './components/ui/input.js';

export function ProjectSecureFiles({ projectId }: { projectId: string }) {
  const apiPath = `/api/projects/${encodeURIComponent(projectId)}/secure-files`;
  const files = useData<ProjectSecureFile[]>(apiPath);
  const [dialog, setDialog] = useState<'upload' | ProjectSecureFile>();
  const [path, setPath] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dialog || busy) return;
    const uploading = dialog === 'upload';
    if (uploading && (!file || !secureFilePathSchema.safeParse(path).success || !file.size || file.size > secureFileMaxBytes)) {
      setError('请选择 1 MiB 以内的非空文件，并填写项目内相对路径。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = uploading
        ? await fetch(`${apiPath}?${new URLSearchParams({ path })}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file })
        : await fetch(`${apiPath}/${encodeURIComponent(dialog.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error ?? '文件操作失败');
      setDialog(undefined);
      files.reload();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <Card asChild><section aria-label="安全文件" className="space-y-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3>安全文件</h3>
      <Button variant="outline" size="sm" onClick={() => { setPath(''); setFile(undefined); setError(''); setDialog('upload'); }}><Upload />上传文件</Button>
    </div>
    {files.error && <Alert role="alert">{files.error}<Button variant="ghost" size="sm" onClick={files.reload}>重试</Button></Alert>}
    {!files.data && !files.error && <p role="status" className="text-muted-foreground">正在读取安全文件…</p>}
    {files.data && (files.data.length ? <ul className="divide-y">{files.data.map(item => <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
      <code className="min-w-0 flex-1 wrap-anywhere">{item.path}</code>
      <span className="text-xs text-muted-foreground">{item.size < 1024 ? `${item.size} B` : `${(item.size / 1024).toFixed(1)} KiB`}</span>
      <Button variant="ghost" size="icon" aria-label={`删除 ${item.path}`} title="删除安全文件" onClick={() => { setError(''); setDialog(item); }}><Trash2 /></Button>
    </li>)}</ul> : <p className="text-muted-foreground">暂无安全文件</p>)}
    {dialog && <CloudDialog title={dialog === 'upload' ? '上传安全文件' : '删除安全文件'} busy={busy} onClose={() => setDialog(undefined)}>
      <form onSubmit={submit}>
        <div className="space-y-3 p-4">
          {error && <Alert role="alert" variant="destructive">{error}</Alert>}
          {dialog === 'upload' ? <fieldset disabled={busy} className="grid gap-3">
            <label className="grid gap-1">文件<Input type="file" required onChange={event => {
              const selected = event.target.files?.[0];
              setFile(selected);
              if (selected && !path) setPath(selected.name);
            }} /></label>
            <label className="grid gap-1">项目内路径<Input required value={path} placeholder=".env/sentry.dev.json" maxLength={240} onChange={event => setPath(event.target.value)} /></label>
          </fieldset> : <p>删除 <code className="wrap-anywhere">{dialog.path}</code>？</p>}
        </div>
        <DialogFooter className="border-t p-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setDialog(undefined)}>取消</Button>
          <Button type="submit" disabled={busy} variant={dialog === 'upload' ? 'default' : 'destructive'}>{dialog === 'upload' ? '上传' : '删除'}</Button>
        </DialogFooter>
      </form>
    </CloudDialog>}
  </section></Card>;
}
