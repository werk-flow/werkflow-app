'use client';

import { useOrganization } from '@/components/organization/organization-context';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import { WORK_REQUEST_ENTRIES_LOAD_FAILED, WorkRequestEntriesView } from './work-request-entries-view';
import type { RealtimeTable } from '@/lib/realtime/tables';
import type { WorkRequestEntry, WorkTargetKind } from '@/lib/requests/types';

// The attach touches the work's own row, so the work's table signals a new entry.
const WORK_TABLE: Readonly<Record<WorkTargetKind, RealtimeTable>> = {
  job: 'jobs',
  project: 'projects',
  service_case: 'service_cases',
};

/** The live entries of one work; the view reads its `isStale`. */
function useWorkRequestEntries(kind: WorkTargetKind, id: string) {
  const { activeOrgId } = useOrganization();
  return useLiveView<WorkRequestEntry[]>({
    tables: [WORK_TABLE[kind]],
    read: async ({ signal }): Promise<LiveViewResult<WorkRequestEntry[]>> => {
      const result = await readInBackground(
        'work-request-entries',
        { organizationId: activeOrgId ?? '', kind, id },
        signal,
      );
      return result.success
        ? { ok: true, data: result.entries }
        : { ok: false, error: describeFailure(result.error, {}, WORK_REQUEST_ENTRIES_LOAD_FAILED) };
    },
    enabled: Boolean(activeOrgId),
    resetKey: `${kind}:${id}`,
  });
}

/**
 * The requests attached to one job, project or Servicefall, oldest first:
 * what the customer said, when and by whom it was added, and the request it
 * came from. For managers; nothing shows while the work has none.
 */
export function WorkRequestEntriesSection({
  kind,
  id,
  className = '',
}: {
  kind: WorkTargetKind;
  id: string;
  className?: string;
}) {
  const view = useWorkRequestEntries(kind, id);
  return <WorkRequestEntriesView view={view} id={id} className={className} />;
}
