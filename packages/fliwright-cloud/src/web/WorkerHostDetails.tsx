import React, { type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import type { Project } from '@fliwright/cloud-protocol';
import type { WorkerStatusResponse } from '../catalog-scan-status.js';
import { Badge } from './components/ui/badge.js';
import { serviceStatusLabels, WorkerCatalogWorkspaceNotice, WorkerDiagnosticsPanel } from './WorkerDiagnostics.js';

const componentNames: Record<string, string> = { inventory: '设备发现', catalog: '测试用例扫描', executor: '测试执行器' };
const componentStates = { running: '运行中', failed: '异常', stopped: '已停止' };
const slotStates = { idle: '空闲', busy: '执行中', quarantined: '已隔离' };

function timestamp(value: string | number) {
  return new Date(value).toLocaleString('zh-CN');
}

function runTime(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return `${Math.floor(milliseconds / 1000)} 秒`;
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-2">
    <dt className="text-muted-foreground">{label}</dt><dd className="m-0 wrap-anywhere">{children}</dd>
  </div>;
}

export function WorkerHostDetails({ worker, canOperate, projects }: { worker: WorkerStatusResponse; canOperate: boolean; projects?: Project[] }) {
  const { id, inventory, slots, service, catalogScannerConnected, projectIds, activeCatalogScan } = worker;
  const projectName = (projectId: string) => projects?.find(project => project.id === projectId)?.name ?? projectId;
  const process = service?.process;
  const onlineDevices = inventory?.devices.filter(device => device.state === 'online').length ?? 0;
  const idleSlots = slots.filter(slot => slot.state === 'idle').length;
  const busySlots = slots.filter(slot => slot.state === 'busy').length;

  return <div className="grid gap-4 border-t bg-muted/40 px-4 py-4">
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 [&>section]:min-w-0 [&>section]:content-start [&>section]:space-y-2 [&_dl]:space-y-1.5">
      <section aria-label="服务运行状态">
        <h4 className="font-semibold">服务运行状态</h4>
        {service ? <>
          <dl>
            <Fact label="服务状态">{serviceStatusLabels[service.status]}</Fact>
            <Fact label="最近服务上报">{timestamp(service.receivedAt)}</Fact>
            <Fact label="活跃服务实例">{service.activeSessions}{service.activeSessions > 1 && '（检测到多个实例）'}</Fact>
            {process && <>
              <Fact label="进程 / Node.js">PID {process.pid} · {process.nodeVersion}</Fact>
              <Fact label="启动时间">{timestamp(process.startedAt)}</Fact>
              <Fact label="上报时运行时长">{runTime(process.uptimeMs)}</Fact>
              <Fact label="进程内存 / 延迟">{(process.rssBytes / 1024 ** 2).toFixed(1)} MiB · {Math.round(process.eventLoopLagMs)} ms</Fact>
            </>}
          </dl>
          {service.status === 'unreachable' && <p className="text-muted-foreground">超过 35 秒未收到服务诊断心跳。</p>}
          {process && Object.keys(process.components).length > 0 && <ul aria-label="服务组件" className="flex flex-wrap gap-1.5">
            {Object.entries(process.components).map(([name, state]) => <li key={name} className="min-w-0"><Badge variant={state === 'failed' ? 'destructive' : 'secondary'} className="h-auto max-w-full whitespace-normal wrap-anywhere">{Object.hasOwn(componentNames, name) ? componentNames[name] : name} · {componentStates[state]}</Badge></li>)}
          </ul>}
        </> : <p className="text-muted-foreground">尚未收到服务诊断上报</p>}
      </section>
      <section aria-label="扫描服务">
        <h4 className="font-semibold">项目与扫描</h4>
        <dl>
          <Fact label="连接状态">{catalogScannerConnected === undefined ? '暂无数据' : catalogScannerConnected ? '已连接' : '未连接'}</Fact>
          <Fact label="绑定项目">{projectIds?.map(projectName).join('、') || (projectIds ? '尚未绑定项目' : '暂无数据')}</Fact>
          <Fact label="当前扫描">{activeCatalogScan ? <Link to="/projects/$projectId" params={{ projectId: activeCatalogScan.projectId }} search={{ view: 'scans' }} className="inline-flex max-w-full flex-wrap items-center gap-1 text-primary hover:underline">
            {projectName(activeCatalogScan.projectId)} · {activeCatalogScan.branch ?? <code title={activeCatalogScan.commit}>{activeCatalogScan.commit.slice(0, 12)}</code>}<ArrowUpRight className="size-3 shrink-0" />
          </Link> : catalogScannerConnected === undefined ? '暂无数据' : '暂无运行中的扫描'}</Fact>
          {activeCatalogScan && <Fact label="最近扫描心跳">{timestamp(activeCatalogScan.updatedAt)}</Fact>}
        </dl>
        <WorkerCatalogWorkspaceNotice workspace={service?.catalogWorkspace} />
      </section>
      <section aria-label="设备与槽位">
        <h4 className="font-semibold">设备与槽位</h4>
        <dl>
          <Fact label="设备检测">{inventory ? <>{onlineDevices} 台在线 / 共 {inventory.devices.length} 台{inventory.stale && '（检测已过期）'}</> : '尚未收到设备检测结果'}</Fact>
          {inventory && <Fact label="最近设备上报">{timestamp(inventory.receivedAt)}</Fact>}
          <Fact label="执行槽位">{slots.length ? `${idleSlots} 空闲 · ${busySlots} 执行中 · ${slots.length - idleSlots - busySlots} 隔离` : '尚无执行槽位'}</Fact>
        </dl>
        {inventory && inventory.diagnostics.length > 0 && <details className="space-y-1">
          <summary className="cursor-pointer text-muted-foreground">设备检测诊断（{inventory.diagnostics.length}）</summary>
          <ul className="space-y-1">{inventory.diagnostics.map((diagnostic, index) => <li key={index} className="wrap-anywhere">{diagnostic.source} · {diagnostic.message}</li>)}</ul>
        </details>}
        {slots.length > 0 && <ul aria-label="执行槽位" className="space-y-1.5">
          {slots.map(slot => <li key={slot.id} className="space-y-1 rounded-md bg-card px-3 py-2">
            <div className="flex flex-wrap items-center gap-2"><strong className="wrap-anywhere">{slot.id}</strong><Badge variant={slot.state === 'quarantined' ? 'destructive' : 'secondary'}>{slotStates[slot.state]}</Badge></div>
            <p className="wrap-anywhere text-muted-foreground" title={slot.deviceId}>{inventory?.devices.find(device => device.id === slot.deviceId)?.name ?? slot.deviceId}{slot.targets.length ? ` · ${slot.targets.map(projectName).join('、')}` : ''} · 代次 {slot.generation}</p>
            {slot.attemptId && <p className="wrap-anywhere text-muted-foreground">当前执行 <code>{slot.attemptId}</code></p>}
          </li>)}
        </ul>}
        {slots.some(slot => slot.state === 'quarantined') && <p>请在主机上确认执行进程已终止，并重置隔离设备后恢复。</p>}
      </section>
    </div>
    {canOperate && <WorkerDiagnosticsPanel workerId={id} />}
  </div>;
}
