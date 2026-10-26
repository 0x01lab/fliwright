import React, { useEffect, useState, type FormEvent } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from '@tanstack/react-router';
import type {
  ManagedDevice,
  DeviceBlocker,
  DeviceSettings,
} from '@fliwright/cloud-protocol';
import { api, useData } from './data.js';
import { Card } from './components/ui/card.js';
import { Input } from './components/ui/input.js';
import { Button } from './components/ui/button.js';
import { Badge } from './components/ui/badge.js';
import { Label } from './components/ui/label.js';
import { Checkbox } from './components/ui/checkbox.js';
import { NativeSelect } from './components/ui/native-select.js';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from './components/ui/table.js';

const states = {
  online: '在线',
  offline: '离线',
  unauthorized: '未授权',
  shutdown: '未启动',
  unavailable: '不可用',
  unknown: '未知',
};
const reasons: Record<DeviceBlocker, string> = {
  unmanaged: '尚未纳管',
  disabled: '已暂停调度',
  missing: '本次未发现',
  stale: '检测结果已过期',
  'not-online': '设备未在线',
  'worker-paused': '主机已暂停',
  'no-slot': '未配置执行槽位',
  'no-targets': '未配置有效应用',
  'runtime-missing': '等待执行进程',
  'runtime-mismatch': '执行进程的设备不匹配',
  busy: '正在执行任务',
  quarantined: '槽位已隔离',
};
const filterOptions = {
  platform: ['ios', 'android'],
  kind: ['physical', 'simulator'],
  connection: [...Object.keys(states), 'missing', 'stale'],
  scheduling: [
    'ready',
    'unmanaged',
    'blocked',
    'disabled',
    'busy',
    'quarantined',
  ],
} as const;
const name = (d: ManagedDevice) => d.settings.alias || d.observation.name;
const time = (v: number) => new Date(v).toLocaleString('zh-CN');
type Filters = {
  search?: string;
  platform?: string;
  kind?: string;
  worker?: string;
  connection?: string;
  scheduling?: string;
};
export function deviceFilters(search: Record<string, unknown>): Filters {
  const result: Filters = {};
  for (const key of [
    'search',
    'platform',
    'kind',
    'worker',
    'connection',
    'scheduling',
  ] as const) {
    if (typeof search[key] !== 'string' || !search[key]) continue;
    if (
      key !== 'search' &&
      key !== 'worker' &&
      !(filterOptions[key] as readonly string[]).includes(search[key])
    )
      continue;
    result[key] = search[key].slice(0, 200);
  }
  return result;
}
function Readiness({
  device,
  compact = false,
}: {
  device: ManagedDevice;
  compact?: boolean;
}) {
  const blockers = compact
    ? [
        device.blockers.find(
          (reason) => reason === 'busy' || reason === 'quarantined',
        ) ?? device.blockers[0],
      ].filter((reason): reason is DeviceBlocker => !!reason)
    : device.blockers;
  return (
    <div className="flex flex-wrap gap-1.5">
      {device.ready ? (
        <Badge className="bg-pass-bg text-pass-ink">可调度</Badge>
      ) : (
        blockers.map((reason) => (
          <Badge variant="secondary" key={reason}>
            {reasons[reason]}
          </Badge>
        ))
      )}
    </div>
  );
}
export function Devices() {
  const { data, error } = useData<ManagedDevice[]>('/api/devices', 0, true, '/api/device-events');
  const filters = deviceFilters(useSearch({ strict: false }));
  const navigate = useNavigate();
  const workers = [...new Set(data?.map((d) => d.workerId))];
  const workerFilter =
    filters.worker && workers.includes(filters.worker)
      ? filters.worker
      : undefined;
  const filter = (key: keyof Filters, value: string) =>
    void navigate({
      to: '/devices',
      search: { ...filters, [key]: value || undefined },
    });
  const items = (data ?? []).filter((d) => {
    const query = filters.search?.toLowerCase();
    return (
      (!query ||
        [name(d), d.nativeId, d.workerId, ...d.settings.tags]
          .join(' ')
          .toLowerCase()
          .includes(query)) &&
      (!filters.platform || filters.platform === d.observation.platform) &&
      (!filters.kind || filters.kind === d.observation.kind) &&
      (!workerFilter || workerFilter === d.workerId) &&
      (!filters.connection ||
        (filters.connection === 'missing'
          ? !d.present
          : filters.connection === 'stale'
            ? d.stale
            : d.present &&
              !d.stale &&
              filters.connection === d.observation.state)) &&
      (!filters.scheduling ||
        (filters.scheduling === 'ready'
          ? d.ready
          : filters.scheduling === 'unmanaged'
            ? !d.settings.managed
            : filters.scheduling === 'blocked'
              ? !d.ready
              : d.blockers.includes(filters.scheduling as DeviceBlocker)))
    );
  });
  return (
    <>
      <div>
        <h1 className="text-lg font-semibold tracking-tight">设备管理</h1>
        <p className="lede">
          统一查看各主机上的 iOS、Android 真机和模拟器，管理应用范围与调度状态。
        </p>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [data?.length ?? 0, '已发现设备'],
          [data?.filter((d) => d.ready).length ?? 0, '可调度'],
          [
            data?.filter((d) => d.slot?.state === 'busy').length ?? 0,
            '正在执行',
          ],
        ].map(([value, label]) => (
          <Card className="p-3" key={label}>
            <small>{label}</small>
            <div className="text-2xl font-semibold mt-1">{value}</div>
          </Card>
        ))}
      </div>
      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <Input
          aria-label="搜索设备"
          placeholder="设备名称、标识或标签"
          className="w-60"
          value={filters.search ?? ''}
          onChange={(e) => filter('search', e.target.value)}
        />
        <NativeSelect
          aria-label="平台"
          value={filters.platform ?? ''}
          onChange={(e) => filter('platform', e.target.value)}
        >
          <option value="">全部平台</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
        </NativeSelect>
        <NativeSelect
          aria-label="设备类型"
          value={filters.kind ?? ''}
          onChange={(e) => filter('kind', e.target.value)}
        >
          <option value="">全部类型</option>
          <option value="physical">真机</option>
          <option value="simulator">模拟器</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Worker"
          value={workerFilter ?? ''}
          onChange={(e) => filter('worker', e.target.value)}
        >
          <option value="">全部主机</option>
          {workers.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="连接状态"
          value={filters.connection ?? ''}
          onChange={(e) => filter('connection', e.target.value)}
        >
          <option value="">全部连接状态</option>
          {Object.entries(states).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
          <option value="missing">本次未发现</option>
          <option value="stale">检测过期</option>
        </NativeSelect>
        <NativeSelect
          aria-label="调度状态"
          value={filters.scheduling ?? ''}
          onChange={(e) => filter('scheduling', e.target.value)}
        >
          <option value="">全部调度状态</option>
          <option value="ready">可调度</option>
          <option value="unmanaged">尚未纳管</option>
          <option value="disabled">已暂停</option>
          <option value="busy">正在执行</option>
          <option value="quarantined">已隔离</option>
          <option value="blocked">暂不可调度</option>
        </NativeSelect>
        <Button
          variant="ghost"
          onClick={() => void navigate({ to: '/devices', search: {} })}
        >
          清除筛选
        </Button>
      </Card>
      <Card className="overflow-hidden">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>设备</TableHead>
              <TableHead>平台 / 类型</TableHead>
              <TableHead>主机</TableHead>
              <TableHead>连接</TableHead>
              <TableHead>调度 / 执行</TableHead>
              <TableHead>允许应用</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="min-w-40">
                  <Link
                    className="link font-medium"
                    to="/devices/$id"
                    params={{ id: d.id }}
                  >
                    {name(d)}
                  </Link>
                  <small className="block">{d.nativeId}</small>
                  {d.settings.tags.length > 0 && (
                    <small>{d.settings.tags.join(' · ')}</small>
                  )}
                </TableCell>
                <TableCell>
                  {d.observation.platform === 'ios' ? 'iOS' : 'Android'}{' '}
                  {d.observation.osVersion}
                  <small className="block">
                    {d.observation.kind === 'physical' ? '真机' : '模拟器'}
                  </small>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {d.workerId}
                  <small className="block">
                    {d.settings.slotId || '未配置槽位'}
                  </small>
                </TableCell>
                <TableCell>
                  {!d.present
                    ? '本次未发现'
                    : `${d.stale ? '上次检测：' : ''}${states[d.observation.state]}`}
                  <small className="block">{time(d.lastSeenAt)}</small>
                </TableCell>
                <TableCell>
                  <Readiness device={d} compact />
                </TableCell>
                <TableCell>{d.settings.targets.join(', ') || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!data && !error && <p className="empty">正在加载设备…</p>}
        {data && !items.length && (
          <p className="empty">
            {data.length
              ? '没有符合筛选条件的设备。'
              : '尚未收到设备检测结果。请在已登记主机上启动设备检测或 Worker。'}
          </p>
        )}
      </Card>
      <p className="hint">
        设备变化自动上报并刷新，每 30 秒校准一次；90
        秒未更新后停止新任务分配。暂停设备仅影响后续任务。
      </p>
    </>
  );
}
export function DeviceDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data, error, update } = useData<ManagedDevice>(
    `/api/devices/${encodeURIComponent(id)}`,
    0,
    true,
    '/api/device-events',
  );
  const { data: me } = useData<{ role: string }>('/api/me');
  const { data: targets } =
    useData<Array<{ id: string; name: string }>>('/api/targets');
  return (
    <>
      <Link to="/devices" className="link">
        ← 设备列表
      </Link>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!data && !error && <p>正在加载设备…</p>}
      {data && (
        <>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {name(data)}
            </h1>
            <p className="lede">
              {data.observation.name} · {data.workerId} · {data.nativeId}
            </p>
            <Readiness device={data} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-3 stack">
              <h2>设备与执行状态</h2>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <dt>平台 / 类型</dt>
                <dd>
                  {data.observation.platform === 'ios' ? 'iOS' : 'Android'} /{' '}
                  {data.observation.kind === 'physical' ? '真机' : '模拟器'}
                </dd>
                <dt>系统 / 型号</dt>
                <dd>
                  {data.observation.osVersion || '—'} /{' '}
                  {data.observation.model || '—'}
                </dd>
                <dt>连接状态</dt>
                <dd>
                  {states[data.observation.state]}
                  {!data.present && ' · 本次未发现'}
                  {data.stale && ' · 检测过期'}
                </dd>
                <dt>最近发现</dt>
                <dd>{time(data.lastSeenAt)}</dd>
                <dt>执行进程最近联系</dt>
                <dd>
                  {data.runtimeSeenAt === undefined
                    ? '尚未部署或连接'
                    : time(data.runtimeSeenAt)}
                </dd>
                <dt>执行槽位</dt>
                <dd>
                  {data.slot?.id || '—'} /{' '}
                  {data.slot
                    ? { idle: '空闲', busy: '执行中', quarantined: '已隔离' }[
                        data.slot.state
                      ]
                    : '未配置'}
                </dd>
              </dl>
              {data.observation.detail && (
                <p className="hint">{data.observation.detail}</p>
              )}
              {data.slot?.attemptId && (
                <p>
                  当前任务尝试：<code>{data.slot.attemptId}</code>
                </p>
              )}
              <Link to="/workers" className="link">
                查看 Worker 主机 →
              </Link>
            </Card>
            <DeviceSettingsForm
              key={data.id}
              device={data}
              editable={me?.role === 'operator' || me?.role === 'admin'}
              targets={targets ?? []}
              onSaved={update}
            />
          </div>
          <Card className="p-3 stack">
            <h2>执行环境</h2>
            <p>
              在主机启动一次 fliwright-worker run 后，保存允许的应用即可自动同步执行环境。
              槽位和独立运行目录自动创建，无需逐设备部署进程。
            </p>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt>workerId</dt>
              <dd>
                <code>{data.workerId}</code>
              </dd>
              <dt>slotId</dt>
              <dd>
                <code>{data.settings.slotId || '纳管后自动分配'}</code>
              </dd>
              <dt>deviceId</dt>
              <dd>
                <code>{data.nativeId}</code>
              </dd>
            </dl>
            <p className="hint">
              iOS 模拟器自动启动，测试前后重启并保留设备数据。其他设备使用主机配置的重置策略。
              若一直等待执行进程，请确认主机运行的是 run，而非仅发现设备的 discover。
              隔离槽位仍需在主机清理并恢复。
            </p>
          </Card>
        </>
      )}
    </>
  );
}
function DeviceSettingsForm({
  device,
  editable,
  targets,
  onSaved,
}: {
  device: ManagedDevice;
  editable: boolean;
  targets: Array<{ id: string; name: string }>;
  onSaved: (device: ManagedDevice) => void;
}) {
  const [settings, setSettings] = useState<DeviceSettings>(device.settings);
  const [tags, setTags] = useState(device.settings.tags.join(', '));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setSettings(device.settings);
      setTags(device.settings.tags.join(', '));
    }
  }, [device.settings, dirty]);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [saving, setSaving] = useState(false);
  const set = <K extends keyof DeviceSettings>(
    key: K,
    value: DeviceSettings[K],
  ) => {
    setDirty(true);
    setSettings((s) => ({ ...s, [key]: value }));
    setNotice('');
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editable || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await api<ManagedDevice>(
        `/api/devices/${device.id}`,
        'PUT',
        {
          ...settings,
          slotId: settings.managed ? settings.slotId || null : null,
          tags: [
            ...new Set(
              tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ],
        },
      );
      setDirty(false);
      setSettings(saved.settings);
      setTags(saved.settings.tags.join(', '));
      onSaved(saved);
      setNotice('配置已保存');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card className="p-3 stack">
      <h2>管理配置</h2>
      {!editable && <p className="hint">仅操作员和管理员可修改。</p>}
      <form data-device-settings onSubmit={save}>
        <fieldset disabled={!editable || saving} className="stack">
          <Label htmlFor="device-alias">设备别名</Label>
          <Input
            id="device-alias"
            maxLength={100}
            value={settings.alias}
            onChange={(e) => set('alias', e.target.value)}
          />
          <Label htmlFor="device-tags">标签（逗号分隔）</Label>
          <Input
            id="device-tags"
            value={tags}
            onChange={(e) => {
              setDirty(true);
              setTags(e.target.value);
              setNotice('');
            }}
          />
          <Label>
            <Checkbox
              id="device-managed"
              checked={settings.managed}
              onCheckedChange={(value) => {
                setDirty(true);
                setSettings(current => ({ ...current, managed: value === true,
                  enabled: value === true && !current.managed ? true : current.enabled }));
              }}
            />
            纳入平台管理
          </Label>
          <Label>
            <Checkbox
              id="device-enabled"
              checked={settings.enabled}
              onCheckedChange={(value) => set('enabled', value === true)}
            />
            允许分配新任务
          </Label>
          <details><summary>高级配置：执行槽位</summary>
          <Label htmlFor="device-slot">执行槽位 ID（留空自动分配）</Label>
          <Input
            id="device-slot"
            placeholder="留空自动分配"
            pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}"
            value={settings.slotId ?? ''}
            onChange={(e) => set('slotId', e.target.value || null)}
          />
          </details>
          <div className="stack">
            <Label>允许的应用</Label>
            {targets.map((target) => (
              <Label key={target.id}>
                <Checkbox
                  aria-label={`允许应用 ${target.name}`}
                  checked={settings.targets.includes(target.id)}
                  onCheckedChange={(checked) => {
                    setDirty(true);
                    setNotice('');
                    setSettings(current => ({ ...current,
                      ...(checked === true ? { managed: true, enabled: true } : {}),
                      targets: checked === true ? [...current.targets, target.id] : current.targets.filter(id => id !== target.id),
                    }));
                  }}
                />
                {target.name}
              </Label>
            ))}
            {settings.targets
              .filter((id) => !targets.some((t) => t.id === id))
              .map((id) => (
                <Label key={id}>
                  <Checkbox
                    aria-label={`移除失效应用 ${id}`}
                    checked
                    onCheckedChange={() =>
                      set(
                        'targets',
                        settings.targets.filter((t) => t !== id),
                      )
                    }
                  />
                  {id}（应用已移除）
                </Label>
              ))}
          </div>
          <Button type="submit">{saving ? '正在保存…' : '保存配置'}</Button>
        </fieldset>
      </form>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <small>
        暂停不会中断正在执行的任务。占用或隔离中的槽位不能重新绑定或修改应用范围。
      </small>
    </Card>
  );
}
