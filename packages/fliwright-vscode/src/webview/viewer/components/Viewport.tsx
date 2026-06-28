// packages/fliwright-vscode/src/webview/viewer/components/Viewport.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SerializableRun } from '../types.js';
import type { Selection } from '../artifacts.js';
import { fallbackScreenshot, neighborKeys } from '../artifacts.js';
import { computeFitScale } from '../fitScale.js';
import type { FlatNode } from '../treeFlatten.js';

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

  // Resolve the screenshot to show: the selection's own screenshot, or a
  // backward fallback (timeline mode only — no real before/after pairing).
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

  // Track container size for fit-scaling.
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

  return (
    <div className="viewport">
      {route ? <div className="route-bar">{route}</div> : null}
      <div className="viewport-stage" ref={stageRef}>
        {imgSrc ? (
          <div
            className="device-frame"
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
            />
          </div>
        ) : (
          <div className="viewport-empty">
            <div className="viewport-empty-icon">📱</div>
            <div>No screenshot captured for this step</div>
            <div className="viewport-hint">Use trace mode "full" to capture every step.</div>
          </div>
        )}
      </div>
      {fallbackTitle ? <div className="fallback-banner">Showing screenshot from “{fallbackTitle}”</div> : null}
      <div className="viewport-nav">
        <button
          className="nav-btn"
          disabled={!neighbors.prev}
          onClick={() => neighbors.prev && props.onSelect(neighbors.prev)}
        >◀ prev</button>
        <span className="nav-position">{position}</span>
        <button
          className="nav-btn"
          disabled={!neighbors.next}
          onClick={() => neighbors.next && props.onSelect(neighbors.next)}
        >next ▶</button>
      </div>
    </div>
  );
}
