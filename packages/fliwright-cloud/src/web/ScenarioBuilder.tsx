import React, { useState } from 'react';
import type { TestCatalog } from '@fliwright/cloud-protocol';
import { scenarioFiles, type ScenarioDraft } from './scenario-builder.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';
import { Checkbox } from './components/ui/checkbox.js';
import { NativeSelect } from './components/ui/native-select.js';
import { Textarea } from './components/ui/textarea.js';
import { CloudDialog as Dialog, DialogFooter } from './components/ui/dialog.js';

export function ScenarioBuilder({ catalog, close }: { catalog?: TestCatalog; close: () => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ScenarioDraft>({ name: '', profile: '', route: '', directory: '', allowUnmatched: false, rules: [] });
  const [notice, setNotice] = useState('');
  const [copying, setCopying] = useState(false);
  let files: ReturnType<typeof scenarioFiles> | undefined;
  let error = '';
  try { files = scenarioFiles(draft, catalog); } catch (cause) { error = (cause as Error).message; }
  const directory = catalog?.mocks?.find(item => item.directory === draft.directory);
  const profiles = directory ? [...new Set(directory.profiles ?? directory.endpoints.flatMap(item => item.rules))].sort() : [];
  const selectedRule = (endpoint: NonNullable<typeof directory>['endpoints'][number]) => {
    const override = draft.rules.find(item => item.endpoint === endpoint.endpoint && item.method.toUpperCase() === endpoint.method.toUpperCase());
    return override?.rule ?? (draft.profile && endpoint.rules.includes(draft.profile) ? draft.profile : endpoint.activeRule);
  };
  const updateRule = (endpoint: NonNullable<typeof directory>['endpoints'][number], value: string) => {
    const baseline = draft.profile && endpoint.rules.includes(draft.profile) ? draft.profile : endpoint.activeRule;
    const rules = draft.rules.filter(item => !(item.endpoint === endpoint.endpoint && item.method.toUpperCase() === endpoint.method.toUpperCase()));
    if (value !== baseline) rules.push({ endpoint: endpoint.endpoint, method: endpoint.method, rule: value });
    setDraft({ ...draft, rules });
  };
  const copy = async (value: string, label: string) => {
    setCopying(true); setNotice('');
    try { await navigator.clipboard.writeText(value); setNotice(`${label}已复制。`); }
    catch { setNotice('复制失败，请在下方预览中选择并手动复制。'); }
    finally { setCopying(false); }
  };
  const download = () => {
    if (!files) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([files.source], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = files.filename;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setNotice(`已生成下载文件 ${files.filename}，请保存到 .fliwright/scenarios/。`);
    } catch { setNotice('下载失败，请复制下方配置并保存为场景文件。'); }
    finally { if (url) URL.revokeObjectURL(url); }
  };
  return <Dialog title="新建运行场景" description="选择 Mock profile 和起始页面，生成可提交到仓库的配置。登录态和业务初始数据由 Mock profile 决定。" wide onClose={close}>
    <div className="p-4 space-y-5">
      <ol aria-label="场景配置步骤" className="flex flex-wrap gap-4 text-sm text-muted-foreground">{['基础信息', 'Mock 组合', '生成配置'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step === index ? 'font-medium text-foreground' : ''}>{index + 1}. {label}</li>)}</ol>
      {step === 0 && <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 md:col-span-2"><span>场景名称</span><Input autoFocus aria-label="场景名称" placeholder="例如 member-empty-assets" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /><span className="text-xs leading-[1.45] text-muted-foreground">使用能描述初始条件的名称，可包含中文、字母、数字、点、横线和下划线。</span></label>
        <label className="grid gap-2"><span>起始页面（可选）</span><Input aria-label="起始页面" placeholder="例如 /assets" value={draft.route} onChange={event => setDraft({ ...draft, route: event.target.value })} /></label>
        <p className="text-xs leading-[1.45] text-muted-foreground md:col-span-2">登录、未登录、会话过期和不同用户等状态都应由仓库里的 Mock profile 表达，向导不会直接注入登录态。</p>
      </div>}
      {step === 1 && <div className="space-y-4">
        <p className="text-xs leading-[1.45] text-muted-foreground">先加载目录中的默认规则，再应用 Mock profile，最后应用你选择的接口覆盖。profile 负责组合登录态和业务初始数据。</p>
        <label className="grid gap-2"><span>Mock 目录</span><NativeSelect aria-label="Mock 目录" value={draft.directory} onChange={event => {
          setDraft({ ...draft, directory: event.target.value, profile: '', rules: [] });
        }}><option value="">由测试自行准备 Mock</option>{catalog?.mocks?.map(item => <option key={item.directory} value={item.directory}>{item.directory}（{item.endpoints.length} 个接口）</option>)}</NativeSelect></label>
        {!catalog?.mocks?.length && <div role="status" className="rounded-lg bg-muted/40 p-4 space-y-2"><p>当前版本没有可选的 Mock 规则。</p><p className="text-xs leading-[1.45] text-muted-foreground">请将文件规则提交到 .fliwright/mocks/api/*.json 后重新扫描；测试代码中临时注册的 Mock 不会出现在这里。已扫描过的旧版本也需要重新扫描才能发现规则。</p><p className="text-xs leading-[1.45] text-muted-foreground">你仍可生成起始页面配置，测试也可以自行准备 Mock。</p></div>}
        {directory && <>
          <label className="grid gap-2"><span>Mock profile</span><NativeSelect aria-label="Mock profile" value={draft.profile} onChange={event => setDraft({ ...draft, profile: event.target.value, rules: [] })}><option value="">不使用 profile（仅加载默认规则）</option>{profiles.map(profile => <option key={profile} value={profile}>{profile}</option>)}</NativeSelect><span className="text-xs leading-[1.45] text-muted-foreground">候选来自仓库声明过的 profile 和接口规则名；选择后会对所有包含该规则的接口生效。</span></label>
          <div className="max-h-72 overflow-auto rounded-lg bg-muted/30 p-3 space-y-4">{directory.endpoints.map(endpoint => <label key={`${endpoint.method}:${endpoint.endpoint}`} className="grid gap-2"><span className="break-all text-sm"><span className="font-medium">{endpoint.method}</span> {endpoint.endpoint}</span><NativeSelect aria-label={`Mock 规则 ${endpoint.method} ${endpoint.endpoint}`} value={selectedRule(endpoint)} onChange={event => updateRule(endpoint, event.target.value)}>{endpoint.rules.map(rule => <option key={rule} value={rule}>{rule}{rule === endpoint.activeRule ? '（默认）' : ''}{rule === draft.profile ? '（profile）' : ''}</option>)}</NativeSelect></label>)}</div>
          <label className="flex items-center gap-2"><Checkbox checked={draft.allowUnmatched} onCheckedChange={value => setDraft({ ...draft, allowUnmatched: value === true })} />允许未匹配请求访问真实接口</label>
        </>}
      </div>}
      {step === 2 && files && <div className="space-y-4">
        <p className="text-sm">1. 将场景文件保存为 <code className="break-all">.fliwright/scenarios/{files.filename}</code></p>
        <Textarea aria-label="场景文件预览" readOnly rows={12} className="font-mono text-xs" value={files.source} />
        <div className="flex gap-2"><Button variant="outline" disabled={copying} onClick={() => void copy(files!.source, '场景文件')}>复制场景文件</Button><Button variant="outline" onClick={download}>下载场景文件</Button></div>
        <p className="text-sm">2. 在已有的 <code>fliwright.config.ts</code> 中添加导入，并合并场景属性，保留其他配置和已有场景。</p>
        <Textarea aria-label="配置接入预览" readOnly rows={8} className="font-mono text-xs" value={files.integration} />
        <Button variant="outline" disabled={copying} onClick={() => void copy(files!.integration, '接入代码')}>复制接入代码</Button>
        <p className="rounded-lg bg-muted/40 p-4 text-sm">3. 提交并推送文件到目标分支 → 重新扫描仓库 → 管理员在项目设置中确认就绪，然后选择新场景运行测试。</p>
      </div>}
      {error && draft.name && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>
    <DialogFooter className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3"><Button variant="ghost" onClick={close}>关闭</Button>{step > 0 && <Button variant="outline" onClick={() => { setStep(step - 1); setNotice(''); }}>上一步</Button>}{step < 2 && <Button disabled={!files} onClick={() => { setStep(step + 1); setNotice(''); }}>{step === 1 ? '生成配置' : '下一步'}</Button>}</DialogFooter>
  </Dialog>;
}
