import React, { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Alert } from './components/ui/alert.js';
import { Button } from './components/ui/button.js';
import { CloudDialog, DialogFooter } from './components/ui/dialog.js';
import { Input } from './components/ui/input.js';
import { Label } from './components/ui/label.js';
import { NativeSelect } from './components/ui/native-select.js';
import { api, useData } from './data.js';

type Target = {
  id: string;
  name: string;
  suites: string[];
  scenarios: string[];
};

function NewRequestDialog({ initialTargetId, close }: { initialTargetId?: string; close: () => void }) {
  const navigate = useNavigate();
  const { data: targets, error: loadError, reload } = useData<Target[]>('/api/targets');
  const [targetId, setTargetId] = useState(initialTargetId);
  const [suite, setSuite] = useState('');
  const [scenario, setScenario] = useState('');
  const [commit, setCommit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastSubmission = useRef<{ fingerprint: string; key: string }>();
  const target = targetId ? targets?.find(item => item.id === targetId) : targets?.[0];
  const selectedSuite = target?.suites.includes(suite) ? suite : target?.suites[0];
  const selectedScenario = target?.scenarios.includes(scenario) ? scenario : '';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !target || !selectedSuite) return;
    const input = {
      targetId: target.id,
      commit,
      suite: selectedSuite,
      ...(selectedScenario ? { scenario: selectedScenario } : {}),
    };
    const fingerprint = JSON.stringify(input);
    if (lastSubmission.current?.fingerprint !== fingerprint) {
      lastSubmission.current = { fingerprint, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError('');
    let request: { id: string };
    try {
      request = await api<{ id: string }>('/api/requests', 'POST', input, lastSubmission.current.key);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
      return;
    }
    close();
    toast.success('已加入队列', {
      action: {
        label: '查看任务',
        onClick: () => void navigate({ to: '/requests/$id', params: { id: request.id }, search: { targetId: initialTargetId } }),
      },
    });
  }

  return (
    <CloudDialog
      title="新建测试任务"
      onClose={close}
      busy={busy}
      className="grid-rows-[auto_minmax(0,1fr)] overflow-hidden max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
    >
      <form className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]" onSubmit={submit}>
        <div className="grid min-h-0 content-start gap-3 overflow-y-auto p-4">
          {loadError && <Alert asChild variant="destructive"><div role="alert">
            {loadError} <Button type="button" variant="ghost" onClick={reload}>重试</Button>
          </div></Alert>}
          {error && <Alert asChild variant="destructive"><div role="alert">{error}</div></Alert>}
          <fieldset disabled={busy} className="grid min-w-0 gap-3 [&_label]:grid [&_label]:gap-1.5">
            <Label>
              应用
              <NativeSelect
                value={target?.id ?? ''}
                disabled={!targets?.length}
                onChange={event => {
                  setTargetId(event.target.value);
                  setSuite('');
                  setScenario('');
                }}
              >
                {!target && <option value="">{targets?.length ? '请选择应用' : !targets && !loadError ? '正在加载应用…' : '暂无可选应用'}</option>}
                {targets?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </NativeSelect>
            </Label>
            <Label>
              Git commit SHA
              <Input
                required
                pattern="[0-9a-f]{40}"
                placeholder="完整的 40 位提交 SHA"
                value={commit}
                onChange={event => setCommit(event.target.value.trim())}
              />
            </Label>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <Label className="min-w-0">
                测试套件
                <NativeSelect value={selectedSuite ?? ''} disabled={!selectedSuite} onChange={event => setSuite(event.target.value)}>
                  {!selectedSuite && <option value="">暂无可选套件</option>}
                  {target?.suites.map(item => <option key={item}>{item}</option>)}
                </NativeSelect>
              </Label>
              <Label className="min-w-0">
                测试场景
                <NativeSelect value={selectedScenario} disabled={!target} onChange={event => setScenario(event.target.value)}>
                  <option value="">直接运行（无场景）</option>
                  {target?.scenarios.map(item => <option key={item}>{item}</option>)}
                </NativeSelect>
              </Label>
            </div>
          </fieldset>
        </div>
        <DialogFooter className="border-t bg-card px-4 py-3 max-sm:pb-[max(.75rem,env(safe-area-inset-bottom))] [&_button]:max-sm:min-h-9">
          <Button type="button" variant="outline" disabled={busy} onClick={close}>取消</Button>
          <Button type="submit" disabled={busy || !selectedSuite}>{busy ? '正在提交…' : '提交并加入队列'}</Button>
        </DialogFooter>
      </form>
    </CloudDialog>
  );
}

export function RequestSubmission({ targetId }: { targetId?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button
      className="workspace-submit"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="提交测试"
      title="提交测试"
      onClick={event => {
        event.currentTarget.focus({ preventScroll: true });
        setOpen(true);
      }}
    >
      <Plus /><span>提交测试</span>
    </Button>
    {open && <NewRequestDialog initialTargetId={targetId} close={() => setOpen(false)} />}
  </>;
}
