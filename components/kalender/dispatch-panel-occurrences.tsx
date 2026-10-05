'use client';

import { AlertTriangle, CalendarCheck, Send } from 'lucide-react';

import type { useBusyIds } from '@/hooks/use-busy-id';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { InlinePending } from '@/components/ui/inline-pending';
import {
  DISPATCH_OVERVIEW_MAX_OFFSET_DAYS,
  type DispatchOverview,
  type DispatchOverviewOccurrence,
} from '@/lib/dispatch/types';
import { formatCommitmentWindow } from '@/lib/commitments/types';
import { RecipientChips } from './dispatch-panel-recipient-chips';
import type { DispatchPanelRowDialogState } from './dispatch-panel-row-dialogs';
import { formatOccurrenceSchedule } from './dispatch-panel-schedule';
import type { DispatchPanelBatch } from './use-dispatch-panel-batch';

type RowBusy = Pick<ReturnType<typeof useBusyIds>, 'isBusy'>;

type DispatchPanelOccurrenceActionsProps = {
  entry: DispatchOverviewOccurrence;
  rowBusy: RowBusy;
  dialogs: DispatchPanelRowDialogState;
};

/** The dialogs a planned visit can open: send, withdraw, and customer commitment. */
function DispatchPanelOccurrenceActions({ entry, rowBusy, dialogs }: DispatchPanelOccurrenceActionsProps) {
  const { dispatch, commitment } = entry;
  const { setIssueTarget, setCancelDispatch, setCommitmentEntry, setWithdrawCommitment } = dialogs;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {!dispatch && entry.assignedEmployeeRecordIds.length > 0 && (
        <Button
          size="sm"
          disabled={rowBusy.isBusy(entry.occurrenceId)}
          onClick={() =>
            setIssueTarget({
              occurrenceId: entry.occurrenceId,
            })
          }
        >
          <Send className="size-3.5" />
          Einsatz senden
        </Button>
      )}
      {!dispatch && entry.assignedEmployeeRecordIds.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Keine Personen zugewiesen – zuerst im Kalender zuweisen.
        </p>
      )}
      {dispatch && (
        <Button
          variant="outline"
          size="sm"
          disabled={rowBusy.isBusy(entry.occurrenceId)}
          onClick={() =>
            setCancelDispatch({
              dispatchId: dispatch.dispatchId,
              rowKey: entry.occurrenceId,
            })
          }
        >
          Einsatz zurückziehen …
        </Button>
      )}
      {commitment ? (
        <>
          {entry.commitmentMismatch && (
            <Button
              size="sm"
              disabled={rowBusy.isBusy(entry.occurrenceId)}
              onClick={() => setCommitmentEntry(entry)}
            >
              Neue Zusage erfassen
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={rowBusy.isBusy(entry.occurrenceId)}
            onClick={() =>
              setWithdrawCommitment({
                commitmentId: commitment.commitmentId,
                rowKey: entry.occurrenceId,
              })
            }
          >
            Zusage zurückziehen …
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={rowBusy.isBusy(entry.occurrenceId)}
          onClick={() => setCommitmentEntry(entry)}
        >
          Zusage erfassen
        </Button>
      )}
    </div>
  );
}

type DispatchPanelOccurrenceRowProps = DispatchPanelOccurrenceActionsProps & {
  batch: DispatchPanelBatch;
};

function DispatchPanelOccurrenceRow({ entry, rowBusy, dialogs, batch }: DispatchPanelOccurrenceRowProps) {
  const { batchMode, selectedIds, setSelectedIds, eligibleForBatch } = batch;

  return (
    <div className="rounded-md border px-3 py-2" data-dispatch-occurrence={entry.occurrenceId}>
      <div className="flex items-start gap-2">
        {batchMode && (
          <Checkbox
            className="mt-0.5"
            checked={selectedIds.has(entry.occurrenceId)}
            disabled={!eligibleForBatch.some((candidate) => candidate.occurrenceId === entry.occurrenceId)}
            onCheckedChange={(checked) =>
              setSelectedIds((previous) => {
                const next = new Set(previous);
                if (checked) next.add(entry.occurrenceId);
                else next.delete(entry.occurrenceId);
                return next;
              })
            }
            aria-label={`${entry.title} für Verschiebung auswählen`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span className="min-w-0 flex-1 truncate">
              {entry.title}
              {entry.jobNumber && (
                <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{entry.jobNumber}</span>
              )}
            </span>
            <InlinePending active={rowBusy.isBusy(entry.occurrenceId)} label="Wird aktualisiert" />
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatOccurrenceSchedule(entry)}
            {entry.clientName ? ` · ${entry.clientName}` : ''}
          </p>
          {entry.siteName && (
            <p className="text-xs text-muted-foreground">
              {entry.siteName}
              {entry.siteAccessNotes ? ` · ${entry.siteAccessNotes}` : ''}
            </p>
          )}
          {entry.commitment && (
            <p
              className={`mt-1 flex items-center gap-1 text-xs ${
                entry.commitmentMismatch ? 'font-medium text-warning-text' : 'text-muted-foreground'
              }`}
              data-commitment-mismatch={entry.commitmentMismatch ? 'true' : 'false'}
            >
              {entry.commitmentMismatch ? (
                <AlertTriangle className="size-3.5 shrink-0" />
              ) : (
                <CalendarCheck className="size-3.5 shrink-0" />
              )}
              Zusage:{' '}
              {formatCommitmentWindow({
                committedDate: entry.commitment.committedDate,
                windowStartTime: entry.commitment.windowStartTime,
                windowEndTime: entry.commitment.windowEndTime,
              })}
              {entry.commitmentMismatch && ' – weicht vom Plan ab'}
            </p>
          )}
          {entry.dispatch ? (
            <RecipientChips recipients={entry.dispatch.recipients} />
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Noch nicht versendet</p>
          )}
          {!batchMode && <DispatchPanelOccurrenceActions entry={entry} rowBusy={rowBusy} dialogs={dialogs} />}
        </div>
      </div>
    </div>
  );
}

type DispatchPanelOccurrencesProps = {
  overview: DispatchOverview | null;
  rowBusy: RowBusy;
  dialogs: DispatchPanelRowDialogState;
  batch: DispatchPanelBatch;
};

export function DispatchPanelOccurrences({
  overview,
  rowBusy,
  dialogs,
  batch,
}: DispatchPanelOccurrencesProps) {
  return (
    <section aria-labelledby="dispatch-occurrences-heading">
      <h3 id="dispatch-occurrences-heading" className="mb-2 text-sm font-medium text-muted-foreground">
        Geplante Besuche (nächste {DISPATCH_OVERVIEW_MAX_OFFSET_DAYS} Tage)
      </h3>
      {overview && overview.occurrences.length === 0 && (
        <p className="text-sm text-muted-foreground">Keine geplanten Auftragsbesuche im Zeitraum.</p>
      )}
      <div className="space-y-2">
        {(overview?.occurrences ?? []).map((entry) => (
          <DispatchPanelOccurrenceRow
            key={entry.occurrenceId}
            entry={entry}
            rowBusy={rowBusy}
            dialogs={dialogs}
            batch={batch}
          />
        ))}
      </div>
    </section>
  );
}
