'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, Building2, CalendarDays, Clock, ExternalLink, MapPin, MoveRight, ParkingSquare, Repeat2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn, toLocalDateString } from '@/lib/utils';
import type { CalendarJob } from '@/lib/jobs/types';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import { reassignmentChanges } from '@/lib/calendar/board-model';
import { formatRefusalDate } from '@/lib/calendar/messages';
import { checkOccurrenceMovable, checkParkable } from '@/lib/calendar/refusal-checks';
import { PLANNING_OCCURRENCE_STATUS_LABELS } from '@/lib/planning/types';
import { PlanningOccurrenceEditDialog } from './planning-occurrence-edit-dialog';
import type { CalendarMutations } from './mutations/use-calendar-mutations';
import { moveSuccessMessage } from './board/use-board-surface';

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  nicht_bearbeitet: { label: 'Nicht bearbeitet', className: 'bg-secondary text-secondary-foreground' },
  in_bearbeitung: { label: 'In Bearbeitung', className: 'bg-warning-soft text-warning-soft-foreground' },
  fertig: { label: 'Fertig', className: 'bg-success-soft text-success-soft-foreground' },
};

const PRIORITY_LABELS: Record<string, { label: string; className: string }> = {
  niedrig: { label: 'Niedrig', className: 'bg-secondary text-secondary-foreground' },
  mittel: { label: 'Mittel', className: 'bg-info-soft text-info-soft-foreground' },
  hoch: { label: 'Hoch', className: 'bg-destructive-soft text-destructive-soft-foreground' },
};

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

function CardPopover({ card, onClose, memberNames, canEditPlanning, rows, mutations, onPark }: JobEventPopoverProps & { card: OpenCard }) {
  const router = useRouter();
  const { job, row } = card;
  const [editOpen, setEditOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const virtualRef = useMemo(() => ({ current: card.anchor }), [card.anchor]);
  const statusInfo = STATUS_LABELS[job.status] ?? STATUS_LABELS.nicht_bearbeitet;
  const priorityInfo = PRIORITY_LABELS[job.priority] ?? PRIORITY_LABELS.mittel;
  const inactiveStatusLabel = job.occurrenceStatus ? PLANNING_OCCURRENCE_STATUS_LABELS[job.occurrenceStatus] : undefined;
  const jobUrl = job.jobNumber ? (job.projectNumber ? `/auftraege/projekt/${job.projectNumber}/${job.jobNumber}` : `/auftraege/${job.jobNumber}`) : null;
  const movable = canEditPlanning && mutations !== null && checkOccurrenceMovable(job).ok;
  const parkable = canEditPlanning && onPark !== null && checkParkable(job).ok;

  const close = () => {
    const anchor = card.anchor;
    onClose();
    requestAnimationFrame(() => { if (anchor.isConnected) anchor.focus(); });
  };

  return (
    <Popover open onOpenChange={(open) => { if (!open && !editOpen) close(); }}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={16} className="w-80 max-w-[calc(100vw-1.5rem)] p-4 shadow-xl" data-job-popover="" onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>('button, a')?.focus(); }}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-3 break-words font-semibold" title={job.title}>{job.title}</p>
            {job.jobNumber && <p className="text-xs text-muted-foreground">{job.jobNumber}</p>}
          </div>
          <button type="button" aria-label="Terminübersicht schließen" onClick={close} className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {inactiveStatusLabel ? (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{inactiveStatusLabel}</span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-calendar-planning px-2 py-0.5 text-xs font-medium text-calendar-planning-foreground">Geplant</span>
          )}
          {job.seriesId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><Repeat2 className="size-3" aria-hidden="true" /> Serie</span>
          )}
          {job.entryKind !== 'internal' && (
            <>
              <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', statusInfo?.className)}>{statusInfo?.label}</span>
              <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', priorityInfo?.className)}>{priorityInfo?.label}</span>
            </>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            {job.entryKind === 'internal' ? <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" /> : <Clock className="size-3.5 shrink-0" aria-hidden="true" />}
            <span>
              {job.entryKind === 'internal' ? 'Interner Termin' : 'Geplanter Auftragsbesuch'}
              {job.plannedDate ? ` · ${formatRefusalDate(job.plannedDate)}` : ''}
              {job.plannedTime ? ` ${job.plannedTime}` : ''}
              {job.isException ? ' · angepasster Einzeltermin' : ''}
            </span>
          </div>
          {job.clientName && <div className="flex items-center gap-2 text-muted-foreground"><Building2 className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{job.clientName}</span></div>}
          {job.projectName && <div className="flex items-center gap-2 text-muted-foreground"><Briefcase className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">Projekt: {job.projectName}{job.projectNumber && ` (${job.projectNumber})`}</span></div>}
          {job.location && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{job.location}</span></div>}
          {job.assignedUserIds.length > 0 && (
            <div className="flex items-start gap-2 text-muted-foreground"><Users className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{job.assignedUserIds.map((userId) => memberNames[userId] ?? 'Mitarbeiter').join(', ')}</span></div>
          )}
        </div>

        {moving && mutations ? (
          <MoveForm job={job} row={row} rows={rows} mutations={mutations} onDone={onClose} onCancel={() => setMoving(false)} />
        ) : (
          <div className="mt-3 grid gap-2">
            {canEditPlanning && job.occurrenceId && !inactiveStatusLabel && (
              <Button variant="default" size="sm" onClick={() => setEditOpen(true)}>Termin bearbeiten</Button>
            )}
            {movable && (
              <Button variant="outline" size="sm" onClick={() => setMoving(true)}><MoveRight className="mr-2 size-3.5" aria-hidden="true" />Verschieben …</Button>
            )}
            {parkable && onPark && (
              <Button variant="outline" size="sm" onClick={() => { onClose(); onPark(job); }}><ParkingSquare className="mr-2 size-3.5" aria-hidden="true" />Parken</Button>
            )}
            {jobUrl && (
              <Button variant="outline" size="sm" className="w-full" onClick={() => { onClose(); router.push(jobUrl); }}><ExternalLink className="mr-2 size-3.5" aria-hidden="true" />Details anzeigen</Button>
            )}
          </div>
        )}
        {job.occurrenceId && (
          <PlanningOccurrenceEditDialog job={job} open={editOpen} onOpenChange={setEditOpen} onSuccess={close} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function MoveForm({ job, row, rows, mutations, onDone, onCancel }: { job: CalendarJob; row: CalendarBoardRow | null; rows: readonly CalendarBoardRow[]; mutations: CalendarMutations; onDone: () => void; onCancel: () => void }) {
  const [moveDate, setMoveDate] = useState<Date | undefined>(() => (job.plannedDate ? new Date(`${job.plannedDate}T12:00:00`) : undefined));
  const [moveRecordId, setMoveRecordId] = useState(row?.employeeRecordId ?? '');
  const [moveError, setMoveError] = useState<string | null>(null);
  const rowOptions = rows.map((entry) => ({ value: entry.employeeRecordId, label: entry.displayName }));

  const submitMove = (event: React.FormEvent) => {
    event.preventDefault();
    if (!moveDate) { setMoveError('Bitte wähle ein Datum.'); return; }
    const targetRow = rows.find((entry) => entry.employeeRecordId === moveRecordId) ?? null;
    const target = { employeeRecordId: targetRow?.employeeRecordId ?? null, userId: targetRow?.userId ?? null, date: toLocalDateString(moveDate) };
    const changes = reassignmentChanges({ job, sourceEmployeeRecordId: row?.employeeRecordId ?? null, sourceUserId: row?.userId ?? null, target });
    if (!changes) { onDone(); return; }
    const targetName = targetRow?.displayName ?? 'Ohne Zuweisung';
    const dateLabel = formatRefusalDate(target.date);
    void mutations.moveJob({ job, changes, successMessage: moveSuccessMessage(changes, targetName, dateLabel), context: { name: targetName, date: dateLabel } });
    onDone();
  };

  return (
    <form onSubmit={submitMove} className="mt-3 space-y-3 border-t pt-3" aria-label="Termin verschieben">
      <Field label="Datum" htmlFor="popover-move-date" required error={moveError ?? undefined}>
        <DatePicker id="popover-move-date" value={moveDate} onChange={(next) => { setMoveDate(next); setMoveError(null); }} ariaLabel="Neues Datum" />
      </Field>
      {rows.length > 0 && (
        <Field label="Mitarbeiter" htmlFor="popover-move-person">
          <SearchableSelect id="popover-move-person" value={moveRecordId} onChange={setMoveRecordId} options={rowOptions} placeholder="Ohne Zuweisung" allowNone noneLabel="Ohne Zuweisung" ariaLabel="Mitarbeiter" searchPlaceholder="Mitarbeiter suchen …" emptyMessage="Keine Mitarbeiter gefunden" />
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Abbrechen</Button>
        <Button type="submit" size="sm">Verschieben</Button>
      </div>
    </form>
  );
}
