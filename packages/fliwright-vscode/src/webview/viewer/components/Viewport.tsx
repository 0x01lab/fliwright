// packages/fliwright-vscode/src/webview/viewer/components/Viewport.tsx
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { SerializableRun } from '../types.js';
import type { Selection } from '../artifacts.js';
import { fallbackScreenshot, neighborKeys } from '../artifacts.js';
import { computeFitScale } from '../fitScale.js';
import type { FlatNode } from '../treeFlatten.js';
import { Button } from '../../components/ui/button.js';

const CHECKERBOARD: CSSProperties = {
  backgroundColor: 'var(--color-background)',
  backgroundImage:
    'linear-gradient(45deg, rgba(128,128,128,0.15) 25%, transparent 25%),' +
    'linear-gradient(-45deg, rgba(128,128,128,0.15) 25%, transparent 25%),' +
    'linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.15) 75%),' +
    'linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.15) 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
};

interface ViewportProps {
  run: SerializableRun;
  selection: Selection | undefined;
  orderedKeys: string[];
  flatNodes: FlatNode[];
  onSelect: (key: string) => void;
}

export function Viewport(props: ViewportProps): JSX.Element {
  const { run, selection, orderedKeys, flatNodes } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [imgSrc, setImgSrc] = useState<string | undefined>(undefined);
  const [fallbackTitle, setFallbackTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (selection?.screenshotUri) {
      setImgSrc(selection.screenshotUri);
      setFallbackTitle(undefined);
      return;
    }
    if (selection?.mode === 'timeline') {
      const idx = orderedKeys.indexOf(selection.key);
      const fb = fallbackScreenshot(flatNodes, idx, run.screenshotBaseUrl);
      if (fb) {
        setImgSrc(fb.uri);
        setFallbackTitle(fb.sourceTitle);
        return;
      }
    }
    setImgSrc(undefined);
    setFallbackTitle(undefined);
  }, [selection, orderedKeys, flatNodes, run.screenshotBaseUrl]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (cr) setContainer({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    setContainer({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const scale = computeFitScale(container.w, container.h, natural.w, natural.h);
  const neighbors = neighborKeys(orderedKeys, selection?.key ?? null);
  const idx = selection?.key ? orderedKeys.indexOf(selection.key) : -1;
  const position = idx >= 0 ? `${idx + 1} / ${orderedKeys.length}` : '';

  const route = selection?.mode === 'timeline' ? selection.node?.route : undefined;
  const emptyHint = viewportEmptyHint(selection?.mode);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      {route ? <div className="shrink-0 border-b border-border bg-card px-3 py-1 font-mono text-[11px] text-muted-foreground">{route}</div> : null}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4" ref={stageRef} style={CHECKERBOARD}>
        {imgSrc ? (
          <div
            className="overflow-hidden rounded-[10px] border border-border bg-background shadow-xl"
            style={{ width: natural.w * scale || 'auto', height: natural.h * scale || 'auto' }}
          >
            <img
              src={imgSrc}
              alt="screenshot"
              onLoad={e => {
                const t = e.currentTarget;
                setNatural({ w: t.naturalWidth, h: t.naturalHeight });
              }}
              draggable={false}
              className="block h-full w-full"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-center text-muted-foreground">
            <div className="text-4xl">📱</div>
            <div>No screenshot captured for this step</div>
            <div className="text-[11px]">{emptyHint}</div>
          </div>
        )}
      </div>
      {fallbackTitle ? <div className="shrink-0 border-t border-border bg-warn/10 px-3 py-1 text-[11px] text-muted-foreground">Showing screenshot from “{fallbackTitle}”</div> : null}
      <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border bg-card px-3 py-1.5">
        <Button variant="ghost" size="sm" disabled={!neighbors.prev} onClick={() => neighbors.prev && props.onSelect(neighbors.prev)}>
          <ChevronLeft /> prev
        </Button>
        <span className="min-w-[60px] text-center text-[11px] text-muted-foreground">{position}</span>
        <Button variant="ghost" size="sm" disabled={!neighbors.next} onClick={() => neighbors.next && props.onSelect(neighbors.next)}>
          next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function viewportEmptyHint(mode: Selection['mode'] | undefined): string {
  if (mode === 'actions') {
    return 'Use trace mode "full" to capture every action, or "on-failure" for failed actions.';
  }
  if (mode === 'timeline') {
    return 'Timeline screenshots come from flow.frame({ screenshot: true }) or failed locator assertions.';
  }
  return 'Open a run with timeline or action trace data.';
}
