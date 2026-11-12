'use client';

import { Inbox } from 'lucide-react';

import { SectionTitle } from '@/components/shared/section-title';
import { StaleRegion } from '@/components/shared/stale-region';
import { SectionError } from '@/components/ui/section-error';
import { TextLink } from '@/components/ui/text-link';
import type { LiveViewState } from '@/hooks/use-live-view';
import type { WorkRequestEntry } from '@/lib/requests/types';
import { formatBerlinDateTime } from '@/lib/utils';

export const WORK_REQUEST_ENTRIES_LOAD_FAILED = 'Die hinzugefügten Anfragen konnten nicht geladen werden.';
const REFRESH_FAILED =
  'Die hinzugefügten Anfragen konnten nicht aktualisiert werden. Eventuell fehlen neue Einträge.';

type EntriesView = Pick<
  LiveViewState<WorkRequestEntry[]>,
  'data' | 'isLoading' | 'isStale' | 'isRefreshing' | 'error' | 'refresh'
>;

/**
 * The entries of one work as the live view holds them. Nothing shows while
 * the first read runs or the work has none; a failed read shows its retry,
 * also when the last good read was empty, so a missed entry is never hidden.
 */
export function WorkRequestEntriesView({
  view,
  id,
  className = '',
}: {
  view: EntriesView;
  id: string;
  className?: string;
}) {
  if (view.data === undefined) {
    return view.isLoading ? null : (
      <SectionError
        className={className}
        onRetry={() => void view.refresh()}
        retryPending={view.isRefreshing}
      >
        {view.error ?? WORK_REQUEST_ENTRIES_LOAD_FAILED}
      </SectionError>
    );
  }
  if (view.data.length === 0) {
    return view.isStale ? (
      <SectionError
        className={className}
        onRetry={() => void view.refresh()}
        retryPending={view.isRefreshing}
      >
        {REFRESH_FAILED}
      </SectionError>
    ) : null;
  }

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
