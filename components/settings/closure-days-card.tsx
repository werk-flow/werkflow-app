'use client';

import { describeFailure } from '@/lib/action-messages';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InlinePending } from '@/components/ui/inline-pending';
import { DatePicker } from '@/components/ui/date-picker';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useServerAction } from '@/hooks/use-server-action';
import { addClosureDay, removeClosureDay } from '@/lib/org/calendar-actions';
import type { ClosureDay } from '@/lib/personnel/targets';
import { toLocalDateString } from '@/lib/utils';
import { getBusinessTodayIso } from '@/lib/personnel/types';

const CLOSURE_ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Betriebsruhe-Tage zu ändern.',
  invalid_date: 'Bitte gib ein gültiges Datum an.',
  date_in_past:
    'Vergangene Tage können nicht geändert werden – frühere Zeiträume behalten ihre damalige Bedeutung.',
  duplicate_date: 'Für dieses Datum ist bereits Betriebsruhe eingetragen.',
  closure_day_not_found: 'Der Betriebsruhe-Tag wurde nicht gefunden.',
  create_failed: 'Der Betriebsruhe-Tag konnte nicht gespeichert werden.',
  delete_failed: 'Der Betriebsruhe-Tag konnte nicht entfernt werden.',
} satisfies Record<string, string>;

function formatClosureDay(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function ClosureDayList({
  closureDays,
  canEditClosureDays,
  todayIso,
  isRemoving,
  onRemove,
}: {
  closureDays: ClosureDay[];
  canEditClosureDays: boolean;
  todayIso: string;
  isRemoving: (closureDayId: string) => boolean;
  onRemove: (closureDayId: string) => Promise<void>;
}) {
  return (
    <ul className="grid gap-2">
      {closureDays.map((day) => {
        const isPast = day.closureDate < todayIso;
        const dayId = day.id;
        return (
          <li
            key={day.id ?? day.closureDate}
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{formatClosureDay(day.closureDate)}</p>
              <p className="text-xs text-muted-foreground">
                {day.label ?? 'Betriebsruhe'}
                {isPast ? ' · vergangen' : ''}
              </p>
            </div>
            {canEditClosureDays && !isPast && dayId && (
              <div className="flex items-center gap-2">
                <InlinePending active={isRemoving(dayId)} label="Betriebsruhe-Tag wird entfernt" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-destructive hover:text-destructive"
                  aria-label={`Betriebsruhe am ${formatClosureDay(day.closureDate)} entfernen`}
                  disabled={isRemoving(dayId)}
                  onClick={() => onRemove(dayId)}
                >
                  {isRemoving(dayId) ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ClosureDaysCard({
  closureDays,
  canEditClosureDays,
}: {
  closureDays: ClosureDay[];
  canEditClosureDays: boolean;
}) {
  const router = useRouter();
  const { showBanner } = useBanner();

  const [closureDate, setClosureDate] = useState<string>('');
  const [closureLabel, setClosureLabel] = useState<string>('');
  const { run: runAddClosure, isPending: isAddingClosure } = useServerAction(addClosureDay);
  const [closureDateError, setClosureDateError] = useState<string | null>(null);
  const removingClosure = useBusyIds();

  const todayIso = getBusinessTodayIso();

  const handleAddClosureDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditClosureDays || isAddingClosure) return;
    if (!closureDate) {
      setClosureDateError(CLOSURE_ERROR_MESSAGES.invalid_date);
      document.getElementById('closure-date')?.focus();
      return;
    }
    try {
      const result = await runAddClosure({
        closureDate,
        label: closureLabel,
      });
      if (!result.success) {
        showBanner({
          message: describeFailure(
            result.error,
            CLOSURE_ERROR_MESSAGES,
            CLOSURE_ERROR_MESSAGES.create_failed,
          ),
          variant: 'error',
        });
        return;
      }
      setClosureDate('');
      setClosureLabel('');
      router.refresh();
      showBanner({
        message: 'Der Betriebsruhe-Tag wurde eingetragen.',
        variant: 'success',
      });
    } catch {
      showBanner({ message: CLOSURE_ERROR_MESSAGES.create_failed, variant: 'error' });
    }
  };

  const handleRemoveClosureDay = async (closureDayId: string) => {
    if (!canEditClosureDays || removingClosure.isBusy(closureDayId)) return;
    await removingClosure
      .run(closureDayId, async () => {
        const result = await removeClosureDay(closureDayId);
        if (!result.success) {
          showBanner({
            message: describeFailure(
              result.error,
              CLOSURE_ERROR_MESSAGES,
              CLOSURE_ERROR_MESSAGES.delete_failed,
            ),
            variant: 'error',
          });
          return;
        }
        router.refresh();
        showBanner({
          message: 'Der Betriebsruhe-Tag wurde entfernt.',
          variant: 'success',
        });
      })
      .catch(() => {
        showBanner({ message: CLOSURE_ERROR_MESSAGES.delete_failed, variant: 'error' });
      });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Betriebsruhe</CardTitle>
        <CardDescription>
          Trage betriebsfreie Tage ein (z. B. Betriebsferien oder Brückentage). An diesen Tagen ist die
          Sollarbeitszeit 0. Vergangene Tage können nicht geändert werden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pb-6">
        {closureDays.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Betriebsruhe-Tage eingetragen.</p>
        ) : (
          <ClosureDayList
            closureDays={closureDays}
            canEditClosureDays={canEditClosureDays}
            todayIso={todayIso}
            isRemoving={removingClosure.isBusy}
            onRemove={handleRemoveClosureDay}
          />
        )}

        {canEditClosureDays && (
          <form onSubmit={handleAddClosureDay} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Datum" htmlFor="closure-date" required error={closureDateError}>
              <DatePicker
                ariaLabel="Datum der Betriebsruhe"
                value={closureDate ? new Date(`${closureDate}T00:00:00`) : undefined}
                onChange={(date) => {
                  setClosureDateError(null);
                  setClosureDate(date ? toLocalDateString(date) : '');
                }}
                disabled={isAddingClosure}
              />
            </Field>
            <Field label="Bezeichnung (optional)" htmlFor="closure-label" className="flex-1">
              <Input
                placeholder="z. B. Betriebsferien"
                value={closureLabel}
                onChange={(e) => setClosureLabel(e.target.value)}
                disabled={isAddingClosure}
              />
            </Field>
            <Button type="submit" variant="outline" className="gap-1.5" disabled={isAddingClosure}>
              {isAddingClosure ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Eintragen
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
