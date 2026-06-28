// packages/fliwright-vscode/src/webview/viewer/components/DetailTabs.tsx
import type { SerializableRun, ViewerState } from '../types.js';
import type { Selection } from '../artifacts.js';
import { DetailsTab } from './DetailsTab.js';
import { ErrorTab } from './ErrorTab.js';
import { LogsTab } from './LogsTab.js';
import { WidgetTreeTab } from './WidgetTreeTab.js';

interface DetailTabsProps {
  run: SerializableRun;
  selection: Selection | undefined;
  activeTab: ViewerState['activeTab'];
  onTabChange: (tab: ViewerState['activeTab']) => void;
  onOpenSource: (file: string, line: number, column?: number) => void;
  onCopy: (text: string) => void;
}

const TABS: Array<{ id: ViewerState['activeTab']; label: string }> = [
  { id: 'details', label: 'Details' },
  { id: 'error', label: 'Error' },
  { id: 'logs', label: 'Logs' },
  { id: 'widgetTree', label: 'Widget Tree' },
];

export function DetailTabs(props: DetailTabsProps): JSX.Element {
  const { selection, activeTab, onTabChange } = props;

  const errorCount = selection?.failure ? 1 : 0;
  const logCount = selection?.logs.length ?? 0;
  const hasSnapshot = !!selection?.snapshotPath || selection?.step?.widgetTree !== undefined;
  const badges: Partial<Record<ViewerState['activeTab'], number>> = {
    error: errorCount,
    logs: logCount,
  };

  return (
    <div className="detail-tabs">
      <div className="tab-bar">
        {TABS.map(tab => {
          const disabled = tab.id === 'widgetTree' && !hasSnapshot;
          const badge = badges[tab.id];
          const cls = `tab${activeTab === tab.id ? ' active' : ''}${tab.id === 'error' && errorCount > 0 ? ' has-error' : ''}`;
          return (
            <button
              key={tab.id}
              className={cls}
              disabled={disabled}
              title={disabled ? 'No widget snapshot for this step' : undefined}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
              {badge ? <span className={`tab-badge${tab.id === 'error' ? ' err' : ''}`}>{badge}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="tab-body">
        {!selection ? (
          <div className="tab-empty">Select a step to view details.</div>
        ) : activeTab === 'details' ? (
          <DetailsTab selection={selection} onOpenSource={props.onOpenSource} />
        ) : activeTab === 'error' ? (
          <ErrorTab selection={selection} onCopy={props.onCopy} onOpenSource={props.onOpenSource} />
        ) : activeTab === 'logs' ? (
          <LogsTab run={props.run} selection={selection} />
        ) : (
          <WidgetTreeTab selection={selection} />
        )}
      </div>
    </div>
  );
}
