'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BriefcaseBusiness, Loader2, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  addEmploymentCondition,
  deleteEmploymentCondition,
  updateEmploymentCondition,
} from '@/lib/personnel/actions';
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  getEffectiveCondition,
  type EmploymentCondition,
  type EmploymentType,
} from '@/lib/personnel/types';
import { cn, toLocalDateString } from '@/lib/utils';

const CONDITION_ERROR_MESSAGES: Record<string, string> = {
  invalid_valid_from: 'Bitte gib ein gültiges Datum an.',
  invalid_employment_type: 'Bitte wähle eine Beschäftigungsart aus.',
  invalid_weekly_hours: 'Die Wochenstunden müssen zwischen 0 und 100 liegen.',
  invalid_vacation_days: 'Die Urlaubstage müssen zwischen 0 und 100 liegen.',
  duplicate_valid_from:
    'Für dieses Datum existiert bereits eine Kondition. Bearbeite die bestehende Version.',
  not_authorized: 'Du bist nicht berechtigt, Konditionen zu ändern.',
  record_not_found: 'Die Personalakte wurde nicht gefunden.',
  condition_not_found: 'Die Kondition wurde nicht gefunden.',
};

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatNumber(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

type DialogState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; condition: EmploymentCondition };

interface EmploymentConditionsSectionProps {
  recordId: string;
  conditions: EmploymentCondition[];
  canEdit: boolean;
}

export function EmploymentConditionsSection({
  recordId,
  conditions,
  canEdit,
}: EmploymentConditionsSectionProps) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<DialogState>({ mode: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<EmploymentCondition | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const current = getEffectiveCondition(conditions);
  const sorted = [...conditions].sort((a, b) =>
    b.validFrom.localeCompare(a.validFrom)
  );
  const todayIso = toLocalDateString(new Date());

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    const result = await deleteEmploymentCondition(deleteTarget.id);
    setIsDeleting(false);
    if (result.success) {
      setDeleteTarget(null);
      router.refresh();
    } else {
      setDeleteError(
        CONDITION_ERROR_MESSAGES[result.error ?? ''] ??
          'Die Kondition konnte nicht gelöscht werden.'
      );
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <BriefcaseBusiness className="size-4" />
          Beschäftigung
        </h3>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setDialogState({ mode: 'add' })}
          >
            <Plus className="size-3.5" />
            Kondition hinzufügen
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          Noch keine Angaben zur Beschäftigung. Konditionen gelten ab ihrem
          Datum und ändern rückwirkend nichts an früheren Zeiträumen.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sorted.map((condition) => {
            const isCurrent = current?.id === condition.id;
            const isScheduled = condition.validFrom > todayIso;
            return (
              <li
                key={condition.id}
                className={cn(
                  'rounded-md border px-3 py-2.5',
                  isCurrent && 'border-primary/40 bg-primary/5'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {EMPLOYMENT_TYPE_LABELS[condition.employmentType]}
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
                      Gültig ab {formatDate(condition.validFrom)}
                      {condition.weeklyHours !== null &&
                        ` · ${formatNumber(condition.weeklyHours)} Std./Woche`}
                      {condition.vacationDaysPerYear !== null &&
                        ` · ${formatNumber(condition.vacationDaysPerYear)} Urlaubstage/Jahr`}
                    </p>
                    {condition.note && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {condition.note}
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
                          aria-label={`Aktionen für Kondition vom ${formatDate(condition.validFrom)}`}
                        >
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            setDialogState({ mode: 'edit', condition })
                          }
                        >
                          <Pencil className="size-4" />
                          Bearbeiten
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(condition);
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

      {dialogState.mode !== 'closed' && (
        <ConditionDialog
          recordId={recordId}
          condition={dialogState.mode === 'edit' ? dialogState.condition : null}
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
            <AlertDialogTitle>Kondition löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Kondition ab{' '}
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

function ConditionDialog({
  recordId,
  condition,
  onClose,
}: {
  recordId: string;
  condition: EmploymentCondition | null;
  onClose: (saved: boolean) => void;
}) {
  const [validFrom, setValidFrom] = useState<string>(
    condition?.validFrom ?? toLocalDateString(new Date())
  );
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    condition?.employmentType ?? 'vollzeit'
  );
  const [weeklyHours, setWeeklyHours] = useState<string>(
    condition?.weeklyHours !== null && condition?.weeklyHours !== undefined
      ? String(condition.weeklyHours)
      : ''
  );
  const [vacationDays, setVacationDays] = useState<string>(
    condition?.vacationDaysPerYear !== null &&
      condition?.vacationDaysPerYear !== undefined
      ? String(condition.vacationDaysPerYear)
      : ''
  );
  const [note, setNote] = useState<string>(condition?.note ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseOptionalNumber = (value: string): number | null | undefined => {
    const trimmed = value.trim().replace(',', '.');
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    const parsedWeeklyHours = parseOptionalNumber(weeklyHours);
    if (parsedWeeklyHours === undefined) {
      setError('Bitte gib die Wochenstunden als Zahl an.');
      return;
    }
    const parsedVacationDays = parseOptionalNumber(vacationDays);
    if (parsedVacationDays === undefined) {
      setError('Bitte gib die Urlaubstage als Zahl an.');
      return;
    }

    setIsSaving(true);
    const input = {
      validFrom,
      employmentType,
      weeklyHours: parsedWeeklyHours,
      vacationDaysPerYear: parsedVacationDays,
      note: note.trim().length > 0 ? note.trim() : null,
    };
    const result = condition
      ? await updateEmploymentCondition(condition.id, input)
      : await addEmploymentCondition(recordId, input);
    setIsSaving(false);

    if (result.success) {
      onClose(true);
    } else {
      setError(
        CONDITION_ERROR_MESSAGES[result.error ?? ''] ??
          'Die Kondition konnte nicht gespeichert werden.'
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {condition ? 'Kondition bearbeiten' : 'Kondition hinzufügen'}
          </DialogTitle>
          <DialogDescription>
            Konditionen gelten ab ihrem Datum. Frühere Zeiträume behalten die
            damals gültige Version.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="condition-valid-from">Gültig ab</Label>
              <DatePicker
                id="condition-valid-from"
                ariaLabel="Gültig ab"
                value={validFrom ? new Date(`${validFrom}T00:00:00`) : undefined}
                onChange={(date) =>
                  setValidFrom(date ? toLocalDateString(date) : '')
                }
                disabled={isSaving}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="condition-type">Beschäftigungsart</Label>
              <Select
                value={employmentType}
                onValueChange={(value) =>
                  setEmploymentType(value as EmploymentType)
                }
                disabled={isSaving}
              >
                <SelectTrigger id="condition-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {EMPLOYMENT_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="condition-weekly-hours">Wochenstunden</Label>
                <Input
                  id="condition-weekly-hours"
                  inputMode="decimal"
                  placeholder="z. B. 40"
                  value={weeklyHours}
                  onChange={(e) => setWeeklyHours(e.target.value)}
                  disabled={isSaving}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="condition-vacation-days">
                  Urlaubstage/Jahr
                </Label>
                <Input
                  id="condition-vacation-days"
                  inputMode="decimal"
                  placeholder="z. B. 30"
                  value={vacationDays}
                  onChange={(e) => setVacationDays(e.target.value)}
                  disabled={isSaving}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="condition-note">Notiz</Label>
              <Textarea
                id="condition-note"
                rows={2}
                placeholder="z. B. Probezeit bis 30.09."
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
