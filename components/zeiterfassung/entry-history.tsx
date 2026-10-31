'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { EmptyState } from '@/components/ui/empty-state';
import { useRef, useState } from 'react';
import { Clock, Lock, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlinePending } from '@/components/ui/inline-pending';
import { ListRow } from '@/components/ui/list-row';
import { SectionError } from '@/components/ui/section-error';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows, type SkeletonColumn } from '@/components/ui/skeleton-table';
import { cn, formatBerlinDateTime } from '@/lib/utils';
import { readInBackground } from '@/lib/data/background-read-client';
import { Constants } from '@/lib/supabase/database.types';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { isEntryInClosedPeriod, type ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';
import type { TimeEntry, TimeEntryAuditEvent } from '@/lib/time-tracking/types';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useHydrated } from '@/hooks/use-hydrated';
import { useLiveView, type LiveViewResult, type LiveViewState } from '@/hooks/use-live-view';
import { TimeCorrectionDialog } from './time-correction-dialog';
import { useClosedTimePeriods } from './use-closed-time-periods';
import type { MemberListEntry } from '@/lib/members/profile-name';
import { EntryHistoryFilters } from './entry-history-filters';
import { OwnEntryChanges } from './own-entry-changes';
import { STATUS_LABELS, getEntryTypeLabel } from './entry-history-labels';
import { historyRange, useHistoryDates } from './entry-history-range';

// Settle key for a correction that adds time (no row yet); entry ids are UUIDs.
const NEW_ENTRY_ID = 'new';

interface EntryHistoryProps {
  organizationId: string;
  members?: MemberListEntry[];
  /** Admin and Büro also see the Admins' own direct changes in the window. */
  showOwnEntryChanges?: boolean;
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
  /** Also read the Admins' own direct changes of the window (Admin and Büro). */
  withOwnChanges: boolean;
};

type EntryHistoryData = { entries: EntryWithProfile[]; ownChanges: TimeEntryAuditEvent[] };

type ProfileNames = Map<string, { firstName: string | null; lastName: string | null }>;

/**
 * `knownNames` keeps the names this view already read: a live refresh after
 * an approval reads the entries only, and names follow in a second request
 * only for people the view has not shown yet.
 */
async function readEntryHistory(
  { organizationId, dateFrom, dateTo, statusFilter, memberFilter, withOwnChanges }: EntryHistoryQuery,
  knownNames: ProfileNames,
  signal: AbortSignal,
): Promise<LiveViewResult<EntryHistoryData>> {
  // The view reads only with a complete date range (`enabled` below).
  if (!dateFrom || !dateTo) return { ok: false };
  try {
    const range = historyRange(dateFrom, dateTo);
    const member = memberFilter !== 'all' ? { userId: memberFilter } : {};
    const [result, ownChanges] = await Promise.all([
      readInBackground(
        'time-entries',
        {
          organizationId,
          ...range,
          ...(statusFilter !== 'all'
            ? {
                status: constrainedValue(
                  Constants.public.Enums.time_entry_status,
                  statusFilter,
                  'time entry status filter',
                ),
              }
            : {}),
          ...member,
        },
        signal,
      ),
      withOwnChanges
        ? readInBackground('time-entry-audit-events', { organizationId, ...range, ...member }, signal)
        : { success: true as const, events: [] },
    ]);

    if (!result.success || !ownChanges.success) return { ok: false };

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
      data: {
        entries: entriesWithProfiles.sort((a, b) => {
          const dateA = a.reviewedAt ? new Date(a.reviewedAt).getTime() : new Date(a.createdAt).getTime();
          const dateB = b.reviewedAt ? new Date(b.reviewedAt).getTime() : new Date(b.createdAt).getTime();
          return dateB - dateA;
        }),
        ownChanges: ownChanges.events,
      },
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
  closedPeriods: readonly ClosedTimePeriod[];
};

/** In place of „Korrigieren“ on an entry of a closed month: the server would refuse the correction. */
function ClosedMonthLabel({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}>
      <Lock className="size-4" aria-hidden="true" /> Monat abgeschlossen
    </span>
  );
}

/* Mobile cards */
function EntryHistoryCards({
  entries,
  settling,
  hydrated,
  setCorrectionEntry,
  closedPeriods,
}: EntryHistoryRowsProps) {
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
          <p className="text-sm text-muted-foreground">{formatBerlinDateTime(entry.timestamp)}</p>
          {entry.isManual && (
            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs">Manuell</span>
          )}
          {settling.isBusy(entry.id) ? (
            <InlinePending active />
          ) : entry.pendingCorrectionRequestId ? (
            <Button variant="ghost" size="sm" disabled>
              <Clock className="mr-1.5 size-4" /> Korrektur in Prüfung
            </Button>
          ) : entry.status === 'approved' && isEntryInClosedPeriod(entry, closedPeriods) ? (
            <ClosedMonthLabel />
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
function EntryHistoryTable({
  entries,
  settling,
  hydrated,
  setCorrectionEntry,
  closedPeriods,
}: EntryHistoryRowsProps) {
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
              <TableCell>{formatBerlinDateTime(entry.timestamp)}</TableCell>
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
                {entry.reviewedAt ? formatBerlinDateTime(entry.reviewedAt) : '-'}
              </TableCell>
              <TableCell className="text-right">
                {settling.isBusy(entry.id) ? (
                  <InlinePending active className="ml-auto" />
                ) : entry.pendingCorrectionRequestId ? (
                  <Button variant="ghost" size="sm" disabled>
                    <Clock className="mr-1.5 size-4" /> Korrektur in Prüfung
                  </Button>
                ) : entry.status === 'approved' && isEntryInClosedPeriod(entry, closedPeriods) ? (
                  <ClosedMonthLabel className="justify-end" />
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

/** The found entries: their count, the closed-month note, and the cards or the table. */
function EntryHistoryResults(props: EntryHistoryRowsProps) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {props.entries.length} {props.entries.length === 1 ? 'Eintrag' : 'Einträge'} gefunden
      </p>
      {props.entries.some((entry) => isEntryInClosedPeriod(entry, props.closedPeriods)) && (
        <p className="text-sm text-muted-foreground">
          Einträge in abgeschlossenen Monaten lassen sich nicht korrigieren. Ein Admin muss die Periode zuerst
          wieder öffnen.
        </p>
      )}
      <EntryHistoryCards {...props} />
      <EntryHistoryTable {...props} />
    </>
  );
}

type EntryHistoryRegionProps = Omit<EntryHistoryRowsProps, 'entries'> & {
  hasRange: boolean;
  view: LiveViewState<EntryHistoryData>;
  members: MemberListEntry[];
};

/** Results: a failed refresh keeps the last rows, marked stale and inert below its retry. */
function EntryHistoryRegion({
  hasRange,
  view,
  members,
  settling,
  hydrated,
  setCorrectionEntry,
  closedPeriods,
}: EntryHistoryRegionProps) {
  const entries = view.data?.entries ?? [];
  const loadError = (
    <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
      Die Einträge konnten nicht geladen werden.
    </SectionError>
  );

  return !hasRange ? (
    <EmptyState
      icon={Clock}
      title="Zeitraum wählen"
      description="Wähle ein Von- und ein Bis-Datum, um die Einträge zu sehen."
    />
  ) : view.isLoading ? (
    <EntryHistorySkeleton />
  ) : view.data === undefined ? (
    loadError
  ) : (
    <StaleRegion stale={view.isStale} onRetry={view.refresh} className="space-y-4">
      {entries.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Keine Einträge gefunden"
          description="Für den ausgewählten Zeitraum gibt es keine Einträge. Wähle einen anderen Zeitraum."
        />
      ) : (
        <EntryHistoryResults
          entries={entries}
          settling={settling}
          hydrated={hydrated}
          setCorrectionEntry={setCorrectionEntry}
          closedPeriods={closedPeriods}
        />
      )}
      <OwnEntryChanges events={view.data.ownChanges} members={members} />
    </StaleRegion>
  );
}

export function EntryHistory({
  organizationId,
  members = [],
  showOwnEntryChanges = false,
}: EntryHistoryProps) {
  const hydrated = useHydrated();
  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [memberFilter, setMemberFilter] = useState<string>('all');
  const { dateFrom, setDateFrom, dateTo, setDateTo } = useHistoryDates();
  const hasRange = dateFrom !== undefined && dateTo !== undefined;
  const [correctionEntry, setCorrectionEntry] = useState<TimeEntry | null | undefined>(undefined);
  // The corrected row (or the toolbar for an added time) shows the settle
  // spinner from the dialog's close until the live read carries the change.
  const settling = useBusyIds();
  const closedPeriods = useClosedTimePeriods(organizationId);

  const knownNames = useRef<ProfileNames>(new Map());
  const view = useLiveView<EntryHistoryData>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'time_correction_requests'],
    read: ({ signal }) =>
      readEntryHistory(
        { organizationId, dateFrom, dateTo, statusFilter, memberFilter, withOwnChanges: showOwnEntryChanges },
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

      <EntryHistoryRegion
        hasRange={hasRange}
        view={view}
        members={members}
        settling={settling}
        hydrated={hydrated}
        setCorrectionEntry={setCorrectionEntry}
        closedPeriods={closedPeriods}
      />
      {correctionEntry !== undefined ? (
        <TimeCorrectionDialog
          key={correctionEntry?.id ?? 'add'}
          organizationId={organizationId}
          entry={correctionEntry ?? undefined}
          open
          hideTrigger
          closedPeriods={closedPeriods}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setCorrectionEntry(undefined);
          }}
          onSubmitted={() => void settling.run(correctionEntry?.id ?? NEW_ENTRY_ID, view.refresh)}
        />
      ) : null}
    </section>
  );
}
