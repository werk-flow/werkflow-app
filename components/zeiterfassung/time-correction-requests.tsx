'use client';

import { useMemo, useState } from 'react';

import { ListPagination } from '@/components/shared/list-pagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { readInBackground } from '@/lib/data/background-read-client';
import type { TimeCorrectionRequest } from '@/lib/time-corrections/types';
import { TimeCorrectionRequestCard } from './time-correction-requests-card';
import { useTimeCorrectionRequestActions } from './use-time-correction-requests';

type TimeCorrectionRequestsProps = {
  organizationId: string;
  mode: 'approvals' | 'history';
};

const getCorrectionRequestId = (request: TimeCorrectionRequest) => request.id;

/** The shown requests and how many match before the page boundary. */
type CorrectionList = { requests: TimeCorrectionRequest[]; total: number };

function TimeCorrectionRequestsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      <span className="sr-only">Zeitkorrekturen werden geladen.</span>
      <Skeleton className="h-5 w-44" />
      {Array.from({ length: 2 }, (_, index) => (
        <Card key={index} className="gap-4 py-4">
          <CardHeader className="px-4">
            <div className="flex items-start gap-3">
              <Skeleton className="size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 px-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-8 w-40" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function TimeCorrectionRequests({ organizationId, mode }: TimeCorrectionRequestsProps) {
  const [comments, setComments] = useState<Record<string, string>>({});
  // Row-scoped pending for the actions that keep their card (history view,
  // withdraw, resubmit); the other cards keep their buttons.
  const busy = useBusyIds();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The history pages on the server, newest first; the approval queue reads
  // only submitted requests and stays one list.
  const [page, setPage] = useState(1);
  const view = useLiveView<CorrectionList>({
    tables: ['time_correction_requests'],
    read: async ({ signal }): Promise<LiveViewResult<CorrectionList>> => {
      if (mode === 'history') {
        const result = await readInBackground('time-correction-history', { organizationId, page }, signal);
        return result.success ? { ok: true, data: result.page } : { ok: false };
      }
      const result = await readInBackground(
        'time-correction-requests',
        { organizationId, scope: mode },
        signal,
      );
      return result.success
        ? { ok: true, data: { requests: result.requests, total: result.requests.length } }
        : { ok: false };
    },
    resetKey: `${organizationId}:${mode}:${page}`,
  });
  const visibleRequests = useMemo(() => {
    const all = view.data?.requests ?? [];
    return mode === 'approvals'
      ? all.filter((request) => request.canReview && request.status === 'submitted')
      : all;
  }, [mode, view.data]);
  // In the approval list a decided request leaves at once. The overlay expires
  // when the authoritative read no longer lists the request and rolls back
  // when the server refuses. The history list keeps the card and its spinner.
  const list = useOptimisticList({ items: visibleRequests, getId: getCorrectionRequestId });
  const requests = list.items.map((row) => row.item);
  const leavesOnDecision = mode === 'approvals';
  const selectedRequests = requests.filter((request) => selected.has(request.id));

  const { review, withdraw, resubmit, reviewBatch } = useTimeCorrectionRequestActions({
    view,
    list,
    busy,
    comments,
    selectedRequests,
    setSelected,
    leavesOnDecision,
  });

  const loadError = (
    <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
      Die Zeitkorrekturen konnten nicht geladen werden.
    </SectionError>
  );

  if (view.isLoading) return <TimeCorrectionRequestsSkeleton />;
  // A failed first read is a failure, never an empty list.
  if (!view.data) return loadError;
  const heading = (
    <div>
      <h2 id={`time-corrections-${mode}`} className="font-semibold">
        {mode === 'approvals' ? 'Zeitkorrekturen prüfen' : 'Zeitkorrekturen'}
      </h2>
      <p className="text-sm text-muted-foreground">
        Vorschläge ändern die wirksame Zeit erst nach der Freigabe.
      </p>
    </div>
  );

  if (requests.length === 0 && view.data.total === 0 && !view.isStale) {
    // The history keeps its section, so the note reads as the state of the corrections.
    return mode === 'approvals' ? null : (
      <section className="space-y-3" aria-labelledby={`time-corrections-${mode}`}>
        {heading}
        <p className="text-sm text-muted-foreground">Noch keine Zeitkorrekturen vorhanden.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby={`time-corrections-${mode}`}>
      {heading}

      {/* A failed refresh keeps the last list; decisions wait for a fresh read. */}
      {view.isStale ? loadError : null}

      {mode === 'approvals' && selectedRequests.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-end">
          <Field label="Kommentar für Auswahl" htmlFor="batch-correction-comment" className="min-w-0 flex-1">
            <Textarea
              value={comments.batch ?? ''}
              onChange={(event) => setComments((current) => ({ ...current, batch: event.target.value }))}
              placeholder="Nur bei Ablehnung erforderlich"
            />
          </Field>
          <Button
            size="sm"
            onClick={() => void reviewBatch('approve')}
            disabled={busy.anyBusy || view.isStale}
          >
            Auswahl freigeben
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void reviewBatch('reject')}
            disabled={busy.anyBusy || view.isStale}
          >
            Auswahl ablehnen
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        {requests.map((request) => (
          <TimeCorrectionRequestCard
            key={request.id}
            request={request}
            mode={mode}
            requestBusy={busy.isBusy(request.id)}
            stale={view.isStale}
            selected={selected}
            setSelected={setSelected}
            comments={comments}
            setComments={setComments}
            withdraw={withdraw}
            resubmit={resubmit}
            review={review}
          />
        ))}
      </div>
      {mode === 'history' ? (
        <ListPagination
          label="Zeitkorrekturen"
          page={page}
          total={view.data.total}
          busy={view.isRefreshing}
          onPageChange={setPage}
        />
      ) : null}
    </section>
  );
}
