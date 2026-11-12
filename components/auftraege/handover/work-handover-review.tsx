'use client';

import type { ReactElement } from 'react';
import { CheckCircle2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { InlinePending } from '@/components/ui/inline-pending';
import {
  WORK_HANDOVER_READINESS_LABELS,
  WORK_HANDOVER_STATE_LABELS,
  type WorkHandoverWorkspace,
} from '@/lib/work-handover/types';
import { useWorkHandoverReview } from './use-work-handover-review';
import { createWorkHandoverActions } from './work-handover-actions';
import { FeedbackText } from './work-handover-feedback';
import { WorkHandoverReleaseReview } from './work-handover-release-review';
import {
  WorkHandoverCorrectionRequest,
  WorkHandoverReleasedActions,
  WorkHandoverReleaseHistory,
} from './work-handover-released';
import { WorkHandoverSourceSelection } from './work-handover-source-selection';

/**
 * The office's handover review on the Übergabe page. It lives apart from the
 * summary and status cards in work-handover-section.tsx, which the job and
 * project pages import, so those pages do not download the review.
 */
export function WorkHandoverSection({
  initialWorkspace,
  workHref,
}: {
  initialWorkspace: WorkHandoverWorkspace;
  /** The job or project page, where the next step of an empty review happens. */
  workHref: string;
}): ReactElement {
  const review = useWorkHandoverReview(initialWorkspace);
  const actions = createWorkHandoverActions(initialWorkspace, review);
  const { isRefreshing, canEdit, feedbackFor } = review;

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
            workHref={workHref}
            review={review}
            actions={actions}
          />
        ) : initialWorkspace.packageState !== 'released' ? (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            Die Ausführung muss abgeschlossen sein, bevor das Büro die Übergabe prüfen kann.
          </p>
        ) : null}

        {canEdit && (
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
