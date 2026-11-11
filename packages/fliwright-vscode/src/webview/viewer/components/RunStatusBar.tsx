// packages/fliwright-vscode/src/webview/viewer/components/RunStatusBar.tsx
import type { SerializableRun } from '../types.js';
import { Badge } from '../../components/ui/badge.js';
import { BrandMark } from '../../components/BrandMark.js';
import { Button } from '../../components/ui/button.js';
import { FileText } from 'lucide-react';

function statusGlyph(status: string): string {
  if (status === 'passed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'running') return '◐';
  return '○';
}

function durationOf(startedAt?: string, endedAt?: string): string {
  if (!startedAt) return '';
  const start = Date.parse(startedAt);
  if (!start) return '';
  const end = endedAt ? Date.parse(endedAt) : NaN;
  if (!end) return '';
  const ms = end - start;
  if (!isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function stampLabel(startedAt?: string): string {
  return startedAt ? String(startedAt).replace('T', ' ').replace(/\..*/, '') : '';
}

const STATUS_VARIANT: Record<string, 'pass' | 'fail' | 'info'> = {
  passed: 'pass',
  failed: 'fail',
  running: 'info',
};

export function RunStatusBar({ run, onGenerateReport, generatingReport }: {
  run: SerializableRun; onGenerateReport: () => void; generatingReport: boolean;
}): JSX.Element {
  const tl = run.timeline;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const n of tl.nodes) {
    if (n.status === 'passed') passed++;
    else if (n.status === 'failed') failed++;
    else if (n.status === 'skipped') skipped++;
  }
  const dur = durationOf(tl.startedAt, tl.endedAt);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border bg-card px-3 py-1.5">
      <BrandMark className="size-6" />
      <Badge variant={STATUS_VARIANT[tl.status] ?? 'secondary'} className="normal-case">
        {statusGlyph(tl.status)} {tl.status}
      </Badge>
      <span className="min-w-0 truncate text-[13px] font-semibold">{tl.testName}</span>
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
        {tl.mode}
        {tl.startedAt ? ` · ${stampLabel(tl.startedAt)}` : ''}
        {dur ? ` · ${dur}` : ''}
      </span>
      <span className="ml-auto flex shrink-0 gap-2.5 text-[11px]">
        <span className="text-pass">{passed} passed</span>
        <span className="text-fail">{failed} failed</span>
        <span className="text-muted-foreground">{skipped} skipped</span>
      </span>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={onGenerateReport}
        disabled={generatingReport || tl.status === 'running'}
        title="Generate an HTML report for all tests in this run">
        <FileText aria-hidden="true" />
        {generatingReport ? 'Generating…' : 'Generate Report'}
      </Button>
    </div>
  );
}
