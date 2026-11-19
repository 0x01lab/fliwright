// packages/fliwright-vscode/src/webview/viewer/components/Viewport.tsx
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { SerializableRun } from '../types.js';
import type { Selection } from '../artifacts.js';
import { precedingScreenshot } from '../artifacts.js';
import { computeFitScale } from '../fitScale.js';

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
}

export function Viewport(props: ViewportProps): JSX.Element {
  const { run, selection } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const fallback = !selection?.screenshotUri && selection?.node ? precedingScreenshot(run, selection.node) : undefined;
  const imgSrc = selection?.screenshotUri ?? fallback?.uri;
  const evidenceTime = fallback?.time ?? selection?.node?.endedAt ?? selection?.node?.startedAt;
  const [imageError, setImageError] = useState<string>();

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
  const route = selection?.node?.route;
  const emptyHint = viewportEmptyHint(selection?.mode);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      {route ? <div className="shrink-0 border-b border-border bg-card px-3 py-1 font-mono text-[11px] text-muted-foreground">{route}</div> : null}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4" ref={stageRef} style={CHECKERBOARD}>
        {imgSrc && imageError !== imgSrc ? (
          <div
            className="overflow-hidden rounded-[10px] border border-border bg-background shadow-xl"
            style={{ width: natural.w * scale || 'auto', height: natural.h * scale || 'auto' }}
          >
            <img
              key={imgSrc}
              src={imgSrc}
              onError={() => { setImageError(imgSrc); }}
              alt="screenshot"
              onLoad={e => {
                const t = e.currentTarget;
                setImageError(undefined);
                setNatural({ w: t.naturalWidth, h: t.naturalHeight });
              }}
              draggable={false}
              className="block h-full w-full"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-center text-muted-foreground">
            <div className="text-4xl">📱</div>
            <div>{imageError === imgSrc && imgSrc ? 'Screenshot unavailable' : 'No screenshot captured for this step'}</div>
            <div className="text-[11px]">{emptyHint}</div>
          </div>
        )}
      </div>
      {imgSrc && <div className="shrink-0 border-t border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
        {fallback ? `Showing screenshot from “${fallback.sourceTitle}”` : 'Selected step screenshot'}
        {evidenceTime ? ` · ${evidenceTime} (${(fallback ? fallback.anchor === 'end' : !!selection?.node?.endedAt) ? 'step end anchor' : 'step start anchor'})` : ''}
        {selection?.screenshotUris && selection.screenshotUris.length > 1 ? ` · ${selection.screenshotUris.indexOf(imgSrc) + 1} / ${selection.screenshotUris.length}` : ''}
      </div>}
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
