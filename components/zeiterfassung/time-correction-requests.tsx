'use client';

import { useMemo, useState } from 'react';
import { Check, HelpCircle, Loader2, RotateCcw, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useBanner } from '@/components/ui/banner';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import {
  getTimeCorrectionRequests,
  resubmitTimeCorrection,
  reviewTimeCorrection,
  reviewTimeCorrectionsBatch,
  withdrawTimeCorrection,
} from '@/lib/time-corrections/actions';
import {
  TIME_CORRECTION_KIND_LABELS,
  TIME_CORRECTION_STATUS_LABELS,
  type TimeCorrectionRequest,
} from '@/lib/time-corrections/types';

type TimeCorrectionRequestsProps = {
  organizationId: string;
  mode: 'approvals' | 'history';
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function summarizeSnapshot(request: TimeCorrectionRequest, state: 'before' | 'proposed'): string {
  const facts = state === 'before'
    ? request.revision.beforeSnapshot.facts
    : request.revision.proposedSnapshot.facts;
  if (facts.length === 0) return state === 'before' ? 'Kein Eintrag' : 'Eintrag entfällt';
  const timestamps = facts.map((fact) => formatDateTime(fact.timestamp));
  return timestamps.length === 1
    ? timestamps[0]
    : `${timestamps[0]} bis ${timestamps[timestamps.length - 1]}`;
}

function statusClass(status: TimeCorrectionRequest['status']): string {
  if (status === 'approved') return 'bg-green-500/15 text-green-700 dark:text-green-300';
  if (status === 'rejected' || status === 'application_failed') {
    return 'bg-destructive/10 text-destructive';
  }
  if (status === 'clarification_required') {
    return 'bg-yellow-500/15 text-yellow-800 dark:text-yellow-300';
  }
  return 'bg-muted text-muted-foreground';
}

export function TimeCorrectionRequests({
  organizationId,
  mode,
}: TimeCorrectionRequestsProps) {
  const { showBanner } = useBanner();
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const view = useLiveView<TimeCorrectionRequest[]>({
    tables: ['time_correction_requests'],
    read: async (): Promise<LiveViewResult<TimeCorrectionRequest[]>> => {
      const result = await getTimeCorrectionRequests(organizationId);
      return result.success
        ? { ok: true, data: result.requests }
        : { ok: false, error: 'Die Zeitkorrekturen konnten nicht geladen werden.' };
    },
    resetKey: `${organizationId}:${mode}`,
  });
  const requests = useMemo(() => {
    const all = view.data ?? [];
    return mode === 'approvals'
      ? all.filter((request) => request.canReview && request.status === 'submitted')
      : all;
  }, [mode, view.data]);
  const selectedRequests = requests.filter((request) => selected.has(request.id));

  const refresh = async () => {
    setSelected(new Set());
    await view.refresh();
  };

  const review = async (
    request: TimeCorrectionRequest,
    decision: 'approve' | 'reject' | 'clarify'
  ) => {
    setBusyKey(`${request.id}:${decision}`);
    const result = await reviewTimeCorrection({
      requestId: request.id,
      expectedRevision: request.currentRevision,
      decision,
      comment: comments[request.id]?.trim() || null,
      operationId: crypto.randomUUID(),
    });
    if (!result.success) {
      showBanner({
        variant: 'error',
        message: result.error === 'comment_required'
          ? 'Bitte gib für Rückfrage oder Ablehnung einen Kommentar an.'
          : 'Die Entscheidung konnte nicht gespeichert werden.',
      });
    } else {
      showBanner({ variant: 'success', message: 'Die Entscheidung wurde gespeichert.' });
      await refresh();
    }
    setBusyKey(null);
  };

  const withdraw = async (request: TimeCorrectionRequest) => {
    setBusyKey(`${request.id}:withdraw`);
    const result = await withdrawTimeCorrection({
      requestId: request.id,
      operationId: crypto.randomUUID(),
    });
    showBanner(result.success
      ? { variant: 'success', message: 'Der Antrag wurde zurückgezogen.' }
      : { variant: 'error', message: 'Der Antrag konnte nicht zurückgezogen werden.' });
    if (result.success) await refresh();
    setBusyKey(null);
  };

  const resubmit = async (request: TimeCorrectionRequest) => {
    const reason = comments[request.id]?.trim();
    if (!reason) {
      showBanner({ variant: 'error', message: 'Bitte beantworte die Rückfrage.' });
      return;
    }
    setBusyKey(`${request.id}:resubmit`);
    const result = await resubmitTimeCorrection({
      requestId: request.id,
      expectedRevision: request.currentRevision,
      reason,
      operationId: crypto.randomUUID(),
    });
    showBanner(result.success
      ? { variant: 'success', message: 'Die Antwort wurde erneut eingereicht.' }
      : { variant: 'error', message: 'Die Antwort konnte nicht eingereicht werden.' });
    if (result.success) await refresh();
    setBusyKey(null);
  };

  const reviewBatch = async (decision: 'approve' | 'reject') => {
    if (selectedRequests.length === 0) return;
    const batchComment = comments.batch?.trim() || null;
    if (decision === 'reject' && !batchComment) {
      showBanner({ variant: 'error', message: 'Bitte gib einen Ablehnungsgrund an.' });
      return;
    }
    setBusyKey(`batch:${decision}`);
    const result = await reviewTimeCorrectionsBatch({
      requests: selectedRequests.map((request) => ({
        requestId: request.id,
        expectedRevision: request.currentRevision,
      })),
      decision,
      comment: batchComment,
    });
    showBanner(result.success
      ? { variant: 'success', message: `${selectedRequests.length} Anträge wurden gemeinsam bearbeitet.` }
      : { variant: 'error', message: 'Kein Antrag wurde geändert. Bitte lade die Liste neu.' });
    if (result.success) await refresh();
    setBusyKey(null);
  };

  if (view.isLoading) {
    return <p className="py-6 text-sm text-muted-foreground">Zeitkorrekturen werden geladen …</p>;
  }
  if (view.error) return <p role="alert" className="text-sm text-destructive">{view.error}</p>;
  if (requests.length === 0) {
    return mode === 'approvals'
      ? null
      : <p className="py-6 text-sm text-muted-foreground">Noch keine Zeitkorrekturen vorhanden.</p>;
  }

  return (
    <section className="space-y-3" aria-labelledby={`time-corrections-${mode}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`time-corrections-${mode}`} className="font-semibold">
            {mode === 'approvals' ? 'Zeitkorrekturen prüfen' : 'Zeitkorrekturen'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Vorschläge ändern die wirksame Zeit erst nach der Freigabe.
          </p>
        </div>
      </div>

      {mode === 'approvals' && selectedRequests.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="batch-correction-comment">Kommentar für Auswahl</Label>
            <Textarea
              id="batch-correction-comment"
              value={comments.batch ?? ''}
              onChange={(event) => setComments((current) => ({ ...current, batch: event.target.value }))}
              placeholder="Nur bei Ablehnung erforderlich"
            />
          </div>
          <Button size="sm" onClick={() => void reviewBatch('approve')} disabled={Boolean(busyKey)}>
            Auswahl freigeben
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void reviewBatch('reject')} disabled={Boolean(busyKey)}>
            Auswahl ablehnen
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        {requests.map((request) => {
          const requestBusy = busyKey?.startsWith(request.id) ?? false;
          return (
            <Card key={request.id} data-testid={`time-correction-${request.id}`} className="gap-4 py-4">
              <CardHeader className="px-4">
                <div className="flex min-w-0 items-start gap-3">
                  {mode === 'approvals' ? (
                    <Checkbox
                      aria-label={`${request.subjectName} auswählen`}
                      checked={selected.has(request.id)}
                      onCheckedChange={(checked) => setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(request.id); else next.delete(request.id);
                        return next;
                      })}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {TIME_CORRECTION_KIND_LABELS[request.kind]}
                      <Badge variant="outline" className={statusClass(request.status)}>
                        {TIME_CORRECTION_STATUS_LABELS[request.status]}
                      </Badge>
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {request.subjectName} · {formatDateTime(request.createdAt)} · Version {request.currentRevision}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 px-4">
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-medium text-muted-foreground">Bisher wirksam</p>
                    <p className="mt-1">{summarizeSnapshot(request, 'before')}</p>
                  </div>
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Vorgeschlagen</p>
                    <p className="mt-1">{summarizeSnapshot(request, 'proposed')}</p>
                  </div>
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-sm">
                  <span className="font-medium">Begründung:</span> {request.revision.reason}
                </div>
                {request.decisionComment ? (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
                    <span className="font-medium">Rückmeldung:</span> {request.decisionComment}
                  </div>
                ) : null}

                {request.canReview || request.status === 'clarification_required' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`correction-comment-${request.id}`}>
                      {request.status === 'clarification_required' ? 'Antwort' : 'Kommentar'}
                    </Label>
                    <Textarea
                      id={`correction-comment-${request.id}`}
                      value={comments[request.id] ?? ''}
                      onChange={(event) => setComments((current) => ({
                        ...current,
                        [request.id]: event.target.value,
                      }))}
                      placeholder={request.canReview
                        ? 'Für Rückfrage oder Ablehnung erforderlich'
                        : 'Ergänze die angeforderten Angaben'}
                    />
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  {request.canWithdraw ? (
                    <Button size="sm" variant="outline" onClick={() => void withdraw(request)} disabled={requestBusy}>
                      Zurückziehen
                    </Button>
                  ) : null}
                  {request.status === 'clarification_required' && request.canWithdraw ? (
                    <Button size="sm" onClick={() => void resubmit(request)} disabled={requestBusy}>
                      <RotateCcw className="mr-1.5 size-4" /> Erneut einreichen
                    </Button>
                  ) : null}
                  {request.canReview ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => void review(request, 'clarify')} disabled={requestBusy}>
                        <HelpCircle className="mr-1.5 size-4" /> Rückfrage
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void review(request, 'reject')} disabled={requestBusy}>
                        <X className="mr-1.5 size-4" /> Ablehnen
                      </Button>
                      <Button size="sm" onClick={() => void review(request, 'approve')} disabled={requestBusy}>
                        {requestBusy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Check className="mr-1.5 size-4" />}
                        Freigeben
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
