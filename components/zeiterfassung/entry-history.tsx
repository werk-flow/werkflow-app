'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  RefreshCw,
  Clock,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import type { TimeEntry, TimeEntryStatus } from '@/lib/time-tracking/types';

interface EntryHistoryProps {
  organizationId: string;
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

// Date picker helper functions
function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function parseDisplayDate(value: string): Date | null {
  if (!value) return null;
  const dotMatch = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) {
    const [, dd, mm, yyyy] = dotMatch;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function buildCalendarDays(month: Date): Array<Date | null> {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days: Array<Date | null> = [];
  const startDay = (first.getDay() + 6) % 7;
  for (let i = 0; i < startDay; i++) {
    days.push(null);
  }
  const lastDay = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0
  ).getDate();
  for (let d = 1; d <= lastDay; d++) {
    days.push(new Date(month.getFullYear(), month.getMonth(), d));
  }
  while (days.length % 7 !== 0) {
    days.push(null);
  }
  return days;
}

// DatePicker Component
interface DatePickerProps {
  value: string; // ISO date string YYYY-MM-DD
  onChange: (value: string) => void;
  label: string;
}

function DatePicker({ value, onChange, label }: DatePickerProps) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(
    value ? new Date(`${value}T00:00:00`) : new Date()
  );
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [dateDisplay, setDateDisplay] = useState(formatDisplayDate(value));

  // Update display when value changes externally
  useEffect(() => {
    setDateDisplay(formatDisplayDate(value));
  }, [value]);

  const buildMaskedDate = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    let masked = digits;
    if (digits.length > 2) {
      masked = `${digits.slice(0, 2)}.${digits.slice(2)}`;
    }
    if (digits.length > 4) {
      masked = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
    }
    return masked;
  };

  const selectSegment = (segment: 'day' | 'month' | 'year') => {
    const input = dateInputRef.current;
    if (!input) return;
    const ranges: Record<typeof segment, [number, number]> = {
      day: [0, 2],
      month: [3, 5],
      year: [6, 10]
    };
    const [start, end] = ranges[segment];
    input.setSelectionRange(start, end);
  };

  const getSegmentFromPosition = (
    pos: number | null
  ): 'day' | 'month' | 'year' => {
    if (pos === null || pos <= 2) return 'day';
    if (pos <= 5) return 'month';
    return 'year';
  };

  const scheduleSegmentSelect = (segment: 'day' | 'month' | 'year') => {
    requestAnimationFrame(() => selectSegment(segment));
  };

  const handleDateFocus = () => {
    const input = dateInputRef.current;
    const pos = input?.selectionStart ?? 0;
    scheduleSegmentSelect(getSegmentFromPosition(pos));
  };

  const handleDateClick = (e: React.MouseEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    setTimeout(() => {
      const pos = input.selectionStart ?? 0;
      scheduleSegmentSelect(getSegmentFromPosition(pos));
    }, 0);
  };

  const handleDateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowed = [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'Tab',
      'Home',
      'End'
    ];
    if (allowed.includes(e.key)) return;
    if (!/^\d$/.test(e.key)) {
      e.preventDefault();
    }
  };

  const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = buildMaskedDate(e.target.value);
    setDateDisplay(masked);
    const parsed = parseDisplayDate(masked);
    if (parsed) {
      onChange(toISODate(parsed));
    }
  };

  const handleDateSelect = (selectedDate: Date) => {
    const iso = toISODate(selectedDate);
    onChange(iso);
    setDateDisplay(formatDisplayDate(iso));
    setShowCalendar(false);
  };

  const days = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const monthLabel = visibleMonth.toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric'
  });

  const selectedDate = value ? new Date(`${value}T00:00:00`) : null;

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Popover open={showCalendar} onOpenChange={setShowCalendar}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Datum auswählen"
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-foreground/80 hover:text-foreground"
              onClick={() => setShowCalendar(true)}
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-3" align="start">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setVisibleMonth(
                      new Date(
                        visibleMonth.getFullYear(),
                        visibleMonth.getMonth() - 1,
                        1
                      )
                    )
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="font-medium capitalize">{monthLabel}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setVisibleMonth(
                      new Date(
                        visibleMonth.getFullYear(),
                        visibleMonth.getMonth() + 1,
                        1
                      )
                    )
                  }
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
                {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {days.map((day, idx) => {
                  if (!day) {
                    return <div key={idx} />;
                  }
                  const isSelected =
                    selectedDate &&
                    day.toDateString() === selectedDate.toDateString();
                  const isToday =
                    new Date().toDateString() === day.toDateString();

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => handleDateSelect(day)}
                      className={cn(
                        'rounded-md py-2 text-sm transition-colors',
                        isSelected
                          ? 'bg-brand-purple text-white'
                          : isToday
                          ? 'bg-brand-purple/10 text-foreground'
                          : 'bg-card text-foreground hover:bg-accent'
                      )}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDateSelect(new Date())}
                >
                  Heute
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Input
          ref={dateInputRef}
          type="text"
          inputMode="numeric"
          value={dateDisplay}
          placeholder="TT.MM.JJJJ"
          onFocus={handleDateFocus}
          onClick={handleDateClick}
          onKeyDown={handleDateKeyDown}
          onChange={handleDateInputChange}
          className="pl-10 pr-3"
        />
      </div>
    </div>
  );
}

export function EntryHistory({ organizationId }: EntryHistoryProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [entries, setEntries] = useState<EntryWithProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30); // Last 30 days
    return toISODate(date);
  });
  const [dateTo, setDateTo] = useState(() => {
    return toISODate(new Date());
  });

  const fetchEntries = useCallback(async () => {
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
          statusFilter !== 'all' ? (statusFilter as TimeEntryStatus) : undefined
      });

      if (result.success) {
        // Fetch profiles for all unique user IDs
        const userIds = [...new Set(result.entries.map((e) => e.userId))];

        // Fetch profiles via API
        const profilesResponse = await fetch('/api/get-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds })
        });

        let profileMap: Record<
          string,
          { firstName: string | null; lastName: string | null }
        > = {};

        if (profilesResponse.ok) {
          const profilesData = await profilesResponse.json();
          profileMap = profilesData.profiles || {};
        }

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
  }, [organizationId, dateFrom, dateTo, statusFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const getDisplayName = (entry: EntryWithProfile): string => {
    if (entry.firstName || entry.lastName) {
      return `${entry.firstName || ''} ${entry.lastName || ''}`.trim();
    }
    return 'Unbekannt';
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <DatePicker value={dateFrom} onChange={setDateFrom} label="Von" />
        </div>
        <div className="flex-1">
          <DatePicker value={dateTo} onChange={setDateTo} label="Bis" />
        </div>
        <div className="flex-1 space-y-1">
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
