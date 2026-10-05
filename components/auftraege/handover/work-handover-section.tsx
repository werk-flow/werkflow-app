'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { CheckCircle2, Download, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  WORK_HANDOVER_READINESS_LABELS,
  WORK_HANDOVER_STATE_LABELS,
  type WorkHandoverFieldStatus,
  type WorkHandoverWorkspace,
} from '@/lib/work-handover/types';
import { useWorkHandoverReview } from './use-work-handover-review';
import { createWorkHandoverActions } from './work-handover-actions';
import { openDocument } from './work-handover-document';
import { FeedbackText } from './work-handover-feedback';
import { WorkHandoverReleaseReview } from './work-handover-release-review';
import {
  WorkHandoverCorrectionRequest,
  WorkHandoverReleasedActions,
  WorkHandoverReleaseHistory,
} from './work-handover-released';
import { WorkHandoverSourceSelection } from './work-handover-source-selection';

export function WorkHandoverSection({
  initialWorkspace,
}: {
  initialWorkspace: WorkHandoverWorkspace;
}): ReactElement {
  const review = useWorkHandoverReview(initialWorkspace);
  const actions = createWorkHandoverActions(initialWorkspace, review);
  const { isRefreshing, canEdit, packageVersion, feedbackFor } = review;

  return (
    <Card className="gap-0 border py-0 shadow-xs" data-testid="work-handover-section">
      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Übergabe an das Büro</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Kundenfähige Inhalte auswählen, prüfen und als unveränderliche Freigabe sichern.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InlinePending active={isRefreshing} label="Übergabestand wird aktualisiert" />
            <Badge variant={initialWorkspace.packageState === 'released' ? 'success' : 'secondary'}>
              {WORK_HANDOVER_STATE_LABELS[initialWorkspace.packageState]}
            </Badge>
          </div>
        </div>

        {initialWorkspace.commercialReadiness && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-success-text" aria-hidden="true" />
            {WORK_HANDOVER_READINESS_LABELS[initialWorkspace.commercialReadiness]}
          </div>
        )}

        {initialWorkspace.staleSourceCount > 0 && (
          <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
            {initialWorkspace.staleSourceCount === 1
              ? 'Eine gespeicherte Quelle ist nicht mehr aktuell und wird beim nächsten Speichern entfernt.'
              : `${initialWorkspace.staleSourceCount} gespeicherte Quellen sind nicht mehr aktuell und werden beim nächsten Speichern entfernt.`}
          </p>
        )}

        {/* Release, withdrawal and correction change the package state, and the
            route refresh that follows unmounts the block they were started from.
            Their confirmation therefore lives at section level. */}
        <FeedbackText feedback={feedbackFor('release', 'withdraw', 'correction')} />

        {canEdit ? (
          <WorkHandoverSourceSelection
            initialWorkspace={initialWorkspace}
            review={review}
            actions={actions}
          />
        ) : initialWorkspace.packageState !== 'released' ? (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            Die Ausführung muss abgeschlossen sein, bevor das Büro die Übergabe prüfen kann.
          </p>
        ) : null}

        {canEdit && packageVersion > 0 && (
          <WorkHandoverReleaseReview initialWorkspace={initialWorkspace} review={review} actions={actions} />
        )}

        {initialWorkspace.packageState === 'released' && (
          <WorkHandoverReleasedActions
            initialWorkspace={initialWorkspace}
            review={review}
            actions={actions}
          />
        )}

        {initialWorkspace.packageState === 'reopened' &&
          initialWorkspace.executionState === 'execution_complete' && (
            <WorkHandoverCorrectionRequest review={review} actions={actions} />
          )}

        {initialWorkspace.releases.length > 0 && (
          <WorkHandoverReleaseHistory initialWorkspace={initialWorkspace} />
        )}
      </div>
    </Card>
  );
}

export function WorkHandoverSummary({
  workspace,
  href,
}: {
  workspace: WorkHandoverWorkspace;
  href: string;
}): ReactElement {
  const actionLabel =
    workspace.packageState === 'released'
      ? 'Übergabe ansehen'
      : workspace.executionState === 'execution_complete'
        ? 'Übergabe prüfen'
        : 'Übergabestand ansehen';
  return (
    <Card className="gap-0 border py-0 shadow-xs" data-testid="work-handover-summary">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">Übergabe an das Büro</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {WORK_HANDOVER_STATE_LABELS[workspace.packageState]}
            {workspace.currentReleaseNumber ? ` · Freigabe ${workspace.currentReleaseNumber}` : ''}
          </p>
        </div>
        <Button asChild variant={workspace.executionState === 'execution_complete' ? 'default' : 'outline'}>
          <Link href={href}>{actionLabel}</Link>
        </Button>
      </div>
    </Card>
  );
}

export function FieldWorkHandoverStatus({ status }: { status: WorkHandoverFieldStatus }): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const { run: runDocumentTask, isPending: pending } = usePendingTask();
  return (
    <section
      className="rounded-lg border bg-card p-4 shadow-xs sm:p-5"
      aria-labelledby="field-handover-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="field-handover-heading" className="font-semibold">
            Übergabestand
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{WORK_HANDOVER_STATE_LABELS[status.state]}</p>
        </div>
        {status.releaseNumber && <Badge variant="secondary">Freigabe {status.releaseNumber}</Badge>}
      </div>
      {status.documentId && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={pending}
          onClick={() => {
            if (!status.documentId) return;
            const openPromise = openDocument(status.documentId);
            void runDocumentTask(async () => setError(await openPromise));
          }}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Download />}
          Übergabedokument
        </Button>
      )}
      {error && (
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </section>
  );
}
