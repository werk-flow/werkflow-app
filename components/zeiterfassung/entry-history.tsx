'use client';

import { useState } from 'react';
import {
  RefreshCw,
  Clock,
  Pencil,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows, type SkeletonColumn } from '@/components/ui/skeleton-table';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import { getProfilesByIds } from '@/lib/members/actions';
import type { TimeEntry, TimeEntryStatus } from '@/lib/time-tracking/types';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { TimeCorrectionDialog } from './time-correction-dialog';

interface MemberInfo {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface EntryHistoryProps {
  organizationId: string;
  members?: MemberInfo[];
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

const STATUS_LABELS: Record<
  TimeEntryStatus,
  { label: string; className: string }
> = {
  approved: {
    label: 'Genehmigt',
    className: 'bg-green-500/20 text-green-700 dark:text-green-300'
  },
  pending: {
    label: 'Ausstehend',
    className: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300'
  },
  rejected: {
    label: 'Abgelehnt',
    className: 'bg-red-500/20 text-red-700 dark:text-red-300'
  },
  pending_delete: {
    label: 'Löschung ausstehend',
    className: 'bg-orange-500/20 text-orange-700 dark:text-orange-300'
  }
};

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getEntryTypeLabel(entry: TimeEntry): string {
  const activityLabels = {
    work: 'Arbeit',
    travel: 'Fahrt',
    break: 'Pause',
    standby: 'Bereitschaft',
    callout: 'Notdienst',
    internal_activity: 'Interne Tätigkeit',
  } as const;
  const direction = entry.entryType === 'clock_in' || entry.entryType === 'break_start'
    ? 'Start'
    : 'Ende';
  if (entry.activityKind) return `${activityLabels[entry.activityKind]} · ${direction}`;
  if (entry.entryType === 'break_start') return 'Pause starten';
  if (entry.entryType === 'break_end') return 'Pause beenden';
  return entry.entryType === 'clock_in' ? 'Einstempeln' : 'Ausstempeln';
}

export function EntryHistory({
  organizationId,
  members = []
}: EntryHistoryProps) {
  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [memberFilter, setMemberFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date;
  });
  const [dateTo, setDateTo] = useState<Date | undefined>(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return date;
  });
  const [correctionEntry, setCorrectionEntry] = useState<TimeEntry | null | undefined>(
    undefined
  );

  // Helper to get member display name
  const getMemberDisplayName = (member: MemberInfo): string => {
    if (member.first_name || member.last_name) {
      return `${member.first_name || ''} ${member.last_name || ''}`.trim();
    }
    return member.email;
  };

  const view = useLiveView<EntryWithProfile[]>({
    tables: ['time_entries', 'time_sessions', 'time_segments', 'time_correction_requests'],
    read: async (): Promise<LiveViewResult<EntryWithProfile[]>> => {
      // Without a complete date range there is nothing to read; keep whatever
      // was shown last.
      if (!dateFrom || !dateTo) return { ok: false };
      try {
        const fromDate = new Date(dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);

        const result = await getTimeEntries({
          organizationId,
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          status:
            statusFilter !== 'all'
              ? (statusFilter as TimeEntryStatus)
              : undefined,
          userId: memberFilter !== 'all' ? memberFilter : undefined
        });

        if (!result.success) return { ok: false, error: result.error };

        const userIds = [...new Set(result.entries.map((e) => e.userId))];
        const profileMap = await getProfilesByIds(userIds);

        // Merge profile data with entries
        const entriesWithProfiles: EntryWithProfile[] = result.entries.map(
          (entry) => ({
            ...entry,
            firstName: profileMap[entry.userId]?.firstName || null,
            lastName: profileMap[entry.userId]?.lastName || null
          })
        );

        // Sort by reviewedAt descending (most recent first), fallback to createdAt
        return {
          ok: true,
          data: entriesWithProfiles.sort((a, b) => {
            const dateA = a.reviewedAt
              ? new Date(a.reviewedAt).getTime()
              : new Date(a.createdAt).getTime();
            const dateB = b.reviewedAt
              ? new Date(b.reviewedAt).getTime()
              : new Date(b.createdAt).getTime();
            return dateB - dateA;
          })
        };
      } catch (err) {
        console.error('Error fetching entries:', err);
        return { ok: false, error: 'Fehler beim Laden' };
      }
    },
    // A filter change is a new view of the data: discard and read fresh.
    resetKey: [
      organizationId,
      statusFilter,
      memberFilter,
      dateFrom?.toISOString() ?? '',
      dateTo?.toISOString() ?? ''
    ].join('|')
  });

  const entries = view.data ?? [];
  const error = view.error;

  const getDisplayName = (entry: EntryWithProfile): string => {
    if (entry.firstName || entry.lastName) {
      return `${entry.firstName || ''} ${entry.lastName || ''}`.trim();
    }
    return 'Unbekannt';
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <Field label="Von" className="flex-1 min-w-[140px] gap-1">
          <DatePicker
            value={dateFrom}
            onChange={setDateFrom}
            placeholder="Von"
            ariaLabel="Von"
          />
        </Field>
        <Field label="Bis" className="flex-1 min-w-[140px] gap-1">
          <DatePicker
            value={dateTo}
            onChange={setDateTo}
            placeholder="Bis"
            ariaLabel="Bis"
          />
        </Field>
        {members.length > 0 && (
          <Field label="Mitarbeiter" className="flex-1 min-w-[180px] gap-1">
            <SearchableSelect
              ariaLabel="Nach Mitarbeiter filtern"
              options={[
                { value: 'all', label: 'Alle Mitarbeiter' },
                ...members.map((member) => ({
                  value: member.user_id,
                  label: getMemberDisplayName(member),
                })),
              ]}
              value={memberFilter}
              onChange={setMemberFilter}
              searchPlaceholder="Mitarbeiter suchen …"
              emptyMessage="Kein Mitarbeiter gefunden"
            />
          </Field>
        )}
        <Field label="Status" className="flex-1 min-w-[140px] gap-1">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="approved">Genehmigt</SelectItem>
              <SelectItem value="pending">Ausstehend</SelectItem>
              <SelectItem value="rejected">Abgelehnt</SelectItem>
              <SelectItem value="pending_delete">
                Löschung ausstehend
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Button
          variant="outline"
          onClick={() => void view.refresh()}
          disabled={view.isRefreshing}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${view.isRefreshing ? 'animate-spin' : ''}`}
          />
          Laden
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCorrectionEntry(null)}>
          <Plus className="mr-1.5 size-4" /> Zeit nachtragen
        </Button>
      </div>

      {/* Results */}
      <ErrorText>{error}</ErrorText>

      {view.isLoading ? (
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
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Clock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Keine Einträge gefunden</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Für den ausgewählten Zeitraum gibt es keine Einträge.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'Eintrag' : 'Einträge'}{' '}
            gefunden
          </p>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border bg-card p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {getEntryTypeLabel(entry)}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      STATUS_LABELS[entry.status].className
                    )}
                  >
                    {STATUS_LABELS[entry.status].label}
                  </span>
                </div>
                <p className="text-sm font-medium">{getDisplayName(entry)}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(entry.timestamp)}
                </p>
                {entry.isManual && (
                  <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                    Manuell
                  </span>
                )}
                {entry.pendingCorrectionRequestId ? (
                  <Button variant="ghost" size="sm" disabled>
                    <Clock className="mr-1.5 size-4" /> Korrektur in Prüfung
                  </Button>
                ) : entry.status === 'approved' ? (
                  <Button variant="ghost" size="sm" onClick={() => setCorrectionEntry(entry)}>
                    <Pencil className="mr-1.5 size-4" /> Korrigieren
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <EntryHistoryHeaderRow />
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">
                      {getDisplayName(entry)}
                    </TableCell>
                    <TableCell>
                      {getEntryTypeLabel(entry)}
                    </TableCell>
                    <TableCell>{formatDateTime(entry.timestamp)}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          STATUS_LABELS[entry.status].className
                        )}
                      >
                        {STATUS_LABELS[entry.status].label}
                      </span>
                    </TableCell>
                    <TableCell>{entry.isManual ? 'Ja' : 'Nein'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.reviewedAt
                        ? formatDateTime(entry.reviewedAt)
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.pendingCorrectionRequestId ? (
                        <Button variant="ghost" size="sm" disabled>
                          <Clock className="mr-1.5 size-4" /> Korrektur in Prüfung
                        </Button>
                      ) : entry.status === 'approved' ? (
                        <Button variant="ghost" size="sm" onClick={() => setCorrectionEntry(entry)}>
                          <Pencil className="mr-1.5 size-4" /> Korrigieren
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
          onSubmitted={() => void view.refresh()}
        />
      ) : null}
    </div>
  );
}
