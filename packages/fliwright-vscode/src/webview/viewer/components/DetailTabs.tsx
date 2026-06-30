// packages/fliwright-vscode/src/webview/viewer/components/DetailTabs.tsx
import type { SerializableRun, ViewerState } from '../types.js';
import type { Selection } from '../artifacts.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { Badge } from '../../components/ui/badge.js';
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

type TabId = ViewerState['activeTab'];
const TABS: Array<{ id: TabId; label: string }> = [
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

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-l border-border bg-background">
      <Tabs
        value={activeTab}
        onValueChange={v => onTabChange(v as TabId)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList>
          {TABS.map(tab => {
            const disabled = tab.id === 'widgetTree' && !hasSnapshot;
            const badge = tab.id === 'error' ? errorCount : tab.id === 'logs' ? logCount : 0;
            return (
              <TabsTrigger key={tab.id} value={tab.id} disabled={disabled} title={disabled ? 'No widget snapshot for this step' : undefined}>
                {tab.label}
                {badge ? <Badge variant={tab.id === 'error' ? 'destructive' : 'muted'} className="ml-1 px-1.5 py-0 normal-case">{badge}</Badge> : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {!selection ? (
          <div className="px-3 py-2 text-muted-foreground">Select a step to view details.</div>
        ) : (
          <>
            <TabsContent value="details" className="px-3 py-2.5">
              <DetailsTab selection={selection} onOpenSource={props.onOpenSource} />
            </TabsContent>
            <TabsContent value="error" className="px-3 py-2.5">
              <ErrorTab selection={selection} onCopy={props.onCopy} onOpenSource={props.onOpenSource} />
            </TabsContent>
            <TabsContent value="logs" className="px-3 py-2.5">
              <LogsTab run={props.run} selection={selection} />
            </TabsContent>
            <TabsContent value="widgetTree" className="p-0">
              <WidgetTreeTab selection={selection} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
