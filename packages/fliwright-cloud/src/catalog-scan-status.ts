import type { CatalogScan, ExecutionWorker, WorkerServiceReport } from '@fliwright/cloud-protocol';

export type CatalogScanQueueReason = 'no_worker' | 'project_not_assigned' | 'scanner_disconnected' | 'project_busy' | 'workers_busy' | 'waiting';

export type CatalogScanRecord = CatalogScan & {
  workerId?: string;
  queue?: { reason: CatalogScanQueueReason; workerIds: string[] };
};

export type WorkerServiceSummary = NonNullable<ExecutionWorker['service']> & {
  process: Pick<WorkerServiceReport, 'pid' | 'nodeVersion' | 'startedAt' | 'uptimeMs' | 'rssBytes' | 'eventLoopLagMs' | 'components'>;
};

export type WorkerStatus = ExecutionWorker & {
  service?: WorkerServiceSummary;
  catalogScannerConnected: boolean;
  projectIds: string[];
  activeCatalogScan?: CatalogScan;
};

// A running Cloud process can serve a rebuilt frontend before its own code is restarted.
export type WorkerStatusResponse = ExecutionWorker & Partial<Pick<WorkerStatus, 'catalogScannerConnected' | 'projectIds' | 'activeCatalogScan'>> & {
  service?: NonNullable<ExecutionWorker['service']> & Partial<Pick<WorkerServiceSummary, 'process'>>;
};

export type ProjectWorkerBinding = Pick<ExecutionWorker, 'id' | 'health' | 'paused'> & { bound: boolean };
