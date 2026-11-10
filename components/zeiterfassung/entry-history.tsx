'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { EmptyState } from '@/components/ui/empty-state';
import { useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { ErrorText } from '@/components/ui/error-text';
import { ListRow } from '@/components/ui/list-row';
import { SectionError } from '@/components/ui/section-error';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows, type SkeletonColumn } from '@/components/ui/skeleton-table';
import { cn, formatBerlinDateTime } from '@/lib/utils';
import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import { readInBackground } from '@/lib/data/background-read-client';
import { Constants } from '@/lib/supabase/database.types';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { isEntryInClosedPeriod } from '@/lib/time-tracking/closed-period-dates';
import type { TimeEntry } from '@/lib/time-tracking/types';
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
import { EntryHistoryRowAction, type EntryHistoryRowActionProps } from './entry-history-row-action';
import { EntryHistoryActivities } from './entry-history-activities';
import {
  readActivityJobLabels,
  withProfileNames,
  type EntryHistoryData,
  type EntryHistoryQuery,
  type EntryWithProfile,
  type HistoryLayout,
  type KnownLabels,
} from './entry-history-read';
import { activityDays, intervalAnchor } from '@/lib/time-tracking/activity-intervals';
import { useWithdrawSubmission } from './use-withdraw-submission';

// Settle key for a correction that adds time (no row yet); entry ids are UUIDs.
const NEW_ENTRY_ID = 'new';

interface EntryHistoryProps {
  organizationId: string;
  members?: MemberListEntry[];
  /** Admin and Büro also see the Admins' own direct changes in the window. */
  showOwnEntryChanges?: boolean;
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

async function readEntryHistory(
  { layout, organizationId, dateFrom, dateTo, statusFilter, memberFilter, withOwnChanges }: EntryHistoryQuery,
  known: KnownLabels,
  signal: AbortSignal,
): Promise<LiveViewResult<EntryHistoryData>> {
  // The view reads only with a complete date range (its `enabled`).
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

    if (layout === 'activities') {
      // The pairing reads the clock once: a start of today runs, an earlier one lacks its end.
      const days = activityDays(result.entries, new Date());
      if (!(await readActivityJobLabels(organizationId, days, known.jobLabels, signal))) return { ok: false };
      const jobLabels = Object.fromEntries(known.jobLabels);
      return { ok: true, data: { entries: [], ownChanges: ownChanges.events, days, jobLabels } };
    }

    const entriesWithProfiles = await withProfileNames(result.entries, known.names, signal);
    if (!entriesWithProfiles) return { ok: false };
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
        days: [],
        jobLabels: {},
      },
    };
  } catch {
    // A transport failure; the server logs its own failures.
    return { ok: false };
  }
}

/** The activities layout shows its rows as cards at every width, so its skeleton does too. */
function EntryHistorySkeleton({ layout }: { layout: HistoryLayout }) {
  return (
    <>
      <SkeletonList count={5} className={layout === 'entries' ? 'md:hidden' : ''}>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
        </div>
      </SkeletonList>
      {layout === 'entries' ? (
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
      ) : null}
    </>
  );
}

type EntryHistoryRowsProps = Omit<EntryHistoryRowActionProps, 'entry' | 'align'> & {
  entries: EntryWithProfile[];
};

/* Mobile cards */
function EntryHistoryCards({ entries, ...actionProps }: EntryHistoryRowsProps) {
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
          <EntryHistoryRowAction entry={entry} {...actionProps} />
        </ListRow>
      ))}
    </div>
  );
}

/* Desktop table */
function EntryHistoryTable({ entries, ...actionProps }: EntryHistoryRowsProps) {
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
                <EntryHistoryRowAction entry={entry} {...actionProps} align="end" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Why „Korrigieren“ is missing on the rows of a closed month. */
function ClosedMonthNote() {
  return (
    <p className="text-sm text-muted-foreground">
      Einträge in abgeschlossenen Monaten lassen sich nicht korrigieren. Ein Admin muss die Periode zuerst
      wieder öffnen.
    </p>
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
        <ClosedMonthNote />
      )}
      <EntryHistoryCards {...props} />
      <EntryHistoryTable {...props} />
    </>
  );
}

type EntryHistoryFoundProps = Omit<EntryHistoryRowsProps, 'entries'> & {
  layout: HistoryLayout;
  data: EntryHistoryData;
};

/** The found time in the viewer's layout, or that the range holds none. */
function EntryHistoryFound({ layout, data, ...actionProps }: EntryHistoryFoundProps) {
  if (layout === 'entries' ? data.entries.length === 0 : data.days.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="Keine Einträge gefunden"
        description="Für den ausgewählten Zeitraum gibt es keine Einträge. Wähle einen anderen Zeitraum."
      />
    );
  }
  if (layout === 'entries') return <EntryHistoryResults entries={data.entries} {...actionProps} />;
  const inClosedMonth = data.days.some((day) =>
    day.intervals.some((interval) =>
      isEntryInClosedPeriod(intervalAnchor(interval), actionProps.closedPeriods),
    ),
  );
  return (
    <>
      {inClosedMonth && <ClosedMonthNote />}
      <EntryHistoryActivities days={data.days} jobLabels={data.jobLabels} {...actionProps} />
    </>
  );
}

type EntryHistoryRegionProps = Omit<EntryHistoryRowsProps, 'entries'> & {
  layout: HistoryLayout;
  hasRange: boolean;
  view: LiveViewState<EntryHistoryData>;
  /** The last read failed: the rows stay, marked stale and inert below its retry. */
  isStale: boolean;
  members: MemberListEntry[];
};

/** Results: a failed refresh keeps the last rows, marked stale and inert below its retry. */
function EntryHistoryRegion({
  layout,
  hasRange,
  view,
  isStale,
  members,
  ...actionProps
}: EntryHistoryRegionProps) {
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
    <EntryHistorySkeleton layout={layout} />
  ) : view.data === undefined ? (
    loadError
  ) : (
    <StaleRegion stale={isStale} onRetry={view.refresh} className="space-y-4">
      <EntryHistoryFound layout={layout} data={view.data} {...actionProps} />
      <OwnEntryChanges events={view.data.ownChanges} members={members} />
    </StaleRegion>
  );
}

/**
 * The viewer, for the actions on their own time. An employee adds forgotten
 * time through the page header's one „Zeit nachtragen“; the office adds time
 * for anyone through a correction here.
 */
function useHistoryViewer(): { currentUserId: string | null; addsTimeHere: boolean; layout: HistoryLayout } {
  const { profile } = useUserProfile();
  const { activeOrg } = useOrganization();
  // Fail closed until the organization loaded: only Admin and Büro add time here.
  return {
    currentUserId: profile?.id ?? null,
    addsTimeHere: activeOrg ? activeOrg.role !== 'employee' : false,
    // The server reads an employee's own time only; the office keeps every entry's detail.
    layout: activeOrg?.role === 'employee' ? 'activities' : 'entries',
  };
}

/** The live read of the history for the chosen filters. */
function useEntryHistoryView(query: EntryHistoryQuery, hasRange: boolean): LiveViewState<EntryHistoryData> {
  const known = useRef<KnownLabels>({ names: new Map(), jobLabels: new Map() });
  const { layout, organizationId, statusFilter, memberFilter, dateFrom, dateTo } = query;
  return useLiveView<EntryHistoryData>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'time_correction_requests'],
    read: ({ signal }) => readEntryHistory(query, known.current, signal),
    enabled: hasRange,
    // A filter change is a new view of the data: discard and read fresh.
    resetKey: [
      layout,
      organizationId,
      statusFilter,
      memberFilter,
      dateFrom?.toISOString() ?? '',
      dateTo?.toISOString() ?? '',
    ].join('|'),
  });
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
  const { currentUserId, addsTimeHere, layout } = useHistoryViewer();
  const view = useEntryHistoryView(
    {
      layout,
      organizationId,
      dateFrom,
      dateTo,
      statusFilter,
      memberFilter,
      withOwnChanges: showOwnEntryChanges,
    },
    hasRange,
  );

  const { withdraw, withdrawError } = useWithdrawSubmission(settling, view.refresh);

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
        onAddTime={addsTimeHere ? () => setCorrectionEntry(null) : undefined}
        isSettlingNewEntry={settling.isBusy(NEW_ENTRY_ID)}
      />

      <EntryHistoryRegion
        layout={layout}
        hasRange={hasRange}
        view={view}
        isStale={view.isStale}
        members={members}
        settling={settling}
        hydrated={hydrated}
        setCorrectionEntry={setCorrectionEntry}
        closedPeriods={closedPeriods}
        currentUserId={currentUserId}
        withdraw={withdraw}
      />
      <ErrorText>{withdrawError}</ErrorText>
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
