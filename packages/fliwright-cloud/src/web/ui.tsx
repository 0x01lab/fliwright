import React from 'react';
import {
  Gauge,
  List,
  Clock,
  Smartphone,
  Cpu,
  FileText,
  Send,
  SlidersHorizontal,
  Search,
  Moon,
  Sun,
  Plus,
  User,
  RefreshCw,
  Check,
  X,
  TriangleAlert,
  Camera,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronRight,
  Code,
  Link,
  Package,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { cn } from './lib/utils.js';

const icons: Record<string, LucideIcon> = {
  gauge: Gauge,
  list: List,
  clock: Clock,
  device: Smartphone,
  cpu: Cpu,
  doc: FileText,
  send: Send,
  settings: SlidersHorizontal,
  search: Search,
  moon: Moon,
  sun: Sun,
  plus: Plus,
  user: User,
  refresh: RefreshCw,
  check: Check,
  x: X,
  alert: TriangleAlert,
  camera: Camera,
  play: Play,
  pause: Pause,
  prev: SkipBack,
  next: SkipForward,
  chevron: ChevronRight,
  code: Code,
  link: Link,
  box: Package,
  log: Terminal,
};

export function Icon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Component = icons[name] ?? FileText;
  return (
    <Component
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
    />
  );
}

export function ResultIcon({
  status,
  className,
}: {
  status: 'passed' | 'failed';
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-pass text-white [&_svg]:size-3 [&_svg]:stroke-[2.5]", status === 'failed' && 'bg-destructive', className)}
      role="img"
      aria-label={status === 'passed' ? '成功' : '失败'} data-ui={`result-icon result-icon-${status}`}
    >
      <Icon name={status === 'passed' ? 'check' : 'x'} />
    </span>
  );
}

const stageLabels: Record<string, string> = {
  assigned: '等待执行',
  checkout: '准备测试环境',
  install: '准备测试环境',
  reset_before: '准备测试设备',
  launch: '启动 Flutter',
  running: '执行测试',
  export: '收集测试报告',
  finalizing: '发布报告与清理设备',
  finished: '已结束',
};

export function stageLabel(stage?: string): string {
  return stage ? (stageLabels[stage] ?? stage) : '等待 Worker 领取任务';
}
