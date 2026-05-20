'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import { getProfilesByIds } from '@/lib/members/actions';
import type { TimeEntry, TimeEntryStatus } from '@/lib/time-tracking/types';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

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

export function EntryHistory({
  organizationId,
  members = []
}: EntryHistoryProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [entries, setEntries] = useState<EntryWithProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  // Helper to get member display name
  const getMemberDisplayName = (member: MemberInfo): string => {
    if (member.first_name || member.last_name) {
      return `${member.first_name || ''} ${member.last_name || ''}`.trim();
    }
    return member.email;
  };

  const fetchEntries = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setIsLoading(true);
    setError(null);
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

      if (result.success) {
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
        setEntries(
          entriesWithProfiles.sort((a, b) => {
            const dateA = a.reviewedAt
              ? new Date(a.reviewedAt).getTime()
              : new Date(a.createdAt).getTime();
            const dateB = b.reviewedAt
              ? new Date(b.reviewedAt).getTime()
              : new Date(b.createdAt).getTime();
            return dateB - dateA;
          })
        );
      } else {
        setError(result.error);
      }
    } catch (err) {
      console.error('Error fetching entries:', err);
      setError('Fehler beim Laden');
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, dateFrom, dateTo, statusFilter, memberFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Realtime: refetch when time entries change
  useRealtimeEvent('time_entries', fetchEntries);

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
        <div className="flex-1 min-w-[140px] space-y-1">
          <Label className="text-muted-foreground">Von</Label>
          <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Von" />
        </div>
        <div className="flex-1 min-w-[140px] space-y-1">
          <Label className="text-muted-foreground">Bis</Label>
          <DatePicker value={dateTo} onChange={setDateTo} placeholder="Bis" />
        </div>
        {members.length > 0 && (
          <div className="flex-1 min-w-[180px] space-y-1">
            <label className="text-sm font-medium text-muted-foreground">
              Mitarbeiter
            </label>
            <Select value={memberFilter} onValueChange={setMemberFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Mitarbeiter</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {getMemberDisplayName(member)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex-1 min-w-[140px] space-y-1">
          <label className="text-sm font-medium text-muted-foreground">
            Status
          </label>
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
        </div>
        <Button variant="outline" onClick={fetchEntries} disabled={isLoading}>
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
          />
          Laden
        </Button>
      </div>

      {/* Results */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
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
                    {entry.entryType === 'clock_in'
                      ? 'Einstempeln'
                      : 'Ausstempeln'}
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
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Zeitstempel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Manuell</TableHead>
                  <TableHead>Bearbeitet am</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">
                      {getDisplayName(entry)}
                    </TableCell>
                    <TableCell>
                      {entry.entryType === 'clock_in'
                        ? 'Einstempeln'
                        : 'Ausstempeln'}
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
