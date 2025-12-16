'use client';

import { useState, useTransition, useEffect, useMemo, useRef } from 'react';
import {
  Plus,
  Loader2,
  Calendar as CalendarIcon,
  Clock,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TimeInput } from '@/components/ui/time-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { useOrganization } from '@/components/organization/organization-context';
import { addManualEntry, getTimeEntries } from '@/lib/time-tracking/actions';
import { validateManualEntries } from '@/lib/time-tracking/validation';
import type {
  TimeEntryType,
  ManualEntryInput,
  TimeEntry
} from '@/lib/time-tracking/types';
import { useUserProfile } from '@/components/user/user-profile-context';
import { dispatchClockStatusRefresh } from '@/components/clock-fab';

type EntryMode = 'clock_in' | 'clock_out' | 'both';

type OrgMember = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
};

interface ManualEntryDialogProps {
  /** Optional callback when entries are successfully added */
  onSuccess?: () => void;
  /** Preselect a specific employee (for admins/managers) */
  preselectedUserId?: string;
  /** Pre-fill date */
  preselectedDate?: Date;
  /** Custom trigger button */
  trigger?: React.ReactNode;
}

export function ManualEntryDialog({
  onSuccess,
  preselectedUserId,
  preselectedDate,
  trigger
}: ManualEntryDialogProps) {
  const { activeOrgId, activeOrg } = useOrganization();
  const { profile } = useUserProfile();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Form state
  const initialIso =
    preselectedDate?.toISOString().split('T')[0] ||
    new Date().toISOString().split('T')[0];
  const [entryMode, setEntryMode] = useState<EntryMode>('both');
  const [dateIso, setDateIso] = useState(initialIso);
  const [dateDisplay, setDateDisplay] = useState(formatDisplayDate(initialIso));
  const [clockInTime, setClockInTime] = useState('09:00');
  const [clockOutTime, setClockOutTime] = useState('17:00');
  const [selectedUserId, setSelectedUserId] = useState(
    preselectedUserId || profile?.id || ''
  );
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState<Date>(
    preselectedDate || new Date()
  );

  // Members for admin/manager selection
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  // Validation and feedback
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [otherOrgBanner, setOtherOrgBanner] = useState<null | {
    title: string;
    message: string;
  }>(null);
  const [isBannerExiting, setIsBannerExiting] = useState(false);
  const bannerTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check if user is admin or manager
  const isAdminOrManager =
    activeOrg?.role === 'admin' || activeOrg?.role === 'manager';
  const currentUserId = profile?.id || null;

  // Fetch members when dialog opens (for admin/manager)
  useEffect(() => {
    if (!open || !isAdminOrManager || !activeOrgId) return;

    const fetchMembers = async () => {
      setIsLoadingMembers(true);
      try {
        const response = await fetch('/api/get-org-members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId: activeOrgId })
        });

        if (response.ok) {
          const data = await response.json();
          setMembers(data.members || []);
        }
      } catch (err) {
        console.error('Error fetching members:', err);
      } finally {
        setIsLoadingMembers(false);
      }
    };

    fetchMembers();
  }, [open, isAdminOrManager, activeOrgId]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setError(null);
      setSuccessMessage(null);
      setOtherOrgBanner(null);
      // Reset to default values
      setEntryMode('both');
      const resetIso =
        preselectedDate?.toISOString().split('T')[0] ||
        new Date().toISOString().split('T')[0];
      setDateIso(resetIso);
      setDateDisplay(formatDisplayDate(resetIso));
      setVisibleMonth(preselectedDate || new Date());
      setClockInTime('09:00');
      setClockOutTime('17:00');
      setSelectedUserId(
        preselectedUserId || (isAdminOrManager ? '' : currentUserId || '')
      );
    }
  }, [
    open,
    preselectedDate,
    preselectedUserId,
    isAdminOrManager,
    currentUserId
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setOtherOrgBanner(null);

    if (!activeOrgId) {
      setError('Keine Organisation ausgewählt.');
      return;
    }

    // Admin/Manager must explicitly select an employee
    if (isAdminOrManager && !selectedUserId) {
      setError('Bitte wähle einen Mitarbeiter aus.');
      return;
    }

    // Determine target user
    const targetUserId = isAdminOrManager ? selectedUserId : currentUserId;

    if (!targetUserId) {
      setError('Keine Benutzerinformation verfügbar.');
      return;
    }

    // Build entries array
    if (!dateIso) {
      setError('Bitte ein gültiges Datum wählen.');
      return;
    }

    const entries: ManualEntryInput[] = [];

    if (entryMode === 'clock_in' || entryMode === 'both') {
      const clockInTimestamp = new Date(
        `${dateIso}T${clockInTime}:00`
      ).toISOString();
      entries.push({ entryType: 'clock_in', timestamp: clockInTimestamp });
    }

    if (entryMode === 'clock_out' || entryMode === 'both') {
      const clockOutTimestamp = new Date(
        `${dateIso}T${clockOutTime}:00`
      ).toISOString();
      entries.push({ entryType: 'clock_out', timestamp: clockOutTimestamp });
    }

    // Client-side validation
    startTransition(async () => {
      try {
        // Fetch existing entries for the target user on that day
        const dayStart = new Date(dateIso);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dateIso);
        dayEnd.setHours(23, 59, 59, 999);

        const existingResult = await getTimeEntries({
          organizationId: activeOrgId,
          from: dayStart.toISOString(),
          to: dayEnd.toISOString(),
          userId: targetUserId
        });

        let existingEntries: TimeEntry[] = [];
        if (existingResult.success) {
          existingEntries = existingResult.entries;
        }

        // Validate the new entries
        const validationResult = validateManualEntries(
          existingEntries,
          entries
        );
        if (!validationResult.valid) {
          setError(validationResult.error || 'Validierung fehlgeschlagen.');
          return;
        }

        // Submit the entries
        const result = await addManualEntry({
          organizationId: activeOrgId,
          targetUserId,
          entries
        });

        if (result.success) {
          // Check if entries are pending or approved
          const isPending = result.entries.some((e) => e.status === 'pending');
          if (isPending) {
            setSuccessMessage('Antrag wurde zur Genehmigung eingereicht.');
          } else {
            setSuccessMessage('Eintrag erfolgreich erstellt!');
          }
          // Refresh FAB clock status in case this affects "currently working" state
          dispatchClockStatusRefresh();
          onSuccess?.();
          setTimeout(() => {
            setOpen(false);
          }, 1500);
        } else {
          if (
            result.error === 'working_in_other_org' &&
            'otherOrgName' in result &&
            typeof result.otherOrgName === 'string'
          ) {
            const isSelf = targetUserId === currentUserId;
            const title = isSelf
              ? 'Bereits in anderer Organisation eingestempelt'
              : 'Mitarbeiter ist bereits in anderer Organisation eingestempelt';
            const message = isSelf
              ? `Du bist aktuell in „${result.otherOrgName}“ eingestempelt. Bitte stemple dort zuerst aus, bevor du hier startest.`
              : `Der ausgewählte Mitarbeiter ist aktuell in „${result.otherOrgName}“ eingestempelt. Bitte zuerst dort ausstempeln, bevor hier eine offene Arbeitszeit gestartet wird.`;

            setOtherOrgBanner({ title, message });
            setError(message);

            if (bannerTimerRef.current) {
              clearTimeout(bannerTimerRef.current);
            }
            bannerTimerRef.current = setTimeout(() => {
              setIsBannerExiting(true);
              setTimeout(() => {
                setIsBannerExiting(false);
                setOtherOrgBanner(null);
              }, 150);
            }, 6000);
          } else {
            setError(getErrorMessage(result.error));
          }
        }
      } catch (err) {
        console.error('Error submitting manual entry:', err);
        setError('Ein unerwarteter Fehler ist aufgetreten.');
      }
    });
  };

  if (!activeOrgId || !activeOrg) {
    return null;
  }

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

  const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = buildMaskedDate(e.target.value);
    setDateDisplay(masked);
    const parsed = parseDisplayDate(masked);
    if (parsed) {
      const iso = toISODate(parsed);
      setDateIso(iso);
    } else {
      setDateIso('');
    }
  };

  return (
    <>
      {otherOrgBanner && (
        <div
          className={`fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg ${
            isBannerExiting ? 'animate-out' : 'animate-in'
          }`}
        >
          <div className="flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-800 shadow-lg ring-1 ring-red-200/50 dark:bg-red-950 dark:text-red-200 dark:ring-red-800/50">
            <AlertCircle className="size-5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">{otherOrgBanner.title}</p>
              <p className="mt-0.5 text-sm">{otherOrgBanner.message}</p>
            </div>
            <button
              onClick={() => {
                setIsBannerExiting(true);
                setTimeout(() => {
                  setIsBannerExiting(false);
                  setOtherOrgBanner(null);
                }, 150);
              }}
              className="shrink-0 rounded-md p-1 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
              aria-label="Banner schließen"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Manuelle Eintragung
            </Button>
          )}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manuelle Eintragung</DialogTitle>
            <DialogDescription>
              Füge einen manuellen Zeiteintrag hinzu. Dieser muss ggf. genehmigt
              werden.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Entry Type Selection */}
            <div className="space-y-2">
              <Label>Art des Eintrags</Label>
              <Select
                value={entryMode}
                onValueChange={(value) => setEntryMode(value as EntryMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">
                    Einstempeln & Ausstempeln
                  </SelectItem>
                  <SelectItem value="clock_in">Nur Einstempeln</SelectItem>
                  <SelectItem value="clock_out">Nur Ausstempeln</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Employee Selection (admin/manager only) */}
            {isAdminOrManager && (
              <div className="space-y-2">
                <Label>Mitarbeiter</Label>
                <Select
                  value={selectedUserId}
                  onValueChange={setSelectedUserId}
                  disabled={isLoadingMembers}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isLoadingMembers ? 'Lädt...' : 'Mitarbeiter auswählen'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>
                        {member.first_name || member.last_name
                          ? `${member.first_name || ''} ${
                              member.last_name || ''
                            }`
                          : member.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Date Selection */}
            <div className="space-y-2">
              <Label htmlFor="date">Datum</Label>
              <div className="relative flex-1">
                <Popover open={showCalendar} onOpenChange={setShowCalendar}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Datum auswählen"
                      className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-foreground"
                      onClick={() => setShowCalendar(true)}
                    >
                      <CalendarIcon className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="p-3 w-[320px]" align="start">
                    <SimpleCalendar
                      selectedDate={dateIso ? new Date(dateIso) : null}
                      visibleMonth={visibleMonth}
                      onMonthChange={setVisibleMonth}
                      onSelectDate={(selected) => {
                        if (selected) {
                          const iso = toISODate(selected);
                          setDateIso(iso);
                          setDateDisplay(formatDisplayDate(iso));
                          setVisibleMonth(selected);
                        }
                        setShowCalendar(false);
                      }}
                      onClear={() => {
                        setDateIso('');
                        setDateDisplay('');
                        setShowCalendar(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <Input
                  id="date"
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

            {/* Time Selection */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(entryMode === 'clock_in' || entryMode === 'both') && (
                <div className="space-y-2">
                  <Label htmlFor="clockInTime">Einstempeln</Label>
                  <div className="relative">
                    <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
                    <TimeInput
                      id="clockInTime"
                      value={clockInTime}
                      onChange={setClockInTime}
                      className="pl-10 pr-3"
                    />
                  </div>
                </div>
              )}
              {(entryMode === 'clock_out' || entryMode === 'both') && (
                <div className="space-y-2">
                  <Label htmlFor="clockOutTime">Ausstempeln</Label>
                  <div className="relative">
                    <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
                    <TimeInput
                      id="clockOutTime"
                      value={clockOutTime}
                      onChange={setClockOutTime}
                      className="pl-10 pr-3"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Error/Success Messages */}
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            {successMessage && (
              <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
                {successMessage}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Speichern...
                  </>
                ) : (
                  'Speichern'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type SimpleCalendarProps = {
  selectedDate: Date | null;
  visibleMonth: Date;
  onMonthChange: (date: Date) => void;
  onSelectDate: (date: Date | null) => void;
  onClear: () => void;
};

function SimpleCalendar({
  selectedDate,
  visibleMonth,
  onMonthChange,
  onSelectDate,
  onClear
}: SimpleCalendarProps) {
  const monthLabel = visibleMonth.toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric'
  });

  const days = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() =>
            onMonthChange(
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
            onMonthChange(
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
            selectedDate && day.toDateString() === selectedDate.toDateString();
          const isToday = new Date().toDateString() === day.toDateString();

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDate(day)}
              className={`rounded-md py-2 text-sm transition-colors ${
                isSelected
                  ? 'bg-brand-purple text-white'
                  : isToday
                  ? 'bg-brand-purple/10 text-foreground'
                  : 'bg-card text-foreground hover:bg-accent'
              }`}
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
          onClick={() => onSelectDate(new Date())}
        >
          Heute
        </Button>
        <Button type="button" variant="ghost" onClick={onClear}>
          Löschen
        </Button>
      </div>
    </div>
  );
}

function formatDisplayDate(iso: string): string {
  if (!iso) return 'TT.MM.JJJJ';
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return 'TT.MM.JJJJ';
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function parseDisplayDate(value: string): Date | null {
  if (!value) return null;
  // support DD.MM.YYYY
  const dotMatch = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) {
    const [, dd, mm, yyyy] = dotMatch;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d.getTime())) return d;
  }
  // support ISO YYYY-MM-DD
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildCalendarDays(month: Date): Array<Date | null> {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days: Array<Date | null> = [];
  const startDay = (first.getDay() + 6) % 7; // Monday start
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

/**
 * Translate error codes to German messages
 */
function getErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    not_authenticated: 'Du bist nicht angemeldet.',
    not_a_member: 'Du bist kein Mitglied dieser Organisation.',
    not_authorized: 'Du hast keine Berechtigung für diese Aktion.',
    target_not_a_member:
      'Der ausgewählte Mitarbeiter ist kein Mitglied dieser Organisation.',
    validation_failed: 'Die Validierung ist fehlgeschlagen.',
    insert_failed: 'Der Eintrag konnte nicht gespeichert werden.',
    unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
  };

  return messages[error] || error;
}
