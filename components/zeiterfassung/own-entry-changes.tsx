'use client';

import { ListRow } from '@/components/ui/list-row';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatProfileName, type MemberListEntry } from '@/lib/members/profile-name';
import type { AuditedEntryState, TimeEntryAuditEvent, TimeEntryType } from '@/lib/time-tracking/types';
import { formatBerlinDateTime } from '@/lib/utils';

// The Verlauf's record of Admins' own direct edits and deletions (owner
// decision 2026-10-27): who changed their own entry, when, and the entry
// before and after. Shown to Admin and Büro only while it has an event.

export const ENTRY_TYPE_LABELS: Readonly<Record<TimeEntryType, string>> = {
  clock_in: 'Einstempeln',
  clock_out: 'Ausstempeln',
  break_start: 'Pause starten',
  break_end: 'Pause beenden',
};

function describeState(state: AuditedEntryState): string {
  return `${ENTRY_TYPE_LABELS[state.entryType]} · ${formatBerlinDateTime(state.timestamp)}`;
}

function describeAfter(event: TimeEntryAuditEvent): string {
  if (!event.after) return 'Gelöscht';
  const jobNote = event.after.jobId === event.before.jobId ? '' : ' · Auftrag geändert';
  return `${describeState(event.after)}${jobNote}`;
}

type OwnEntryChangesProps = {
  events: readonly TimeEntryAuditEvent[];
  /** The organization's members, for the Admins' names. */
  members: readonly MemberListEntry[];
};

/** Renders from the Verlauf's read: its skeleton, failure and stale marking cover this section too. */
export function OwnEntryChanges({ events, members }: OwnEntryChangesProps) {
  if (events.length === 0) return null;
  const nameOf = (userId: string): string => {
    const member = members.find((candidate) => candidate.user_id === userId);
    return member ? formatProfileName(member) : 'Unbekannt';
  };

  return (
    <section className="space-y-3" aria-labelledby="own-entry-changes-heading">
      <div className="space-y-1">
        <h3 id="own-entry-changes-heading" className="font-semibold">
          Direkte Änderungen durch Admins
        </h3>
        <p className="text-sm text-muted-foreground">
          Admins dürfen eigene Einträge direkt ändern. Jede solche Änderung steht hier mit dem Stand davor und
          danach.
        </p>
      </div>
      <div className="space-y-2">
        <div className="space-y-2 md:hidden">
          {events.map((event) => (
            <ListRow key={event.id} className="block space-y-1" data-time-entry-audit-event={event.id}>
              <p className="text-sm font-medium">{nameOf(event.actorId)}</p>
              <p className="text-sm">Vorher: {describeState(event.before)}</p>
              <p className="text-sm">Nachher: {describeAfter(event)}</p>
              <p className="text-sm text-muted-foreground">
                Geändert am {formatBerlinDateTime(event.createdAt)}
              </p>
            </ListRow>
          ))}
        </div>
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admin</TableHead>
                <TableHead>Vorher</TableHead>
                <TableHead>Nachher</TableHead>
                <TableHead>Geändert am</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id} data-time-entry-audit-event={event.id}>
                  <TableCell className="font-medium">{nameOf(event.actorId)}</TableCell>
                  <TableCell>{describeState(event.before)}</TableCell>
                  <TableCell>{describeAfter(event)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBerlinDateTime(event.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
