'use client';

import { Inbox } from 'lucide-react';

import { useOrganization } from '@/components/organization/organization-context';
import { SectionTitle } from '@/components/shared/section-title';
import { StaleRegion } from '@/components/shared/stale-region';
import { SectionError } from '@/components/ui/section-error';
import { TextLink } from '@/components/ui/text-link';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import type { RealtimeTable } from '@/lib/realtime/tables';
import type { WorkRequestEntry, WorkTargetKind } from '@/lib/requests/types';
import { formatBerlinDateTime } from '@/lib/utils';

// The attach touches the work's own row, so the work's table signals a new entry.
const WORK_TABLE: Readonly<Record<WorkTargetKind, RealtimeTable>> = {
  job: 'jobs',
  project: 'projects',
  service_case: 'service_cases',
};

const LOAD_FAILED = 'Die hinzugefügten Anfragen konnten nicht geladen werden.';

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
  const { activeOrgId } = useOrganization();
  const view = useLiveView<WorkRequestEntry[]>({
    tables: [WORK_TABLE[kind]],
    read: async ({ signal }): Promise<LiveViewResult<WorkRequestEntry[]>> => {
      const result = await readInBackground(
        'work-request-entries',
        { organizationId: activeOrgId ?? '', kind, id },
        signal,
      );
      return result.success
        ? { ok: true, data: result.entries }
        : { ok: false, error: describeFailure(result.error, {}, LOAD_FAILED) };
    },
    enabled: Boolean(activeOrgId),
    resetKey: `${kind}:${id}`,
  });

  if (view.data === undefined) {
    return view.isLoading ? null : (
      <SectionError
        className={className}
        onRetry={() => void view.refresh()}
        retryPending={view.isRefreshing}
      >
        {view.error ?? LOAD_FAILED}
      </SectionError>
    );
  }
  if (view.data.length === 0) return null;

  return (
    <StaleRegion stale={view.isStale} onRetry={view.refresh} className={className}>
      <section
        aria-labelledby={`work-request-entries-${id}`}
        className="rounded-lg border bg-card p-4 sm:p-5"
        data-testid="work-request-entries"
      >
        <SectionTitle as="h2" id={`work-request-entries-${id}`} icon={<Inbox className="size-4" />}>
          Hinzugefügte Anfragen
        </SectionTitle>
        <ul className="mt-3 divide-y">
          {view.data.map((entry) => (
            <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
              <p className="whitespace-pre-wrap break-words text-sm font-medium">{entry.summary}</p>
              {entry.details && (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {entry.details}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {formatBerlinDateTime(entry.createdAt)}
                {entry.actorName ? ` · ${entry.actorName}` : ''}
                {' · '}
                <TextLink href={`/anfragen/${entry.requestId}`}>
                  {entry.requestNumber ? `Anfrage ${entry.requestNumber}` : 'Anfrage öffnen'}
                </TextLink>
              </p>
            </li>
          ))}
        </ul>
      </section>
    </StaleRegion>
  );
}
