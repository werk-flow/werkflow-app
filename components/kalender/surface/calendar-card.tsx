'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { forwardRef, type ReactNode } from 'react';
import { Briefcase, CalendarDays, Lock, Repeat2, StickyNote, UserX } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CALENDAR_DISPATCH_STATE_LABELS,
  isNoteEntry,
  type CalendarDispatchState,
} from '@/lib/calendar/board';
import { PLANNING_OCCURRENCE_STATUS_LABELS } from '@/lib/planning/types';
import type { CalendarJob } from '@/lib/jobs/types';
import { MATERIAL_UNRESERVED_LABEL } from '@/lib/dispatch/readiness';
import {
  unavailabilityLabel,
  unavailableAssignees,
  type BoardPeople,
  type UnavailableAssignee,
} from '@/lib/calendar/board-model';

/**
 * The one card anatomy (P1-24a, criterion 4 and the design direction): a
 * title line with the kind icon, a second line with customer and place, and a
 * chip row for dispatch state, readiness and marks. Three sizes share it: the
 * board (two lines), the day view (compact, one line when the block is
 * short) and the month (one line). It is a real button: focusable, Enter
 * opens the popover, and the pointer-down starts a drag through the engine.
 */
type CalendarCardSize = 'board' | 'day' | 'month';

export type CalendarCardChip = {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'info' | 'destructive';
};

const DISPATCH_CHIP_TONE: Record<CalendarDispatchState, CalendarCardChip['tone']> = {
  nicht_gesendet: 'neutral',
  ausstehend: 'info',
  bestaetigt: 'success',
  uebernommen: 'success',
  rueckfrage: 'warning',
  nicht_moeglich: 'neutral',
};

const CHIP_CLASS: Record<CalendarCardChip['tone'], string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  info: 'bg-info-soft text-info-soft-foreground',
  destructive: 'bg-destructive-soft text-destructive-soft-foreground',
};

export function dispatchChip(state: CalendarDispatchState): CalendarCardChip {
  return { label: CALENDAR_DISPATCH_STATE_LABELS[state], tone: DISPATCH_CHIP_TONE[state] };
}

/** The one readiness fact the calendar holds: planned material that is not reserved yet. */
export function readinessChips(hasMaterialDemand: boolean): CalendarCardChip[] {
  return hasMaterialDemand ? [{ label: MATERIAL_UNRESERVED_LABEL, tone: 'neutral' }] : [];
}

/** One warning per assignee who cannot work the visit by its date: „Ausgeschieden: Erik Lindner“. */
function unavailableAssigneeChips(assignees: readonly UnavailableAssignee[]): CalendarCardChip[] {
  return assignees.map((assignee) => ({
    label: `${unavailabilityLabel(assignee.reason)}: ${assignee.name}`,
    tone: 'warning',
  }));
}

/**
 * A card's warnings for its assignees who cannot work the visit: the chips a
 * card shows, and the alert a compact card says instead. Board, phone board
 * and day view take them from here.
 */
export function unavailableAssigneeWarnings(
  job: CalendarJob,
  people: BoardPeople,
): { chips: CalendarCardChip[]; alert: string | undefined } {
  const chips = unavailableAssigneeChips(unavailableAssignees(job, people));
  return { chips, alert: chips.length > 0 ? chips.map((chip) => chip.label).join(', ') : undefined };
}

function isInactiveOccurrence(job: Pick<CalendarJob, 'occurrenceStatus'>): boolean {
  return job.occurrenceStatus === 'skipped' || job.occurrenceStatus === 'cancelled';
}

/** Customer and place in one line, the way the office reads a card. */
function cardSubtitle(
  job: Pick<CalendarJob, 'clientName' | 'location' | 'clientAddress' | 'projectName'>,
): string {
  return (
    [job.clientName, job.location ?? job.clientAddress].filter(Boolean).join(' · ') || job.projectName || ''
  );
}

function cardTime(job: Pick<CalendarJob, 'plannedTime' | 'estimatedDurationMinutes'>): string {
  if (!job.plannedTime) return 'ganztägig';
  const minutes = job.estimatedDurationMinutes ?? 0;
  const hours = minutes / 60;
  const duration =
    minutes <= 0
      ? ''
      : minutes < 60
        ? ` · ${minutes} min`
        : ` · ${hours.toLocaleString('de-DE', { maximumFractionDigits: 1 })} h`;
  return `${job.plannedTime}${duration}`;
}

export type CalendarCardProps = {
  job: CalendarJob;
  size: CalendarCardSize;
  chips?: readonly CalendarCardChip[];
  /** Density switch: „Kompakt" drops the second line. */
  compact?: boolean;
  selected?: boolean;
  /** A linked assignment of the same occurrence is hovered elsewhere. */
  linked?: boolean;
  draggable?: boolean;
  /** A started or past occurrence: shown as history, never a drag source (P1-11). */
  locked?: boolean;
  /**
   * A warning the card always says, such as a person who left: part of its
   * accessible name, and an icon where the one-line card has no chip row.
   */
  alert?: string | undefined;
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onOpen?: (element: HTMLButtonElement) => void;
  onHoverLink?: (occurrenceId: string | null) => void;
  className?: string;
  style?: React.CSSProperties;
  /** Extra content such as an edge handle. */
  children?: ReactNode;
  'aria-label'?: string;
  'data-occurrence-id'?: string;
  'data-employee-record-id'?: string;
};

type CardFacts = {
  size: CalendarCardSize;
  note: boolean;
  inactive: boolean;
  locked: boolean;
  oneLine: boolean;
  alert: string | undefined;
};

/** The title line: kind icon, title and the marks for locked, series, inactive and the month's job number. */
function cardTitleLine(
  job: CalendarJob,
  { size, note, inactive, locked, oneLine, alert }: CardFacts,
): React.JSX.Element {
  const statusLabel = job.occurrenceStatus
    ? PLANNING_OCCURRENCE_STATUS_LABELS[job.occurrenceStatus]
    : undefined;
  const Icon = note ? StickyNote : job.entryKind === 'internal' ? CalendarDays : Briefcase;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Icon
        className={cn(
          'size-3 shrink-0',
          note ? 'text-calendar-note-foreground' : 'text-calendar-planning-strong',
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          'min-w-0 font-medium',
          !oneLine ? 'line-clamp-2 break-words' : 'truncate',
          inactive && 'line-through',
        )}
      >
        {job.title}
      </span>
      {/* A day timeline card can be too short for its warning chip: its title line always carries the icon. */}
      {(oneLine || size === 'day') && alert && (
        <UserX className="ml-auto size-3 shrink-0 text-warning-text" aria-hidden="true">
          <title>{alert}</title>
        </UserX>
      )}
      {locked && <Lock className="ml-auto size-3 shrink-0 opacity-70" aria-hidden="true" />}
      {job.seriesId && (
        <Repeat2 className="size-3 shrink-0 opacity-70" role="img" aria-label="Serientermin" />
      )}
      {inactive && statusLabel && (
        <span className="shrink-0 rounded-sm bg-muted px-1 text-xs text-muted-foreground">{statusLabel}</span>
      )}
      {size === 'month' && job.jobNumber && (
        <span className="ml-auto hidden shrink-0 font-mono text-xs opacity-70 sm:inline">
          {job.jobNumber}
        </span>
      )}
    </span>
  );
}

/** The job number and the subtitle under the title. */
function cardSubtitleLine(job: CalendarJob, subtitle: string, size: CalendarCardSize): React.JSX.Element {
  return (
    <span
      className={cn(
        'flex min-w-0 gap-1 text-xs opacity-80',
        size === 'day' ? 'flex-col items-start' : 'items-center',
      )}
    >
      {job.jobNumber && size !== 'day' && <span className="shrink-0 font-mono">{job.jobNumber}</span>}
      {subtitle && (
        <span className={cn('min-w-0', size === 'day' ? 'line-clamp-2 break-words' : 'truncate')}>
          {subtitle}
        </span>
      )}
    </span>
  );
}

/** A chip truncates inside the card; a warning wraps, because its name is the point. */
function cardChipRow(chips: readonly CalendarCardChip[]): React.JSX.Element {
  return (
    <span className="flex min-w-0 flex-wrap gap-1 pt-0.5">
      {chips.map((chip) => (
        <span
          key={chip.label}
          title={chip.label}
          className={cn(
            'max-w-full rounded-sm px-1 text-xs leading-4',
            chip.tone === 'warning' ? 'break-words' : 'truncate whitespace-nowrap',
            CHIP_CLASS[chip.tone],
          )}
        >
          {chip.label}
        </span>
      ))}
    </span>
  );
}

export const CalendarCard = forwardRef<HTMLButtonElement, CalendarCardProps>(function CalendarCard(
  {
    job,
    size,
    chips = [],
    compact = false,
    selected = false,
    linked = false,
    draggable = false,
    locked = false,
    alert,
    onPointerDown,
    onOpen,
    onHoverLink,
    className,
    style,
    children,
    ...rest
  },
  ref,
) {
  const inactive = isInactiveOccurrence(job);
  const inert = inactive || locked;
  const note = isNoteEntry(job);
  const subtitle = cardSubtitle(job);
  const oneLine = size === 'month' || compact;
  return (
    <PlainButton
      ref={ref}
      type="button"
      data-calendar-card={size}
      data-occurrence-id={rest['data-occurrence-id'] ?? job.occurrenceId ?? job.id}
      data-employee-record-id={rest['data-employee-record-id']}
      // A move that is taken back renders the card anew; a closing dialog finds it again by this key.
      data-focus-key={`calendar-card:${size}:${rest['data-occurrence-id'] ?? job.occurrenceId ?? job.id}:${rest['data-employee-record-id'] ?? ''}`}
      data-locked={locked ? '' : undefined}
      aria-label={`${rest['aria-label'] ?? `${job.title}, ${cardTime(job)}${subtitle ? `, ${subtitle}` : ''}`}${locked ? ', begonnen oder vergangen' : ''}${alert ? `, ${alert}` : ''}`}
      className={cn(
        'group/card relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-md border border-l-2 text-left text-xs leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        note
          ? 'border-dashed border-calendar-note-border bg-calendar-note text-calendar-note-foreground'
          : 'border-calendar-planning-border border-l-calendar-planning-strong bg-calendar-planning text-calendar-planning-foreground',
        oneLine ? 'h-6 justify-center px-1.5' : 'px-2 py-1.5',
        !inert && draggable && 'cursor-grab active:cursor-grabbing hover:bg-calendar-planning-border/40',
        inactive && 'opacity-60',
        selected && 'ring-2 ring-primary',
        linked && 'shadow-[0_0_0_2px_var(--calendar-planning-strong)]',
        className,
      )}
      style={style}
      onPointerDown={!inert && draggable ? onPointerDown : undefined}
      onClick={(event) => onOpen?.(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.(event.currentTarget);
        }
      }}
      onMouseEnter={() => onHoverLink?.(job.occurrenceId ?? null)}
      onMouseLeave={() => onHoverLink?.(null)}
      onFocus={() => onHoverLink?.(job.occurrenceId ?? null)}
      onBlur={() => onHoverLink?.(null)}
    >
      {cardTitleLine(job, { size, note, inactive, locked, oneLine, alert })}
      {!oneLine && job.plannedTime && (
        <span className="text-xs tabular-nums opacity-80">{cardTime(job)}</span>
      )}
      {!oneLine && (subtitle || job.jobNumber) && cardSubtitleLine(job, subtitle, size)}
      {!oneLine && chips.length > 0 && cardChipRow(chips)}
      {children}
    </PlainButton>
  );
});
