'use client';

import { Clock, Lock, Pencil, Undo2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { isEntryInClosedPeriod, type ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { cn, formatBerlin, formatBerlinDateTime } from '@/lib/utils';
import { getEntryTypeLabel } from './entry-history-labels';

// The one action of a row in the Verlauf: „Korrigieren“ on accepted time,
// „Zurückziehen“ on the viewer's own pending manual submission, or why
// neither applies.

export type EntryHistoryRowActionProps = {
  entry: TimeEntry;
  /** `anyBusy`: one withdrawal at a time, since a submission spans several rows. */
  settling: { isBusy: (id: string) => boolean; anyBusy: boolean };
  hydrated: boolean;
  closedPeriods: readonly ClosedTimePeriod[];
  setCorrectionEntry: (entry: TimeEntry) => void;
  /** The viewer's user id: only the author of a pending submission withdraws it. */
  currentUserId: string | null;
  withdraw: (entry: TimeEntry) => void;
  align?: 'start' | 'end';
};

/** In place of „Korrigieren“ on an entry of a closed month: the server would refuse the correction. */
function ClosedMonthLabel({ className }: { className?: string | undefined }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}>
      <Lock className="size-4" aria-hidden="true" /> Monat abgeschlossen
    </span>
  );
}

/** A pending manual entry the viewer submitted and an approver has not decided yet. */
function isOwnPendingSubmission(entry: TimeEntry, currentUserId: string | null): boolean {
  return entry.status === 'pending' && entry.isManual && entry.userId === currentUserId;
}

export function EntryHistoryRowAction({
  entry,
  settling,
  hydrated,
  closedPeriods,
  setCorrectionEntry,
  currentUserId,
  withdraw,
  align = 'start',
}: EntryHistoryRowActionProps) {
  const inClosedMonth = isEntryInClosedPeriod(entry, closedPeriods);
  if (settling.isBusy(entry.id)) {
    return <InlinePending active className={align === 'end' ? 'ml-auto' : undefined} />;
  }
  if (entry.pendingCorrectionRequestId) {
    return (
      <Button variant="ghost" size="sm" disabled>
        <Clock className="mr-1.5 size-4" /> Korrektur in Prüfung
      </Button>
    );
  }
  if (inClosedMonth && (entry.status === 'approved' || isOwnPendingSubmission(entry, currentUserId))) {
    return <ClosedMonthLabel className={align === 'end' ? 'justify-end' : undefined} />;
  }
  if (isOwnPendingSubmission(entry, currentUserId)) {
    return (
      <WithdrawSubmissionButton entry={entry} disabled={!hydrated || settling.anyBusy} withdraw={withdraw} />
    );
  }
  if (entry.status === 'approved') {
    return (
      <Button variant="ghost" size="sm" disabled={!hydrated} onClick={() => setCorrectionEntry(entry)}>
        <Pencil className="mr-1.5 size-4" /> Korrigieren
      </Button>
    );
  }
  return null;
}

/**
 * „Zurückziehen“ removes the whole pending submission of that day, every row
 * of it, so the author confirms first.
 */
function WithdrawSubmissionButton({
  entry,
  disabled,
  withdraw,
}: {
  entry: TimeEntry;
  disabled: boolean;
  withdraw: (entry: TimeEntry) => void;
}) {
  const day = formatBerlin(entry.timestamp, 'weekdayDate');
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`${getEntryTypeLabel(entry)} vom ${formatBerlinDateTime(entry.timestamp)} zurückziehen`}
        >
          <Undo2 className="mr-1.5 size-4" /> Zurückziehen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Nachtrag zurückziehen?</AlertDialogTitle>
          <AlertDialogDescription>
            Alle Einträge deines Nachtrags vom {day} werden zurückgezogen und nicht mehr geprüft. Du kannst
            die Zeit danach neu nachtragen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => withdraw(entry)}>
            Zurückziehen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
