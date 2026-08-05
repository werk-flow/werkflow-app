'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  addWorkSchedule,
  deleteWorkSchedule,
  updateWorkSchedule,
} from '@/lib/personnel/actions';
import { getEffectiveCondition, type EmploymentCondition } from '@/lib/personnel/types';
import {
  getEffectiveSchedule,
  getWeeklyScheduleMinutes,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
  type WorkSchedule,
} from '@/lib/personnel/schedule';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { cn, toLocalDateString } from '@/lib/utils';

const SCHEDULE_ERROR_MESSAGES: Record<string, string> = {
  invalid_valid_from: 'Bitte gib ein gültiges Datum an.',
  invalid_day_minutes:
    'Bitte gib für jeden Wochentag eine Stundenzahl zwischen 0 und 24 an.',
  duplicate_valid_from:
    'Für dieses Datum existiert bereits ein Wochenplan. Bearbeite die bestehende Version.',
  not_authorized: 'Du bist nicht berechtigt, Arbeitszeitmodelle zu ändern.',
  record_not_found: 'Die Personalakte wurde nicht gefunden.',
  schedule_not_found: 'Der Wochenplan wurde nicht gefunden.',
};

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatScheduleDays(schedule: WorkSchedule): string {
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const minutes = schedule.dayMinutes[i];
    if (minutes > 0) {
      parts.push(`${WEEKDAY_SHORT_LABELS[i]} ${formatHoursShort(minutes)}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : 'Keine Arbeitstage';
}

function formatHoursShort(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.`;
}

type DialogState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; schedule: WorkSchedule };

interface WorkScheduleSectionProps {
  recordId: string;
  schedules: WorkSchedule[];
  conditions: EmploymentCondition[];
  canEdit: boolean;
}

export function WorkScheduleSection({
  recordId,
  schedules,
  conditions,
  canEdit,
}: WorkScheduleSectionProps) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>({ mode: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<WorkSchedule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const todayIso = toLocalDateString(new Date());
  const current = getEffectiveSchedule(schedules, todayIso);
  const sorted = [...schedules].sort((a, b) =>
    b.validFrom.localeCompare(a.validFrom)
  );

  // Non-blocking consistency hint: the schedule wins for targets, the
  // condition's weekly hours stay contractual metadata (owner decision).
  const currentCondition = getEffectiveCondition(conditions);
  const currentWeeklyMinutes = current ? getWeeklyScheduleMinutes(current) : null;
  const conditionWeeklyMinutes =
    currentCondition?.weeklyHours != null
      ? Math.round(currentCondition.weeklyHours * 60)
      : null;
  const showMismatchHint =
    currentWeeklyMinutes !== null &&
    conditionWeeklyMinutes !== null &&
    currentWeeklyMinutes !== conditionWeeklyMinutes;

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    const result = await deleteWorkSchedule(deleteTarget.id);
    setIsDeleting(false);
    if (result.success) {
      setDeleteTarget(null);
      router.refresh();
    } else {
      setDeleteError(
        SCHEDULE_ERROR_MESSAGES[result.error ?? ''] ??
          'Der Wochenplan konnte nicht gelöscht werden.'
      );
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarClock className="size-4" />
          Arbeitszeitmodell
        </h3>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setDialogState({ mode: 'add' })}
          >
            <Plus className="size-3.5" />
            Wochenplan hinzufügen
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          Kein Arbeitszeitmodell hinterlegt. Ohne Wochenplan gilt für
          Zeitziele das Standardziel von 8 Stunden pro Tag – sichtbar als
          Hinweis, nicht als echte Vorgabe.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sorted.map((schedule) => {
            const isCurrent = current?.id === schedule.id;
            const isScheduled = schedule.validFrom > todayIso;
            return (
              <li
                key={schedule.id}
                className={cn(
                  'rounded-md border px-3 py-2.5',
                  isCurrent && 'border-primary/40 bg-primary/5'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {formatDuration(getWeeklyScheduleMinutes(schedule))} pro
                        Woche
                      </span>
                      {isCurrent && (
                        <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                          Aktuell
                        </span>
                      )}
                      {isScheduled && (
                        <span className="inline-flex items-center rounded-full bg-brand-purple/15 px-2 py-0.5 text-xs font-medium text-brand-purple-dark dark:text-brand-purple-light">
                          Geplant
                        </span>
                      )}
                      {!isCurrent && !isScheduled && (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Früher
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Gültig ab {formatDate(schedule.validFrom)} ·{' '}
                      {formatScheduleDays(schedule)}
                    </p>
                    {schedule.note && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {schedule.note}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          aria-label={`Aktionen für Wochenplan ab ${formatDate(schedule.validFrom)}`}
                        >
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setDialogState({ mode: 'edit', schedule })}
                        >
                          <Pencil className="size-4" />
                          Bearbeiten
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(schedule);
                          }}
                        >
                          <Trash2 className="size-4" />
                          Löschen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showMismatchHint && (
        <p className="mt-2 text-xs text-muted-foreground">
          Hinweis: Der aktuelle Wochenplan (
          {formatDuration(currentWeeklyMinutes!)}) weicht von den
          Wochenstunden der Beschäftigung (
          {formatDuration(conditionWeeklyMinutes!)}) ab. Für Zeitziele gilt der
          Wochenplan.
        </p>
      )}

      {dialogState.mode !== 'closed' && (
        <ScheduleDialog
          recordId={recordId}
          schedule={dialogState.mode === 'edit' ? dialogState.schedule : null}
          onClose={(saved) => {
            setDialogState({ mode: 'closed' });
            if (saved) router.refresh();
          }}
        />
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wochenplan löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Wochenplan ab{' '}
              {deleteTarget ? formatDate(deleteTarget.validFrom) : ''} wird
              entfernt. Die Löschung wird im Verlauf nachvollziehbar
              festgehalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird gelöscht...
                </>
              ) : (
                'Löschen'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Default for a new schedule: the common full-time week; the office adjusts.
const DEFAULT_DAY_HOURS = ['8', '8', '8', '8', '8', '0', '0'];

function ScheduleDialog({
  recordId,
  schedule,
  onClose,
}: {
  recordId: string;
  schedule: WorkSchedule | null;
  onClose: (saved: boolean) => void;
}) {
  const [validFrom, setValidFrom] = useState<string>(
    schedule?.validFrom ?? toLocalDateString(new Date())
  );
  const [dayHours, setDayHours] = useState<string[]>(
    schedule
      ? schedule.dayMinutes.map((minutes) =>
          (minutes / 60).toLocaleString('de-DE', { maximumFractionDigits: 2 })
        )
      : DEFAULT_DAY_HOURS
  );
  const [note, setNote] = useState<string>(schedule?.note ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedDayMinutes: (number | null)[] = dayHours.map((value) => {
    const trimmed = value.trim().replace(',', '.');
    if (trimmed.length === 0) return 0;
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 24) return null;
    return Math.round(parsed * 60);
  });

  const weeklyMinutes = parsedDayMinutes.every((m) => m !== null)
    ? (parsedDayMinutes as number[]).reduce((total, m) => total + m, 0)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    if (parsedDayMinutes.some((m) => m === null)) {
      setError(SCHEDULE_ERROR_MESSAGES.invalid_day_minutes);
      return;
    }

    setIsSaving(true);
    const input = {
      validFrom,
      dayMinutes: parsedDayMinutes as number[],
      note: note.trim().length > 0 ? note.trim() : null,
    };
    const result = schedule
      ? await updateWorkSchedule(schedule.id, input)
      : await addWorkSchedule(recordId, input);
    setIsSaving(false);

    if (result.success) {
      onClose(true);
    } else {
      setError(
        SCHEDULE_ERROR_MESSAGES[result.error ?? ''] ??
          'Der Wochenplan konnte nicht gespeichert werden.'
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {schedule ? 'Wochenplan bearbeiten' : 'Wochenplan hinzufügen'}
          </DialogTitle>
          <DialogDescription>
            Wochenpläne gelten ab ihrem Datum. Frühere Zeiträume behalten die
            damals gültige Version.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="schedule-valid-from">Gültig ab</Label>
              <DatePicker
                id="schedule-valid-from"
                ariaLabel="Gültig ab"
                value={validFrom ? new Date(`${validFrom}T00:00:00`) : undefined}
                onChange={(date) =>
                  setValidFrom(date ? toLocalDateString(date) : '')
                }
                disabled={isSaving}
              />
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">
                Arbeitsstunden pro Wochentag
              </legend>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                {WEEKDAY_LABELS.map((label, index) => (
                  <div key={label} className="grid gap-1">
                    <Label
                      htmlFor={`schedule-day-${index}`}
                      className="text-xs text-muted-foreground"
                    >
                      {label}
                    </Label>
                    <Input
                      id={`schedule-day-${index}`}
                      inputMode="decimal"
                      value={dayHours[index]}
                      onChange={(e) => {
                        const next = [...dayHours];
                        next[index] = e.target.value;
                        setDayHours(next);
                      }}
                      disabled={isSaving}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                0 bedeutet: kein Arbeitstag.
                {weeklyMinutes !== null &&
                  ` Summe: ${formatDuration(weeklyMinutes)} pro Woche.`}
              </p>
            </fieldset>
            <div className="grid gap-2">
              <Label htmlFor="schedule-note">Notiz</Label>
              <Input
                id="schedule-note"
                placeholder="z. B. Elternzeit-Teilzeit"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isSaving}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isSaving || !validFrom}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {isSaving ? 'Wird gespeichert...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
