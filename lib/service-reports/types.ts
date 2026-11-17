import type { MaintenanceScopeOutcome } from '@/lib/maintenance/types';

// Types and the page parameter only, so the client list imports no server code.

/** The URL parameter of the completed-visit list's page on `/service/wartung`. */
export const SERVICE_REPORT_PAGE_PARAM = 'berichtPage';

/** A completed maintenance visit with a job, as the office's report list shows it. */
export type CompletedVisit = {
  dueWorkId: string;
  completedOn: string;
  outcome: MaintenanceScopeOutcome;
  jobNumber: string | null;
  planNumber: string;
  clientName: string;
  siteName: string;
  equipmentNames: string[];
  /** The newest Servicebericht of the visit; null before the first. */
  latestReport: {
    id: string;
    documentId: string;
    reportNumber: number;
    createdAt: string;
  } | null;
};

export type CompletedVisitPage = {
  items: CompletedVisit[];
  total: number;
  page: number;
  pageSize: number;
};
