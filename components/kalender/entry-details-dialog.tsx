'use client';

import { useState, useTransition, useRef, useMemo } from 'react';
import {
  Loader2,
  Pencil,
  Trash2,
  Check,
  X,
  Calendar as CalendarIcon,
  Clock,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TimeInput } from '@/components/ui/time-input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time-tracking/helpers';
import {
  updateEntry,
  deleteEntry,
  reviewEntry
} from '@/lib/time-tracking/actions';
import type { WorkSession } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';

interface EntryDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkSession;
  currentUserRole: OrgRole;
  currentUserId?: string;
  onRefresh: () => void;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
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

// Helper functions for date/time formatting
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

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
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

// DateTime Picker Component
interface DateTimePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  label: string;
}

function DateTimePicker({ value, onChange, label }: DateTimePickerProps) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(value);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // State for display values
  const [dateDisplay, setDateDisplay] = useState(
    formatDisplayDate(toISODate(value))
  );
  const [timeValue, setTimeValue] = useState(formatTime(value));

  // Build masked date string
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
      const newDate = new Date(value);
      newDate.setFullYear(parsed.getFullYear());
      newDate.setMonth(parsed.getMonth());
      newDate.setDate(parsed.getDate());
      onChange(newDate);
    }
  };

  const handleTimeChange = (newTime: string) => {
    setTimeValue(newTime);
    const [hours, minutes] = newTime.split(':').map(Number);
    if (!isNaN(hours) && !isNaN(minutes)) {
      const newDate = new Date(value);
      newDate.setHours(hours);
      newDate.setMinutes(minutes);
      onChange(newDate);
    }
  };

  const handleDateSelect = (selectedDate: Date) => {
    const newDate = new Date(value);
    newDate.setFullYear(selectedDate.getFullYear());
    newDate.setMonth(selectedDate.getMonth());
    newDate.setDate(selectedDate.getDate());
    onChange(newDate);
    setDateDisplay(formatDisplayDate(toISODate(selectedDate)));
    setShowCalendar(false);
  };

  const days = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const monthLabel = visibleMonth.toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        {/* Date Input */}
        <div className="relative flex-1">
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
                      day.toDateString() === value.toDateString();
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

        {/* Time Input */}
        <div className="relative w-28">
          <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
          <TimeInput
            value={timeValue}
            onChange={handleTimeChange}
            className="pl-10 pr-2"
          />
        </div>
      </div>
    </div>
  );
}

export function EntryDetailsDialog({
  open,
  onOpenChange,
  session,
  currentUserRole,
  currentUserId,
  onRefresh
}: EntryDetailsDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Handle orphan sessions (no clockIn)
  const isOrphan = session.isOrphan || !session.clockIn;

  // Initialize edited values based on what exists
  const [editedClockIn, setEditedClockIn] = useState<Date | null>(
    session.clockIn ? new Date(session.clockIn.timestamp) : null
  );
  const [editedClockOut, setEditedClockOut] = useState<Date | null>(
    session.clockOut ? new Date(session.clockOut.timestamp) : null
  );

  const clockInDate = session.clockIn
    ? new Date(session.clockIn.timestamp)
    : null;
  const clockOutDate = session.clockOut
    ? new Date(session.clockOut.timestamp)
    : null;

  // Determine if this is the user's own entry
  const entryUserId = session.clockIn?.userId || session.clockOut?.userId;
  const isOwnEntry = currentUserId && entryUserId === currentUserId;

  const canEdit = currentUserRole === 'admin' || currentUserRole === 'manager';

  // Managers can only approve/reject entries from other users (not their own)
  // Admins can approve/reject anyone's entries including their own
  const hasPendingEntry =
    session.clockIn?.status === 'pending' ||
    session.clockOut?.status === 'pending';
  const canApprove =
    hasPendingEntry &&
    (currentUserRole === 'admin' ||
      (currentUserRole === 'manager' && !isOwnEntry));

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditedClockIn(
      session.clockIn ? new Date(session.clockIn.timestamp) : null
    );
    setEditedClockOut(
      session.clockOut ? new Date(session.clockOut.timestamp) : null
    );
    setError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleSaveEdit = async () => {
    setError(null);
    setSuccessMessage(null);

    // Validate: clock out must be after clock in
    if (editedClockIn && editedClockOut) {
      if (editedClockOut.getTime() <= editedClockIn.getTime()) {
        setError('Die Ausstempelzeit muss nach der Einstempelzeit liegen.');
        return;
      }
    }

    startTransition(async () => {
      try {
        let requestCreated = false;

        // Determine if clock-in and clock-out are both being changed
        const clockInChanged =
          session.clockIn &&
          editedClockIn &&
          clockInDate &&
          editedClockIn.getTime() !== clockInDate.getTime();

        const clockOutChanged =
          session.clockOut &&
          editedClockOut &&
          clockOutDate &&
          editedClockOut.getTime() !== clockOutDate.getTime();

        // Helper function to update an entry and handle errors
        const performUpdate = async (
          entryId: string,
          timestamp: string
        ): Promise<boolean> => {
          const result = await updateEntry(entryId, { timestamp });
          if (!result.success) {
            if (result.error === 'overlapping_entries') {
              setError(
                'Diese Zeitspanne überschneidet sich mit einem anderen Eintrag.'
              );
            } else if (result.error === 'pending_request_exists') {
              setError(
                'Es gibt bereits einen ausstehenden Änderungsantrag für diesen Eintrag.'
              );
            } else {
              setError(result.error);
            }
            return false;
          }
          if ('request' in result) {
            requestCreated = true;
          }
          return true;
        };

        // When both are changing, we need to update in the correct order to avoid
        // validation errors. The server validates each update against the current DB state.
        // - If moving window LATER (new clock-in > old clock-in): update clock-out first
        // - If moving window EARLIER (new clock-in < old clock-in): update clock-in first
        // - If only one is changing, just update that one

        if (clockInChanged && clockOutChanged && clockInDate && clockOutDate) {
          // Both are changing - determine order based on direction
          const movingLater = editedClockIn!.getTime() > clockInDate.getTime();

          if (movingLater) {
            // Moving window later: update clock-out first to make room
            if (
              !(await performUpdate(
                session.clockOut!.id,
                editedClockOut!.toISOString()
              ))
            ) {
              return;
            }
            if (
              !(await performUpdate(
                session.clockIn!.id,
                editedClockIn!.toISOString()
              ))
            ) {
              return;
            }
          } else {
            // Moving window earlier: update clock-in first
            if (
              !(await performUpdate(
                session.clockIn!.id,
                editedClockIn!.toISOString()
              ))
            ) {
              return;
            }
            if (
              !(await performUpdate(
                session.clockOut!.id,
                editedClockOut!.toISOString()
              ))
            ) {
              return;
            }
          }
        } else {
          // Only one is changing (or neither) - update in standard order
          if (clockInChanged) {
            if (
              !(await performUpdate(
                session.clockIn!.id,
                editedClockIn!.toISOString()
              ))
            ) {
              return;
            }
          }

          if (clockOutChanged) {
            if (
              !(await performUpdate(
                session.clockOut!.id,
                editedClockOut!.toISOString()
              ))
            ) {
              return;
            }
          }
        }

        if (requestCreated) {
          // Show success message for change request
          setSuccessMessage(
            'Änderungsantrag wurde zur Genehmigung eingereicht.'
          );
          setIsEditing(false);
          // Close dialog after short delay
          setTimeout(() => {
            onOpenChange(false);
            onRefresh();
          }, 2000);
        } else {
          setIsEditing(false);
          onRefresh();
        }
      } catch (err) {
        console.error('Error updating entry:', err);
        setError('Ein Fehler ist aufgetreten.');
      }
    });
  };

  const handleDelete = async () => {
    setError(null);
    setSuccessMessage(null);

    startTransition(async () => {
      try {
        let requestCreated = false;

        // Check if this is a paired session (both clockIn and clockOut exist)
        const isPairedSession =
          session.clockIn && session.clockOut && !session.isOrphan;

        if (isPairedSession) {
          // For paired sessions, delete both entries in a single request
          // This ensures they are treated as a single unit for approval
          const result = await deleteEntry(
            session.clockIn!.id,
            session.clockOut!.id
          );
          if (!result.success) {
            if (result.error === 'pending_request_exists') {
              setError(
                'Es gibt bereits einen ausstehenden Löschantrag für diesen Eintrag.'
              );
            } else {
              setError(result.error);
            }
            return;
          }
          // Check if a request was created instead of direct delete
          if ('request' in result) {
            requestCreated = true;
          }
        } else {
          // For single entries (orphan clock_out or orphan clock_in), handle separately

          // Delete clock out if it exists and is an orphan
          if (session.clockOut && (!session.clockIn || session.isOrphan)) {
            const result = await deleteEntry(session.clockOut.id);
            if (!result.success) {
              if (result.error === 'pending_request_exists') {
                setError(
                  'Es gibt bereits einen ausstehenden Löschantrag für diesen Eintrag.'
                );
              } else {
                setError(result.error);
              }
              return;
            }
            if ('request' in result) {
              requestCreated = true;
            }
          }

          // Delete clock in if it exists and is an orphan
          if (session.clockIn && (!session.clockOut || session.isOrphan)) {
            const result = await deleteEntry(session.clockIn.id);
            if (!result.success) {
              if (result.error === 'pending_request_exists') {
                setError(
                  'Es gibt bereits einen ausstehenden Löschantrag für diesen Eintrag.'
                );
              } else {
                setError(result.error);
              }
              return;
            }
            if ('request' in result) {
              requestCreated = true;
            }
          }
        }

        if (requestCreated) {
          // Show success message for delete request
          setSuccessMessage('Löschantrag wurde zur Genehmigung eingereicht.');
          // Close dialog after short delay
          setTimeout(() => {
            onOpenChange(false);
            onRefresh();
          }, 2000);
        } else {
          onOpenChange(false);
          onRefresh();
        }
      } catch (err) {
        console.error('Error deleting entry:', err);
        setError('Ein Fehler ist aufgetreten.');
      }
    });
  };

  const handleApprove = async () => {
    startTransition(async () => {
      try {
        if (session.clockIn?.status === 'pending') {
          const result = await reviewEntry(session.clockIn.id, 'approved');
          if (!result.success) {
            setError(result.error);
            return;
          }
        }

        if (session.clockOut?.status === 'pending') {
          const result = await reviewEntry(session.clockOut.id, 'approved');
          if (!result.success) {
            setError(result.error);
            return;
          }
        }

        onRefresh();
      } catch (err) {
        console.error('Error approving entry:', err);
        setError('Ein Fehler ist aufgetreten.');
      }
    });
  };

  const handleReject = async () => {
    startTransition(async () => {
      try {
        if (session.clockIn?.status === 'pending') {
          const result = await reviewEntry(session.clockIn.id, 'rejected');
          if (!result.success) {
            setError(result.error);
            return;
          }
        }

        if (session.clockOut?.status === 'pending') {
          const result = await reviewEntry(session.clockOut.id, 'rejected');
          if (!result.success) {
            setError(result.error);
            return;
          }
        }

        onRefresh();
      } catch (err) {
        console.error('Error rejecting entry:', err);
        setError('Ein Fehler ist aufgetreten.');
      }
    });
  };

  // Check if this is a paired session (both clock in and clock out exist)
  const isPairedSession =
    session.clockIn && session.clockOut && !session.isOrphan;

  // Description text
  const getDescriptionText = () => {
    if (isOrphan) {
      // Orphan clock_in (from previous day)
      if (session.clockIn && !session.clockOut) {
        return 'Einzelner Einstempel-Eintrag (unvollständig)';
      }
      // Orphan clock_out
      return 'Einzelner Ausstempel-Eintrag (unvollständig)';
    }
    if (session.durationMinutes) {
      return `Arbeitszeit: ${formatDuration(session.durationMinutes)}`;
    }
    return 'Aktive Sitzung';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Eintrag Details</DialogTitle>
          <DialogDescription>{getDescriptionText()}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Clock In - only show if exists */}
          {session.clockIn && (
            <div className="space-y-2">
              {isEditing && editedClockIn ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <DateTimePicker
                      value={editedClockIn}
                      onChange={setEditedClockIn}
                      label="Einstempeln"
                    />
                  </div>
                  <span
                    className={cn(
                      'mt-7 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      STATUS_LABELS[session.clockIn.status].className
                    )}
                  >
                    {STATUS_LABELS[session.clockIn.status].label}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <Label>Einstempeln</Label>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        STATUS_LABELS[session.clockIn.status].className
                      )}
                    >
                      {STATUS_LABELS[session.clockIn.status].label}
                    </span>
                  </div>
                  <p className="text-sm">
                    {clockInDate ? formatDateTime(clockInDate) : '-'}
                  </p>
                </>
              )}
              {session.clockIn.isManual && !isEditing && (
                <p className="text-xs text-muted-foreground">
                  Manuell eingetragen
                </p>
              )}
            </div>
          )}

          {/* Clock Out - show if exists OR if it's an orphan */}
          {(session.clockOut || (isOrphan && session.clockOut)) && (
            <div className="space-y-2">
              {isEditing && session.clockOut && editedClockOut ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <DateTimePicker
                      value={editedClockOut}
                      onChange={setEditedClockOut}
                      label="Ausstempeln"
                    />
                  </div>
                  <span
                    className={cn(
                      'mt-7 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      STATUS_LABELS[session.clockOut.status].className
                    )}
                  >
                    {STATUS_LABELS[session.clockOut.status].label}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <Label>Ausstempeln</Label>
                    {session.clockOut && (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          STATUS_LABELS[session.clockOut.status].className
                        )}
                      >
                        {STATUS_LABELS[session.clockOut.status].label}
                      </span>
                    )}
                  </div>
                  <p className="text-sm">
                    {clockOutDate ? formatDateTime(clockOutDate) : 'Noch aktiv'}
                  </p>
                </>
              )}
              {session.clockOut?.isManual && !isEditing && (
                <p className="text-xs text-muted-foreground">
                  Manuell eingetragen
                </p>
              )}
            </div>
          )}

          {/* Show hint for open sessions without clock out */}
          {!session.clockOut && !isOrphan && !isEditing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Ausstempeln</Label>
              </div>
              <p className="text-sm text-muted-foreground">Noch aktiv</p>
            </div>
          )}

          {/* Success message */}
          {successMessage && (
            <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
              {successMessage}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {/* Approve/Reject buttons for pending entries */}
          {canApprove && !isEditing && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleApprove}
                disabled={isPending}
                className="gap-1"
              >
                <Check className="h-4 w-4" />
                Genehmigen
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReject}
                disabled={isPending}
                className="gap-1 text-destructive hover:text-destructive"
              >
                <X className="h-4 w-4" />
                Ablehnen
              </Button>
            </div>
          )}

          {/* Edit/Delete buttons */}
          {canEdit && !isEditing && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartEdit}
                disabled={isPending}
                className="gap-1"
              >
                <Pencil className="h-4 w-4" />
                Bearbeiten
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    className="gap-1 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Löschen
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {isPairedSession
                        ? 'Arbeitszeit löschen?'
                        : 'Eintrag löschen?'}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {isPairedSession
                        ? 'Diese Aktion kann nicht rückgängig gemacht werden. Die gesamte Arbeitszeit (Einstempeln und Ausstempeln) wird permanent gelöscht.'
                        : 'Diese Aktion kann nicht rückgängig gemacht werden. Dieser einzelne Eintrag wird permanent gelöscht.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Löschen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {/* Save/Cancel buttons when editing */}
          {isEditing && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEdit}
                disabled={isPending}
              >
                Abbrechen
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Speichern
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
