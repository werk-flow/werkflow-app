'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Briefcase,
  Building2,
  CalendarDays,
  Clock,
  ExternalLink,
  Lock,
  MapPin,
  MoveRight,
  ParkingSquare,
  Repeat2,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn, toLocalDateString } from '@/lib/utils';
import { absencesNotLoadedHint, absentAssignees, withAbsenceMarks } from '@/lib/calendar/absence-marks';
import { JOB_PRIORITY_LABELS, type CalendarJob } from '@/lib/jobs/types';
import { PRIORITY_CLASSES } from '@/components/auftraege/job-detail/job-detail-format';
import { getJobStatusClass, getJobStatusLabel } from '@/components/auftraege/status-classes';
import { isStartedOccurrence, type CalendarBoardRow } from '@/lib/calendar/board';
import { reassignmentChanges } from '@/lib/calendar/board-model';
import { calendarRefusalMessage, formatRefusalDate } from '@/lib/calendar/messages';
import { useClock } from './surface/use-now-tick';
import { checkOccurrenceMovable, checkParkable } from '@/lib/calendar/refusal-checks';
import { PLANNING_OCCURRENCE_STATUS_LABELS } from '@/lib/planning/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { PlanningOccurrenceEditDialog } from './planning-occurrence-edit-dialog';
import type { CalendarMutations } from './mutations/use-calendar-mutations';
import { moveSuccessMessage } from './board/board-surface-drop';
import { useBoardAbsences } from './board-absences-context';

/** `w-80` on the popover content. */
const POPOVER_WIDTH_PX = 320;

/** A full-width phone card leaves no room on either side; beside it the popover would open off-screen. */
function popoverSide(anchor: HTMLElement): 'bottom' | 'right' {
  const bounds = anchor.getBoundingClientRect();
  const needed = POPOVER_WIDTH_PX + 24;
  return window.innerWidth - bounds.right < needed && bounds.left < needed ? 'bottom' : 'right';
}

export type OpenCard = {
  job: CalendarJob;
  /** The element the popover anchors to; focus returns here on close. */
  anchor: HTMLElement;
  /** The board row the card was opened from; null off the board or in the unassigned row. */
  row: CalendarBoardRow | null;
};

interface JobEventPopoverProps {
  card: OpenCard | null;
  onClose: () => void;
  memberNames: Record<string, string>;
  canEditPlanning: boolean;
  /** Board rows for the „Verschieben" form; empty outside the board. */
  rows: readonly CalendarBoardRow[];
  mutations: CalendarMutations | null;
  onPark: ((job: CalendarJob) => void) | null;
}

/**
 * The card popover on the Popover primitive (P1-24a, criterion 25): one
 * anchor, focus inside, Escape and outside click close it, focus returns to
 * the card. „Verschieben …" is the keyboard alternative to the drag and runs
 * through the same mutation and the same pre-checks. The body remounts per
 * card, so its form state starts fresh without effects.
 */
export function JobEventPopover({ card, ...rest }: JobEventPopoverProps) {
  if (!card) return null;
  return <CardPopover key={`${card.job.id}:${card.row?.employeeRecordId ?? ''}`} card={card} {...rest} />;
}

function openDetails(url: string, onClose: () => void, router: ReturnType<typeof useRouter>): void {
  onClose();
  router.push(url);
}

/** The popover's first focus goes to its first action. */
function focusFirstAction(event: Event): void {
  event.preventDefault();
  const content = event.currentTarget;
  if (!(content instanceof HTMLElement)) return;
  // eslint-disable-next-line no-restricted-syntax -- the popover's first focus goes to its first action, not a validation path
  content.querySelector<HTMLElement>('button, a')?.focus();
}

/** Closes the popover and returns focus to the card, when the card still exists. */
function closeToAnchor(anchor: HTMLElement, onClose: () => void): void {
  onClose();
  requestAnimationFrame(() => {
    if (anchor.isConnected) anchor.focus();
  });
}

/** Where the card's job opens, when it has a number. */
function jobDetailPath(job: CalendarJob): string | null {
  return job.jobNumber
    ? job.projectNumber
      ? `/auftraege/projekt/${job.projectNumber}/${job.jobNumber}`
      : `/auftraege/${job.jobNumber}`
    : null;
}

function CardPopoverTitle({ job, onClose }: { job: CalendarJob; onClose: () => void }): React.JSX.Element {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3 break-words font-semibold" title={job.title}>
          {job.title}
        </p>
        {job.jobNumber && <p className="text-xs text-muted-foreground">{job.jobNumber}</p>}
      </div>
      <PlainButton
        type="button"
        aria-label="Terminübersicht schließen"
        onClick={onClose}
        className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" aria-hidden="true" />
      </PlainButton>
    </div>
  );
}

/** The occurrence's state, its series mark and, for a job visit, the job's status and priority. */
function CardPopoverBadges({
  job,
  inactiveStatusLabel,
}: {
  job: CalendarJob;
  inactiveStatusLabel: string | undefined;
}): React.JSX.Element {
  const statusInfo = { label: getJobStatusLabel(job), className: getJobStatusClass(job) };
  const priorityInfo = {
    label: JOB_PRIORITY_LABELS[job.priority],
    className: PRIORITY_CLASSES[job.priority],
  };
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {inactiveStatusLabel ? (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {inactiveStatusLabel}
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-calendar-planning px-2 py-0.5 text-xs font-medium text-calendar-planning-foreground">
          Geplant
        </span>
      )}
      {job.seriesId && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          <Repeat2 className="size-3" aria-hidden="true" /> Serie
        </span>
      )}
      {job.entryKind !== 'internal' && (
        <>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              statusInfo.className,
            )}
          >
            {statusInfo.label}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              priorityInfo?.className,
            )}
          >
            {priorityInfo?.label}
          </span>
        </>
      )}
    </div>
  );
}

/** The commands of the card: edit, move, park and open, each only where it can run. */
function CardPopoverActions({
  locked,
  canEdit,
  movable,
  parkable,
  jobUrl,
  onEdit,
  onMove,
  onPark,
  onOpenDetails,
}: {
  locked: boolean;
  canEdit: boolean;
  movable: boolean;
  parkable: boolean;
  jobUrl: string | null;
  onEdit: () => void;
  onMove: () => void;
  onPark: () => void;
  onOpenDetails: (url: string) => void;
}): React.JSX.Element {
  return (
    <div className="mt-3 grid gap-2">
      {locked && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground" data-card-locked="">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {calendarRefusalMessage('started_occurrence')}
        </p>
      )}
      {canEdit && (
        <Button variant="default" size="sm" onClick={onEdit}>
          Termin bearbeiten
        </Button>
      )}
      {movable && (
        <Button variant="outline" size="sm" onClick={onMove}>
          <MoveRight className="mr-2 size-3.5" aria-hidden="true" />
          Verschieben …
        </Button>
      )}
      {parkable && (
        <Button variant="outline" size="sm" onClick={onPark}>
          <ParkingSquare className="mr-2 size-3.5" aria-hidden="true" />
          Parken
        </Button>
      )}
      {jobUrl && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => onOpenDetails(jobUrl)}>
          <ExternalLink className="mr-2 size-3.5" aria-hidden="true" />
          Details anzeigen
        </Button>
      )}
    </div>
  );
}

function CardPopover({
  card,
  onClose,
  memberNames,
  canEditPlanning,
  rows,
  mutations,
  onPark,
}: JobEventPopoverProps & { card: OpenCard }) {
  const router = useRouter();
  const clock = useClock();
  const { job, row } = card;
  const [editOpen, setEditOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const virtualRef = useMemo(() => ({ current: card.anchor }), [card.anchor]);
  const inactiveStatusLabel = job.occurrenceStatus
    ? PLANNING_OCCURRENCE_STATUS_LABELS[job.occurrenceStatus]
    : undefined;
  const locked = isStartedOccurrence(job, clock());
  const movable = canEditPlanning && mutations !== null && checkOccurrenceMovable(job, clock()).ok;
  const parkable = canEditPlanning && onPark !== null && checkParkable(job).ok;

  const close = () => closeToAnchor(card.anchor, onClose);

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open && !editOpen) close();
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side={popoverSide(card.anchor)}
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-80 max-w-[calc(100vw-1.5rem)] p-4 shadow-xl"
        data-job-popover=""
        // A dialog opened from inside (the planning warning after a move) returns focus to the card.
        data-focus-return={card.anchor.dataset.focusKey}
        onOpenAutoFocus={focusFirstAction}
      >
        <CardPopoverTitle job={job} onClose={close} />

        <CardPopoverBadges job={job} inactiveStatusLabel={inactiveStatusLabel} />

        <JobEventFacts job={job} memberNames={memberNames} />

        {moving && mutations ? (
          <MoveForm
            job={job}
            row={row}
            rows={rows}
            mutations={mutations}
            onDone={onClose}
            onCancel={() => setMoving(false)}
          />
        ) : (
          <CardPopoverActions
            locked={locked}
            canEdit={Boolean(canEditPlanning && job.occurrenceId && !inactiveStatusLabel && !locked)}
            movable={movable}
            parkable={parkable}
            jobUrl={jobDetailPath(job)}
            onEdit={() => setEditOpen(true)}
            onMove={() => setMoving(true)}
            onPark={() => {
              onClose();
              onPark?.(job);
            }}
            onOpenDetails={(url) => openDetails(url, onClose, router)}
          />
        )}
        {job.occurrenceId && (
          <PlanningOccurrenceEditDialog
            job={job}
            open={editOpen}
            onOpenChange={setEditOpen}
            onSuccess={close}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** When, for whom, where and with whom the occurrence is planned, and which assignee is away then. */
function JobEventFacts({ job, memberNames }: { job: CalendarJob; memberNames: Record<string, string> }) {
  const absences = useBoardAbsences();
  const absent = absentAssignees(job, absences);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {job.entryKind === 'internal' ? (
          <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>
          {job.entryKind === 'internal' ? 'Interner Termin' : 'Geplanter Auftragsbesuch'}
          {job.plannedDate ? ` · ${formatRefusalDate(job.plannedDate)}` : ''}
          {job.plannedTime ? ` ${job.plannedTime}` : ''}
          {job.isException ? ' · angepasster Einzeltermin' : ''}
        </span>
      </div>
      {job.clientName && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{job.clientName}</span>
        </div>
      )}
      {job.projectName && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Briefcase className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            Projekt: {job.projectName}
            {job.projectNumber && ` (${job.projectNumber})`}
          </span>
        </div>
      )}
      {job.location && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{job.location}</span>
        </div>
      )}
      {job.assignedUserIds.length > 0 && (
        <div className="flex items-start gap-2 text-muted-foreground">
          <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {job.assignedUserIds.map((userId) => memberNames[userId] ?? 'Mitarbeiter').join(', ')}
          </span>
        </div>
      )}
      {absent.length > 0 && (
        <div className="flex items-start gap-2 font-medium text-warning-text" data-card-absence="">
          <UserX className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{absent.map(({ name, mark }) => `${name}: ${mark}`).join(', ')}</span>
        </div>
      )}
    </div>
  );
}

type MoveFormProps = {
  job: CalendarJob;
  row: CalendarBoardRow | null;
  rows: readonly CalendarBoardRow[];
  mutations: CalendarMutations;
  onDone: () => void;
  onCancel: () => void;
};

/** Runs the move to the chosen person and day; a move that changes nothing runs no write. */
function moveToTarget(
  { job, row, rows, mutations }: Pick<MoveFormProps, 'job' | 'row' | 'rows' | 'mutations'>,
  moveRecordId: string,
  moveDate: Date,
): void {
  const targetRow = rows.find((entry) => entry.employeeRecordId === moveRecordId) ?? null;
  const target = {
    employeeRecordId: targetRow?.employeeRecordId ?? null,
    userId: targetRow?.userId ?? null,
    date: toLocalDateString(moveDate),
  };
  const changes = reassignmentChanges({
    job,
    sourceEmployeeRecordId: row?.employeeRecordId ?? null,
    sourceUserId: row?.userId ?? null,
    target,
  });
  if (!changes) return;
  const targetName = targetRow?.displayName ?? 'Ohne Zuweisung';
  const dateLabel = formatRefusalDate(target.date);
  void mutations.moveJob({
    job,
    changes,
    successMessage: moveSuccessMessage(changes, targetName, dateLabel),
    context: { name: targetName, date: dateLabel },
  });
}

function MoveForm({ job, row, rows, mutations, onDone, onCancel }: MoveFormProps) {
  const [moveDate, setMoveDate] = useState<Date | undefined>(() =>
    job.plannedDate ? new Date(`${job.plannedDate}T12:00:00`) : undefined,
  );
  const [moveRecordId, setMoveRecordId] = useState(row?.employeeRecordId ?? '');
  const [moveError, setMoveError] = useState<string | null>(null);
  const absences = useBoardAbsences();
  const moveDateIso = moveDate ? toLocalDateString(moveDate) : '';
  const rowOptions = withAbsenceMarks(
    rows.map((entry) => ({ value: entry.employeeRecordId, label: entry.displayName })),
    absences,
    moveDateIso,
  );

  const submitMove = (event: React.FormEvent) => {
    event.preventDefault();
    const dateError = moveDate ? undefined : 'Bitte wähle ein Datum.';
    setMoveError(dateError ?? null);
    if (focusFirstInvalidField({ 'popover-move-date': dateError }) || !moveDate) return;
    moveToTarget({ job, row, rows, mutations }, moveRecordId, moveDate);
    onDone();
  };

  return (
    <form onSubmit={submitMove} className="mt-3 space-y-3 border-t pt-3" aria-label="Termin verschieben">
      <Field label="Datum" htmlFor="popover-move-date" required error={moveError ?? undefined}>
        <DatePicker
          id="popover-move-date"
          value={moveDate}
          onChange={(next) => {
            setMoveDate(next);
            setMoveError(null);
          }}
          ariaLabel="Neues Datum"
        />
      </Field>
      {rows.length > 0 && (
        <Field
          label="Mitarbeiter"
          htmlFor="popover-move-person"
          description={absencesNotLoadedHint(absences, moveDateIso)}
        >
          <SearchableSelect
            id="popover-move-person"
            value={moveRecordId}
            onChange={setMoveRecordId}
            options={rowOptions}
            placeholder="Ohne Zuweisung"
            allowNone
            noneLabel="Ohne Zuweisung"
            ariaLabel="Mitarbeiter"
            searchPlaceholder="Mitarbeiter suchen …"
            emptyMessage="Keine Mitarbeiter gefunden"
          />
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit" size="sm">
          Verschieben
        </Button>
      </div>
    </form>
  );
}
