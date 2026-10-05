'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Check, HelpCircle, RotateCcw, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { Textarea } from '@/components/ui/textarea';
import {
  TIME_CORRECTION_KIND_LABELS,
  TIME_CORRECTION_STATUS_LABELS,
  type TimeCorrectionRequest,
} from '@/lib/time-corrections/types';
import { formatGermanDateTime } from '@/lib/utils';

function summarizeSnapshot(request: TimeCorrectionRequest, state: 'before' | 'proposed'): string {
  const facts =
    state === 'before' ? request.revision.beforeSnapshot.facts : request.revision.proposedSnapshot.facts;
  const [firstTimestamp, ...laterTimestamps] = facts.map((fact) => formatGermanDateTime(fact.timestamp));
  if (firstTimestamp === undefined) return state === 'before' ? 'Kein Eintrag' : 'Eintrag entfällt';
  const lastTimestamp = laterTimestamps.at(-1);
  return lastTimestamp === undefined ? firstTimestamp : `${firstTimestamp} bis ${lastTimestamp}`;
}

function statusClass(status: TimeCorrectionRequest['status']): string {
  if (status === 'approved') return 'bg-success-soft text-success-soft-foreground';
  if (status === 'rejected' || status === 'application_failed') {
    return 'bg-destructive/10 text-destructive';
  }
  if (status === 'clarification_required') {
    return 'bg-warning-soft text-warning-soft-foreground';
  }
  return 'bg-muted text-muted-foreground';
}

type TimeCorrectionRequestCardProps = {
  request: TimeCorrectionRequest;
  mode: 'approvals' | 'history';
  requestBusy: boolean;
  /** The last list read failed: the shown revision may be outdated, so no decision is offered. */
  stale: boolean;
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  comments: Record<string, string>;
  setComments: Dispatch<SetStateAction<Record<string, string>>>;
  withdraw: (request: TimeCorrectionRequest) => Promise<void>;
  resubmit: (request: TimeCorrectionRequest) => Promise<void>;
  review: (request: TimeCorrectionRequest, decision: 'approve' | 'reject' | 'clarify') => Promise<void>;
};

export function TimeCorrectionRequestCard({
  request,
  mode,
  requestBusy,
  stale,
  selected,
  setSelected,
  comments,
  setComments,
  withdraw,
  resubmit,
  review,
}: TimeCorrectionRequestCardProps) {
  const actionsDisabled = requestBusy || stale;
  return (
    <Card data-testid={`time-correction-${request.id}`} className="gap-4 py-4">
      <CardHeader className="px-4">
        <div className="flex min-w-0 items-start gap-3">
          {mode === 'approvals' ? (
            <Checkbox
              aria-label={`${request.subjectName} auswählen`}
              checked={selected.has(request.id)}
              onCheckedChange={(checked) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(request.id);
                  else next.delete(request.id);
                  return next;
                })
              }
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {TIME_CORRECTION_KIND_LABELS[request.kind]}
              <Badge variant="outline" className={statusClass(request.status)}>
                {TIME_CORRECTION_STATUS_LABELS[request.status]}
              </Badge>
              <InlinePending active={requestBusy} />
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {request.subjectName} · {formatGermanDateTime(request.createdAt)} · Version{' '}
              {request.currentRevision}
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
          <div className="rounded-md border border-warning/30 bg-warning-soft p-3">
            <p className="text-xs font-medium text-muted-foreground">Vorgeschlagen</p>
            <p className="mt-1">{summarizeSnapshot(request, 'proposed')}</p>
          </div>
        </div>
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <span className="font-medium">Begründung:</span> {request.revision.reason}
        </div>
        {request.decisionComment ? (
          <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm">
            <span className="font-medium">Rückmeldung:</span> {request.decisionComment}
          </div>
        ) : null}

        {request.canReview || request.status === 'clarification_required' ? (
          <Field
            label={request.status === 'clarification_required' ? 'Antwort' : 'Kommentar'}
            htmlFor={`correction-comment-${request.id}`}
          >
            <Textarea
              value={comments[request.id] ?? ''}
              onChange={(event) =>
                setComments((current) => ({
                  ...current,
                  [request.id]: event.target.value,
                }))
              }
              placeholder={
                request.canReview
                  ? 'Für Rückfrage oder Ablehnung erforderlich'
                  : 'Ergänze die angeforderten Angaben'
              }
            />
          </Field>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {request.canWithdraw ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void withdraw(request)}
              disabled={actionsDisabled}
            >
              Zurückziehen
            </Button>
          ) : null}
          {request.status === 'clarification_required' && request.canWithdraw ? (
            <Button size="sm" onClick={() => void resubmit(request)} disabled={actionsDisabled}>
              <RotateCcw className="mr-1.5 size-4" /> Erneut einreichen
            </Button>
          ) : null}
          {request.canReview ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void review(request, 'clarify')}
                disabled={actionsDisabled}
              >
                <HelpCircle className="mr-1.5 size-4" /> Rückfrage
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void review(request, 'reject')}
                disabled={actionsDisabled}
              >
                <X className="mr-1.5 size-4" /> Ablehnen
              </Button>
              <Button size="sm" onClick={() => void review(request, 'approve')} disabled={actionsDisabled}>
                <Check className="mr-1.5 size-4" />
                Freigeben
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
