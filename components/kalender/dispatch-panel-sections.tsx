'use client';

import { Send, X } from 'lucide-react';

import type { useBusyIds } from '@/hooks/use-busy-id';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import type { DispatchOverview } from '@/lib/dispatch/types';
import { RecipientChips } from './dispatch-panel-recipient-chips';
import type { DispatchPanelRowDialogState } from './dispatch-panel-row-dialogs';
import type { DispatchPanelOpenChallenge } from './use-dispatch-panel-overview';

type RowBusy = Pick<ReturnType<typeof useBusyIds>, 'isBusy'>;

type DispatchPanelHeaderProps = {
  overview: DispatchOverview | null;
  batchMode: boolean;
  onToggleBatchMode: () => void;
  onClose: () => void;
  primaryHeaderHeight: number;
};

export function DispatchPanelHeader({
  overview,
  batchMode,
  onToggleBatchMode,
  onClose,
  primaryHeaderHeight,
}: DispatchPanelHeaderProps) {
  return (
    <div
      className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6"
      style={{ minHeight: primaryHeaderHeight, height: primaryHeaderHeight }}
    >
      <div className="flex items-center gap-2">
        <Send className="size-5 text-brand-purple" />
        <h2 className="text-base font-semibold">Einsätze</h2>
        {overview && overview.openChallengeCount > 0 && (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-soft-foreground">
            {overview.openChallengeCount} Rückfrage
            {overview.openChallengeCount === 1 ? '' : 'n'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant={batchMode ? 'secondary' : 'outline'} size="sm" onClick={onToggleBatchMode}>
          {batchMode ? 'Auswahl beenden' : 'Verschieben'}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Einsätze schließen">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

type DispatchPanelChallengesProps = {
  openChallenges: DispatchPanelOpenChallenge[];
  rowBusy: RowBusy;
  setResolveChallengeId: DispatchPanelRowDialogState['setResolveChallengeId'];
};

export function DispatchPanelChallenges({
  openChallenges,
  rowBusy,
  setResolveChallengeId,
}: DispatchPanelChallengesProps) {
  return (
    <section aria-labelledby="dispatch-challenges-heading">
      <h3 id="dispatch-challenges-heading" className="mb-2 text-sm font-medium text-muted-foreground">
        Offene Rückfragen
      </h3>
      <div className="space-y-2">
        {openChallenges.map(({ entry, recipient, acknowledgementId }) => (
          <div
            key={`${entry.occurrenceId}:${recipient.employeeRecordId}`}
            className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2"
          >
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <span className="min-w-0 flex-1">
                {recipient.displayName} · {entry.title}
              </span>
              <InlinePending active={rowBusy.isBusy(acknowledgementId)} label="Wird aktualisiert" />
            </p>
            {recipient.challengeReason && (
              <p className="mt-0.5 text-xs text-muted-foreground">{`„${recipient.challengeReason}“`}</p>
            )}
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={rowBusy.isBusy(acknowledgementId)}
                onClick={() => setResolveChallengeId(acknowledgementId)}
              >
                Plan beibehalten …
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type DispatchPanelUnscheduledJobsProps = {
  overview: DispatchOverview;
  rowBusy: RowBusy;
  setCancelDispatch: DispatchPanelRowDialogState['setCancelDispatch'];
};

export function DispatchPanelUnscheduledJobs({
  overview,
  rowBusy,
  setCancelDispatch,
}: DispatchPanelUnscheduledJobsProps) {
  return (
    <section aria-labelledby="dispatch-unscheduled-heading">
      <h3 id="dispatch-unscheduled-heading" className="mb-2 text-sm font-medium text-muted-foreground">
        Ohne Termin versendet
      </h3>
      <div className="space-y-2">
        {overview.unscheduledJobs.map((entry) => (
          <div key={entry.jobId} className="rounded-md border px-3 py-2" data-dispatch-job={entry.jobId}>
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <span className="min-w-0 flex-1 truncate">
                {entry.title}
                {entry.jobNumber && (
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                    {entry.jobNumber}
                  </span>
                )}
              </span>
              <InlinePending active={rowBusy.isBusy(entry.jobId)} label="Wird aktualisiert" />
            </p>
            <p className="text-xs text-muted-foreground">
              {entry.clientName ?? 'Ohne Kunde'} · ohne festen Termin
            </p>
            <RecipientChips recipients={entry.dispatch.recipients} />
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={rowBusy.isBusy(entry.jobId)}
                onClick={() =>
                  setCancelDispatch({
                    dispatchId: entry.dispatch.dispatchId,
                    rowKey: entry.jobId,
                  })
                }
              >
                Einsatz zurückziehen …
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DispatchPanelTravelNotes({ overview }: { overview: DispatchOverview }) {
  return (
    <section aria-labelledby="dispatch-travel-heading">
      <h3 id="dispatch-travel-heading" className="mb-2 text-sm font-medium text-muted-foreground">
        Fahrzeit-Hinweise
      </h3>
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        {overview.travelNotes.map((note, index) => (
          <li
            key={index}
            className={note.kind === 'no_gap_different_sites' ? 'text-warning-text' : undefined}
          >
            {note.kind === 'no_gap_different_sites'
              ? `${note.employeeName}: keine Zeit zwischen „${note.previousTitle}“ und „${note.nextTitle}“ an unterschiedlichen Orten (${note.localDate.split('-').reverse().join('.')}).`
              : `${note.employeeName}: ${note.gapMinutes} Min. zwischen „${note.previousTitle}“ und „${note.nextTitle}“ – Fahrzeit nicht bewertet.`}
          </li>
        ))}
      </ul>
    </section>
  );
}
