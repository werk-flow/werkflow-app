'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { useRef, useState } from 'react';
import { Clock, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { SectionError } from '@/components/ui/section-error';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows, type SkeletonColumn } from '@/components/ui/skeleton-table';
import { cn, formatGermanDateTime, parseIsoLocalDate } from '@/lib/utils';
import { getBusinessTodayIso, shiftIsoDateByDays } from '@/lib/personnel/types';
import { readInBackground } from '@/lib/data/background-read-client';
import type { TimeEntry, TimeEntryStatus } from '@/lib/time-tracking/types';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useHydrated } from '@/hooks/use-hydrated';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { TimeCorrectionDialog } from './time-correction-dialog';
import { EntryHistoryFilters, type EntryHistoryMemberInfo } from './entry-history-filters';

// Settle key for a correction that adds time (no row yet); entry ids are UUIDs.
const NEW_ENTRY_ID = 'new';

interface EntryHistoryProps {
  organizationId: string;
  members?: EntryHistoryMemberInfo[];
}

interface EntryWithProfile extends TimeEntry {
  firstName?: string | null;
  lastName?: string | null;
}

// Entry rows do nothing on click, so neither they nor their skeletons hover.
export const ENTRY_HISTORY_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'employee', header: 'Mitarbeiter', skeleton: <Skeleton className="h-4 w-32" /> },
  { id: 'type', header: 'Typ', skeleton: <Skeleton className="h-4 w-20" /> },
  { id: 'timestamp', header: 'Zeitstempel', skeleton: <Skeleton className="h-4 w-32" /> },
  { id: 'status', header: 'Status', skeleton: <Skeleton className="h-5 w-20 rounded-full" /> },
  { id: 'manual', header: 'Manuell', skeleton: <Skeleton className="h-4 w-8" /> },
  { id: 'reviewedAt', header: 'Bearbeitet am', skeleton: <Skeleton className="h-4 w-32" /> },
  {
    id: 'actions',
    header: 'Aktionen',
    className: 'text-right',
    skeleton: <Skeleton className="ml-auto h-8 w-28" />,
  },
];

function EntryHistoryHeaderRow() {
  return (
    <TableRow>
      {ENTRY_HISTORY_COLUMNS.map((column) => (
        <TableHead key={column.id} className={column.className}>
          {column.header}
        </TableHead>
      ))}
    </TableRow>
  );
}

const STATUS_LABELS: Record<TimeEntryStatus, { label: string; className: string }> = {
  approved: {
    label: 'Genehmigt',
    className: 'bg-success-soft text-success-soft-foreground',
  },
  pending: {
    label: 'Ausstehend',
    className: 'bg-warning-soft text-warning-soft-foreground',
  },
  rejected: {
    label: 'Abgelehnt',
    className: 'bg-destructive-soft text-destructive-soft-foreground',
  },
  pending_delete: {
    label: 'Löschung ausstehend',
    className: 'bg-warning-soft text-warning-soft-foreground',
  },
};

function getEntryTypeLabel(entry: TimeEntry): string {
  const activityLabels = {
    work: 'Arbeit',
    travel: 'Fahrt',
    break: 'Pause',
    standby: 'Bereitschaft',
    callout: 'Notdienst',
    internal_activity: 'Interne Tätigkeit',
  } as const;
  const direction = entry.entryType === 'clock_in' || entry.entryType === 'break_start' ? 'Start' : 'Ende';
  if (entry.activityKind) return `${activityLabels[entry.activityKind]} · ${direction}`;
  if (entry.entryType === 'break_start') return 'Pause starten';
  if (entry.entryType === 'break_end') return 'Pause beenden';
  return entry.entryType === 'clock_in' ? 'Einstempeln' : 'Ausstempeln';
}

function getEntryHistoryDisplayName(entry: EntryWithProfile): string {
  if (entry.firstName || entry.lastName) {
    return `${entry.firstName || ''} ${entry.lastName || ''}`.trim();
  }
  return 'Unbekannt';
}

type EntryHistoryQuery = {
  organizationId: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  statusFilter: string;
  memberFilter: string;
};

type ProfileNames = Map<string, { firstName: string | null; lastName: string | null }>;

/**
 * `knownNames` keeps the names this view already read: a live refresh after
 * an approval reads the entries only, and names follow in a second request
 * only for people the view has not shown yet.
 */
async function readEntryHistory(
  { organizationId, dateFrom, dateTo, statusFilter, memberFilter }: EntryHistoryQuery,
  knownNames: ProfileNames,
  signal: AbortSignal,
): Promise<LiveViewResult<EntryWithProfile[]>> {
  // The view reads only with a complete date range (`enabled` below).
  if (!dateFrom || !dateTo) return { ok: false };
  try {
    const fromDate = new Date(dateFrom);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    const result = await readInBackground(
      'time-entries',
      {
        organizationId,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        ...(statusFilter !== 'all' ? { status: statusFilter as TimeEntryStatus } : {}),
        ...(memberFilter !== 'all' ? { userId: memberFilter } : {}),
      },
      signal,
    );

    if (!result.success) return { ok: false };

    const unknownUserIds = [...new Set(result.entries.map((e) => e.userId))].filter(
      (userId) => !knownNames.has(userId),
    );
    if (unknownUserIds.length > 0) {
      const profiles = await readInBackground('profiles-by-ids', { userIds: unknownUserIds }, signal);
      if (!profiles.success) return { ok: false };
      // A name the server did not return is asked for again on the next read.
      for (const userId of unknownUserIds) {
        const profile = profiles.profiles[userId];
        if (profile) knownNames.set(userId, profile);
      }
    }

    // Merge profile data with entries
    const entriesWithProfiles: EntryWithProfile[] = result.entries.map((entry) => ({
      ...entry,
      firstName: knownNames.get(entry.userId)?.firstName ?? null,
      lastName: knownNames.get(entry.userId)?.lastName ?? null,
    }));

    // Sort by reviewedAt descending (most recent first), fallback to createdAt
    return {
      ok: true,
      data: entriesWithProfiles.sort((a, b) => {
        const dateA = a.reviewedAt ? new Date(a.reviewedAt).getTime() : new Date(a.createdAt).getTime();
        const dateB = b.reviewedAt ? new Date(b.reviewedAt).getTime() : new Date(b.createdAt).getTime();
        return dateB - dateA;
      }),
    };
  } catch {
    // A transport failure; the server logs its own failures.
    return { ok: false };
  }
}

function EntryHistorySkeleton() {
  return (
    <>
      <SkeletonList count={5} className="md:hidden">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
        </div>
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <EntryHistoryHeaderRow />
          </TableHeader>
          <TableBody>
            <SkeletonRows columns={ENTRY_HISTORY_COLUMNS} rows={5} />
          </TableBody>
        </Table>
      </div>
    </>
  );
}

type EntryHistoryRowsProps = {
  entries: EntryWithProfile[];
  settling: { isBusy: (id: string) => boolean };
  hydrated: boolean;
  setCorrectionEntry: (entry: TimeEntry) => void;
};

/* Mobile cards */
function EntryHistoryCards({ entries, settling, hydrated, setCorrectionEntry }: EntryHistoryRowsProps) {
  return (
    <div className="space-y-2 md:hidden">
      {entries.map((entry) => (
        <ListRow
          key={entry.id}
          className="block space-y-2"
          data-time-entry={entry.id}
          data-time-entry-status={entry.status}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{getEntryTypeLabel(entry)}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                STATUS_LABELS[entry.status].className,
              )}
            >
              {STATUS_LABELS[entry.status].label}
            </span>
          </div>
          <p className="text-sm font-medium">{getEntryHistoryDisplayName(entry)}</p>
          <p className="text-sm text-muted-foreground">{formatGermanDateTime(entry.timestamp)}</p>
          {entry.isManual && (
            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs">Manuell</span>
          )}
          {settling.isBusy(entry.id) ? (
            <InlinePending active />
          ) : entry.pendingCorrectionRequestId ? (
            <Button variant="ghost" size="sm" disabled>
              <Clock className="mr-1.5 size-4" /> Korrektur in Prüfung
            </Button>
          ) : entry.status === 'approved' ? (
            <Button variant="ghost" size="sm" disabled={!hydrated} onClick={() => setCorrectionEntry(entry)}>
              <Pencil className="mr-1.5 size-4" /> Korrigieren
            </Button>
          ) : null}
        </ListRow>
      ))}
    </div>
  );
}

/* Desktop table */
function EntryHistoryTable({ entries, settling, hydrated, setCorrectionEntry }: EntryHistoryRowsProps) {
  return (
    <div className="hidden md:block">
      <Table>
        <TableHeader>
          <EntryHistoryHeaderRow />
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id} data-time-entry={entry.id} data-time-entry-status={entry.status}>
              <TableCell className="font-medium">{getEntryHistoryDisplayName(entry)}</TableCell>
              <TableCell>{getEntryTypeLabel(entry)}</TableCell>
              <TableCell>{formatGermanDateTime(entry.timestamp)}</TableCell>
              <TableCell>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    STATUS_LABELS[entry.status].className,
                  )}
                >
                  {STATUS_LABELS[entry.status].label}
                </span>
              </TableCell>
              <TableCell>{entry.isManual ? 'Ja' : 'Nein'}</TableCell>
              <TableCell className="text-muted-foreground">
                {entry.reviewedAt ? formatGermanDateTime(entry.reviewedAt) : '-'}
              </TableCell>
              <TableCell className="text-right">
                {settling.isBusy(entry.id) ? (
                  <InlinePending active className="ml-auto" />
                ) : entry.pendingCorrectionRequestId ? (
                  <Button variant="ghost" size="sm" disabled>
                    <Clock className="mr-1.5 size-4" /> Korrektur in Prüfung
                  </Button>
                ) : entry.status === 'approved' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!hydrated}
                    onClick={() => setCorrectionEntry(entry)}
                  >
                    <Pencil className="mr-1.5 size-4" /> Korrigieren
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EntryHistory({ organizationId, members = [] }: EntryHistoryProps) {
  const hydrated = useHydrated();
  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [memberFilter, setMemberFilter] = useState<string>('all');
  // The default range starts from the Berlin business date, which the server
  // render and the browser agree on; the runtime's local date would differ
  // around midnight and the date fields would not hydrate.
  const [dateFrom, setDateFrom] = useState<Date | undefined>(() =>
    parseIsoLocalDate(shiftIsoDateByDays(getBusinessTodayIso(), -30)),
  );
  const [dateTo, setDateTo] = useState<Date | undefined>(() =>
    parseIsoLocalDate(shiftIsoDateByDays(getBusinessTodayIso(), 14)),
  );
  const hasRange = dateFrom !== undefined && dateTo !== undefined;
  const [correctionEntry, setCorrectionEntry] = useState<TimeEntry | null | undefined>(undefined);
  // The corrected row (or the toolbar for an added time) shows the settle
  // spinner from the dialog's close until the live read carries the change.
  const settling = useBusyIds();

  const knownNames = useRef<ProfileNames>(new Map());
  const view = useLiveView<EntryWithProfile[]>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'time_correction_requests'],
    read: ({ signal }) =>
      readEntryHistory(
        { organizationId, dateFrom, dateTo, statusFilter, memberFilter },
        knownNames.current,
        signal,
      ),
    enabled: hasRange,
    // A filter change is a new view of the data: discard and read fresh.
    resetKey: [
      organizationId,
      statusFilter,
      memberFilter,
      dateFrom?.toISOString() ?? '',
      dateTo?.toISOString() ?? '',
    ].join('|'),
  });

  const entries = view.data ?? [];
  const loadError = (
    <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
      Die Einträge konnten nicht geladen werden.
    </SectionError>
  );

  return (
    <section className="space-y-4" aria-labelledby="entry-history-heading">
      <h2 id="entry-history-heading" className="font-semibold">
        Zeiteinträge
      </h2>
      {/* Filters */}
      <EntryHistoryFilters
        dateFrom={dateFrom}
        setDateFrom={setDateFrom}
        dateTo={dateTo}
        setDateTo={setDateTo}
        members={members}
        memberFilter={memberFilter}
        setMemberFilter={setMemberFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        onRefresh={view.refresh}
        hydrated={hydrated}
        onAddTime={() => setCorrectionEntry(null)}
        isSettlingNewEntry={settling.isBusy(NEW_ENTRY_ID)}
      />

      {/* Results: a failed refresh keeps the last rows below its retry. */}
      {view.isStale ? loadError : null}

      {!hasRange ? (
        <EmptyState
          icon={Clock}
          title="Zeitraum wählen"
          description="Wähle ein Von- und ein Bis-Datum, um die Einträge zu sehen."
        />
      ) : view.isLoading ? (
        <EntryHistorySkeleton />
      ) : view.data === undefined ? (
        loadError
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Keine Einträge gefunden"
          description="Für den ausgewählten Zeitraum gibt es keine Einträge. Wähle einen anderen Zeitraum."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'Eintrag' : 'Einträge'} gefunden
          </p>

          <EntryHistoryCards
            entries={entries}
            settling={settling}
            hydrated={hydrated}
            setCorrectionEntry={setCorrectionEntry}
          />

          <EntryHistoryTable
            entries={entries}
            settling={settling}
            hydrated={hydrated}
            setCorrectionEntry={setCorrectionEntry}
          />
        </>
      )}
      {correctionEntry !== undefined ? (
        <TimeCorrectionDialog
          key={correctionEntry?.id ?? 'add'}
          organizationId={organizationId}
          entry={correctionEntry ?? undefined}
          open
          hideTrigger
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setCorrectionEntry(undefined);
          }}
          onSubmitted={() => void settling.run(correctionEntry?.id ?? NEW_ENTRY_ID, view.refresh)}
        />
      ) : null}
    </section>
  );
}
