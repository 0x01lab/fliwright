// packages/fliwright-vscode/src/webview/components/ui/resizable.tsx
import type { ComponentProps } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { cn } from '../../lib/utils.js';

function ResizablePanelGroup({ className, ...props }: ComponentProps<typeof PanelGroup>): JSX.Element {
  return (
    <PanelGroup
      className={cn('flex h-full w-full data-[panel-group-direction=vertical]:flex-col', className)}
      {...props}
    />
  );
}

const ResizablePanel = Panel;

function ResizableHandle({ className, ...props }: ComponentProps<typeof PanelResizeHandle>): JSX.Element {
  return (
    <PanelResizeHandle
      className={cn(
        'relative flex w-1.5 shrink-0 items-center justify-center bg-transparent transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[resize-handle-state=hover]:bg-accent data-[resize-handle-state=drag]:bg-ring',
        className,
      )}
      {...props}
    />
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
