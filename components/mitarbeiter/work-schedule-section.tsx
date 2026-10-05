'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Plus } from 'lucide-react';

import { useServerAction } from '@/hooks/use-server-action';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { deleteWorkSchedule } from '@/lib/personnel/actions';
import { getBusinessTodayIso, getEffectiveCondition, type EmploymentCondition } from '@/lib/personnel/types';
import { getEffectiveSchedule, getWeeklyScheduleMinutes, type WorkSchedule } from '@/lib/personnel/schedule';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { WorkScheduleDeleteDialog } from './work-schedule-delete-dialog';
import { WorkScheduleDialog } from './work-schedule-dialog';
import { getScheduleErrorMessage } from './work-schedule-format';
import { WorkScheduleListItem } from './work-schedule-list-item';
import { SectionTitle } from '@/components/shared/section-title';

type DialogState = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; schedule: WorkSchedule };

interface WorkScheduleSectionProps {
  recordId: string;
  schedules: WorkSchedule[];
  conditions: EmploymentCondition[];
  canEdit: boolean;
}

export function WorkScheduleSection({ recordId, schedules, conditions, canEdit }: WorkScheduleSectionProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const [dialogState, setDialogState] = useState<DialogState>({ mode: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<WorkSchedule | null>(null);
  const { run: runDelete, isPending: isDeleting } = useServerAction(deleteWorkSchedule);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const todayIso = getBusinessTodayIso();
  const current = getEffectiveSchedule(schedules, todayIso);
  const sorted = [...schedules].sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  // Non-blocking consistency hint: the schedule wins for targets, the
  // condition's weekly hours stay contractual metadata (owner decision).
  const currentCondition = getEffectiveCondition(conditions);
  const currentWeeklyMinutes = current ? getWeeklyScheduleMinutes(current) : null;
  const conditionWeeklyMinutes =
    currentCondition?.weeklyHours != null ? Math.round(currentCondition.weeklyHours * 60) : null;

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setDeleteError(null);
    const result = await runDelete(deleteTarget.id).catch(() => ({
      success: false as const,
      error: undefined,
    }));
    if (result.success) {
      setDeleteTarget(null);
      showBanner({
        variant: 'success',
        message: 'Der Wochenplan wurde gelöscht.',
      });
      router.refresh();
    } else {
      setDeleteError(
        getScheduleErrorMessage(result.error ?? '', 'Der Wochenplan konnte nicht gelöscht werden.'),
      );
    }
  };

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon={<CalendarClock className="size-4" />}>Arbeitszeitmodell</SectionTitle>
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
          Kein Arbeitszeitmodell hinterlegt. Ohne Wochenplan gilt für Zeitziele das Standardziel von 8 Stunden
          pro Tag – sichtbar als Hinweis, nicht als echte Vorgabe.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sorted.map((schedule) => (
            <WorkScheduleListItem
              key={schedule.id}
              schedule={schedule}
              isCurrent={current?.id === schedule.id}
              isScheduled={schedule.validFrom > todayIso}
              canEdit={canEdit}
              onEdit={() => setDialogState({ mode: 'edit', schedule })}
              onDelete={() => {
                setDeleteError(null);
                setDeleteTarget(schedule);
              }}
            />
          ))}
        </ul>
      )}

      {currentWeeklyMinutes !== null &&
        conditionWeeklyMinutes !== null &&
        currentWeeklyMinutes !== conditionWeeklyMinutes && (
          <p className="mt-2 text-xs text-muted-foreground">
            Hinweis: Der aktuelle Wochenplan ({formatDuration(currentWeeklyMinutes)}) weicht von den
            Wochenstunden der Beschäftigung ({formatDuration(conditionWeeklyMinutes)}) ab. Für Zeitziele gilt
            der Wochenplan.
          </p>
        )}

      {dialogState.mode !== 'closed' && (
        <WorkScheduleDialog
          recordId={recordId}
          schedule={dialogState.mode === 'edit' ? dialogState.schedule : null}
          onClose={(saved) => {
            setDialogState({ mode: 'closed' });
            if (saved) router.refresh();
          }}
        />
      )}

      <WorkScheduleDeleteDialog
        deleteTarget={deleteTarget}
        deleteError={deleteError}
        isDeleting={isDeleting}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onDelete={handleDelete}
      />
    </div>
  );
}
