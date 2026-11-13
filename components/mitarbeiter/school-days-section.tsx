'use client';

import { CalendarCheck, GraduationCap, MoreVertical, Plus, XCircle } from 'lucide-react';

import { StaleRegion } from '@/components/shared/stale-region';
import { SectionTitle } from '@/components/shared/section-title';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { InlinePending } from '@/components/ui/inline-pending';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { describeSchoolDay, type SchoolDay } from '@/lib/personnel/school-days';
import type { EmploymentCondition } from '@/lib/personnel/types';

import { AddSchoolDayDialog, EndSchoolDayDialog } from './school-day-dialogs';
import { useSchoolDays } from './use-school-days';

// The office's Berufsschule section of an apprentice's personnel record
// (werk-flow/werkflow-planning#165). A school day is credited with the day's
// normal target; the apprentice sees it in Zeiterfassung and the calendar.

/** Shown for a record that is or was in an apprenticeship. */
export function SchoolDaysSection({
  recordId,
  conditions,
}: {
  recordId: string;
  conditions: readonly EmploymentCondition[];
}) {
  if (!conditions.some((condition) => condition.employmentType === 'ausbildung')) return null;
  return <SchoolDaysList recordId={recordId} />;
}

function SchoolDaysList({ recordId }: { recordId: string }) {
  const state = useSchoolDays(recordId);
  const { view, dialogState, setDialogState, closeDialog } = state;

  return (
    <section className="space-y-3" data-testid="school-days-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon={<GraduationCap className="size-4" />}>Berufsschule</SectionTitle>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setDialogState({ mode: 'add' })}
        >
          <Plus className="size-3.5" />
          Berufsschule erfassen
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Ein Berufsschultag zählt wie ein Arbeitstag mit dem normalen Tagesziel. Zeit, die an diesem Tag
        zusätzlich erfasst wird, kommt obendrauf.
      </p>

      {view.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : view.data === undefined ? (
        <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
          Die Berufsschultage konnten nicht geladen werden.
        </SectionError>
      ) : (
        <StaleRegion stale={view.isStale} onRetry={view.refresh}>
          <SchoolDayRows schoolDays={view.data} state={state} />
        </StaleRegion>
      )}

      {dialogState.mode === 'add' && <AddSchoolDayDialog recordId={recordId} onClose={closeDialog} />}
      {dialogState.mode === 'end' && (
        <EndSchoolDayDialog schoolDay={dialogState.schoolDay} onClose={closeDialog} />
      )}
      <CancelSchoolDayDialog state={state} />
    </section>
  );
}

type SchoolDaysState = ReturnType<typeof useSchoolDays>;

/** Active rules first, then the cancelled ones, which stay visible as history. */
function SchoolDayRows({ schoolDays, state }: { schoolDays: SchoolDay[]; state: SchoolDaysState }) {
  if (schoolDays.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="Noch keine Berufsschule erfasst."
        description="Trag einen festen Schultag pro Woche oder einen Blockunterricht ein."
      />
    );
  }
  const ordered = [
    ...schoolDays.filter((schoolDay) => schoolDay.cancelledAt === null),
    ...schoolDays.filter((schoolDay) => schoolDay.cancelledAt !== null),
  ];
  return (
    <ul className="grid gap-2">
      {ordered.map((schoolDay) => (
        <SchoolDayRow
          key={schoolDay.id}
          schoolDay={schoolDay}
          busy={state.busy.isBusy(schoolDay.id)}
          onEnd={() => state.setDialogState({ mode: 'end', schoolDay })}
          onCancel={() => state.confirmCancel(schoolDay)}
        />
      ))}
    </ul>
  );
}

function CancelSchoolDayDialog({ state }: { state: SchoolDaysState }) {
  const { cancelTarget, confirmCancel, cancelRequestError, cancel, busy } = state;
  const pending = cancelTarget !== null && busy.isBusy(cancelTarget.id);
  return (
    <AlertDialog
      open={cancelTarget !== null}
      onOpenChange={(open) => !open && confirmCancel(null)}
      pending={pending}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Berufsschule stornieren?</AlertDialogTitle>
          <AlertDialogDescription>
            {cancelTarget ? `${describeSchoolDay(cancelTarget)}. ` : ''}
            Die Tage zählen danach wieder mit dem normalen Tagesziel. Der Eintrag bleibt als storniert
            sichtbar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter error={cancelRequestError}>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            pending={pending}
            onClick={(event) => {
              event.preventDefault();
              if (cancelTarget) void cancel(cancelTarget);
            }}
          >
            {pending ? 'Wird storniert…' : 'Stornieren'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function schoolDayState(
  schoolDay: SchoolDay,
  todayIso: string,
): { label: string; variant: 'success' | 'secondary' } {
  if (schoolDay.cancelledAt !== null) return { label: 'Storniert', variant: 'secondary' };
  if (schoolDay.endDate !== null && schoolDay.endDate < todayIso)
    return { label: 'Beendet', variant: 'secondary' };
  return { label: 'Aktiv', variant: 'success' };
}

function SchoolDayRow({
  schoolDay,
  busy,
  onEnd,
  onCancel,
}: {
  schoolDay: SchoolDay;
  busy: boolean;
  onEnd: () => void;
  onCancel: () => void;
}) {
  const description = describeSchoolDay(schoolDay);
  const state = schoolDayState(schoolDay, getBusinessTodayIso());
  return (
    <li
      className="flex items-start justify-between gap-2 rounded-md border px-3 py-2.5"
      data-school-day={schoolDay.id}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium tabular-nums">{description}</span>
        <Badge variant={state.variant}>{state.label}</Badge>
      </div>
      {busy ? (
        <InlinePending active />
      ) : (
        schoolDay.cancelledAt === null && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Aktionen für ${description}`}
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {schoolDay.kind === 'weekday' && (
                <DropdownMenuItem onSelect={onEnd}>
                  <CalendarCheck className="size-4" />
                  Enddatum setzen
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={onCancel}>
                <XCircle className="size-4" />
                Stornieren
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      )}
    </li>
  );
}
