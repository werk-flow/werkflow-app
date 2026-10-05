'use client';

import { Download, Loader2, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { Textarea } from '@/components/ui/textarea';
import { formatBerlinDateTime as formatDateTime } from '@/lib/utils';
import { WORK_HANDOVER_READINESS_LABELS, type WorkHandoverWorkspace } from '@/lib/work-handover/types';
import type { WorkHandoverReview } from './use-work-handover-review';
import type { WorkHandoverActions } from './work-handover-actions';
import { FeedbackText } from './work-handover-feedback';

type WorkHandoverReleasedProps = {
  initialWorkspace: WorkHandoverWorkspace;
  review: WorkHandoverReview;
  actions: WorkHandoverActions;
};

/** The released package: its document and the reasoned withdrawal. */
export function WorkHandoverReleasedActions({
  initialWorkspace,
  review,
  actions,
}: WorkHandoverReleasedProps) {
  const { attempted, reopenReason, setReopenReason, isBusy, anyBusy, feedbackFor } = review;
  const { reopenReasonError, reopen, downloadReleaseDocument } = actions;
  const { currentReleaseDocumentId } = initialWorkspace;
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {initialWorkspace.currentReleaseNumber
            ? `Freigabe ${initialWorkspace.currentReleaseNumber}`
            : 'Freigegeben'}
        </span>
        {currentReleaseDocumentId && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => downloadReleaseDocument(currentReleaseDocumentId)}
            disabled={anyBusy}
          >
            {isBusy('document') ? <Loader2 className="animate-spin" /> : <Download />}
            Dokument herunterladen
          </Button>
        )}
      </div>
      <FeedbackText feedback={feedbackFor('document')} />
      <Field
        label="Grund für die Rücknahme"
        htmlFor="handover-withdraw-reason"
        required
        error={attempted === 'withdraw' ? reopenReasonError : undefined}
      >
        <Textarea
          value={reopenReason}
          onChange={(event) => setReopenReason(event.target.value)}
          placeholder="Was muss in einer neuen Freigabe korrigiert werden?"
        />
      </Field>
      <Button type="button" variant="outline" onClick={() => reopen('withdraw')} disabled={anyBusy}>
        {isBusy('withdraw') ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        Übergabe zurücknehmen
      </Button>
    </div>
  );
}

/** Returns a reopened package's execution to the field for correction. */
export function WorkHandoverCorrectionRequest({
  review,
  actions,
}: Pick<WorkHandoverReleasedProps, 'review' | 'actions'>) {
  const { attempted, reopenReason, setReopenReason, isBusy, anyBusy } = review;
  const { reopenReasonError, reopen } = actions;
  return (
    <div className="space-y-2 border-t pt-4">
      <Field
        label="Ausführung erneut öffnen"
        htmlFor="handover-correction-reason"
        required
        error={attempted === 'correction' ? reopenReasonError : undefined}
      >
        <Textarea
          value={reopenReason}
          onChange={(event) => setReopenReason(event.target.value)}
          placeholder="Welche Korrektur ist vor Ort erforderlich?"
        />
      </Field>
      <Button type="button" variant="outline" onClick={() => reopen('correction')} disabled={anyBusy}>
        {isBusy('correction') ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        Zur Korrektur in Ausführung geben
      </Button>
    </div>
  );
}

export function WorkHandoverReleaseHistory({
  initialWorkspace,
}: Pick<WorkHandoverReleasedProps, 'initialWorkspace'>) {
  return (
    <FormDisclosure
      className="border-t pt-4 text-sm"
      label={`Freigabeverlauf (${initialWorkspace.releases.length})`}
    >
      <ul className="mt-3 space-y-2">
        {initialWorkspace.releases.map((releaseEntry) => (
          <li key={releaseEntry.id} className="flex flex-wrap justify-between gap-2 rounded-md border p-3">
            <span>
              Freigabe {releaseEntry.release_number} ·{' '}
              {WORK_HANDOVER_READINESS_LABELS[releaseEntry.commercial_readiness]}
            </span>
            <span className="text-muted-foreground">{formatDateTime(releaseEntry.reviewed_at)}</span>
          </li>
        ))}
      </ul>
    </FormDisclosure>
  );
}
