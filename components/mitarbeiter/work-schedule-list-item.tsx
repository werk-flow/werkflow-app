'use client';

import { MoreVertical, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getWeeklyScheduleMinutes, WEEKDAY_SHORT_LABELS, type WorkSchedule } from '@/lib/personnel/schedule';
import { formatDuration } from '@/lib/time-tracking/helpers';
import { cn, formatGermanDate } from '@/lib/utils';

function formatScheduleDays(schedule: WorkSchedule): string {
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const minutes = schedule.dayMinutes[i];
    if (minutes !== undefined && minutes > 0) {
      parts.push(`${WEEKDAY_SHORT_LABELS[i]} ${formatHoursShort(minutes)}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : 'Keine Arbeitstage';
}

function formatHoursShort(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.`;
}

type WorkScheduleListItemProps = {
  schedule: WorkSchedule;
  isCurrent: boolean;
  isScheduled: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

export function WorkScheduleListItem({
  schedule,
  isCurrent,
  isScheduled,
  canEdit,
  onEdit,
  onDelete,
}: WorkScheduleListItemProps) {
  return (
    <li className={cn('rounded-md border px-3 py-2.5', isCurrent && 'border-primary/40 bg-primary/5')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {formatDuration(getWeeklyScheduleMinutes(schedule))} pro Woche
            </span>
            {isCurrent && (
              <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary-text">
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
            Gültig ab {formatGermanDate(schedule.validFrom)} · {formatScheduleDays(schedule)}
          </p>
          {schedule.note && <p className="mt-1 text-xs text-muted-foreground">{schedule.note}</p>}
        </div>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`Aktionen für Wochenplan ab ${formatGermanDate(schedule.validFrom)}`}
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-4" />
                Bearbeiten
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                <Trash2 className="size-4" />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}
