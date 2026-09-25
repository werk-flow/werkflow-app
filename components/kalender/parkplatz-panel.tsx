'use client';

import { useEffect, useRef } from 'react';
import { Briefcase, CalendarPlus, ExternalLink, NotebookPen, ParkingSquare, Send, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CalendarJob } from '@/lib/jobs/types';
import { PARKING_REASON_LABELS, type JobParkingContext } from '@/lib/parking/types';
import { formatRefusalDate } from '@/lib/calendar/messages';
import { useCalendarDrag } from './drag-engine/drag-engine';
import { CALENDAR_LAYER_CLASS } from './surface/layers';

const PRIORITY_CLASS: Record<string, string> = {
  hoch: 'bg-destructive-soft text-destructive-soft-foreground',
  mittel: 'bg-warning-soft text-warning-soft-foreground',
  niedrig: 'bg-success-soft text-success-soft-foreground',
};

const PRIORITY_LABELS: Record<string, string> = { hoch: 'Hoch', mittel: 'Mittel', niedrig: 'Niedrig' };

interface ParkplatzPanelProps {
  jobs: CalendarJob[];
  onClose: () => void;
  memberNames: Record<string, string>;
  /** null until the first successful load, so a missing context stays distinguishable. */
  parkingContexts: ReadonlyMap<string, JobParkingContext> | null;
  onEditContext: (job: CalendarJob) => void;
  onDispatchJob: (job: CalendarJob) => void;
  /** Keyboard alternative to the drag: the schedule dialog for this parked job. */
  onScheduleJob: (job: CalendarJob) => void;
  readOnly: boolean;
}

/**
 * The Parkplatz on the shared engine (P1-24a, criterion 24): every card is
 * a focusable drag source, the panel is a drop zone, and „Einplanen am …"
 * is the keyboard route back onto the calendar. On a desktop the panel sits
 * beside the calendar and narrows it, so every column stays a drop target;
 * on a phone it covers the list.
 */
export function ParkplatzPanel({ jobs, onClose, memberNames, parkingContexts, onEditContext, onDispatchJob, onScheduleJob, readOnly }: ParkplatzPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { registerDropZone, startDrag } = useCalendarDrag();

  useEffect(() => {
    const element = panelRef.current;
    if (!element) return;
    return registerDropZone({ zone: 'parkplatz', element });
  }, [registerDropZone]);

  useEffect(() => {
    // Escape closes the panel unless a dialog above it owns the key.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside
      ref={panelRef}
      data-parkplatz-panel=""
      aria-label="Parkplatz"
      className={cn('flex w-80 max-w-full shrink-0 flex-col border-l bg-background animate-in slide-in-from-right duration-200 max-sm:fixed max-sm:inset-y-0 max-sm:right-0 max-sm:shadow-xl', CALENDAR_LAYER_CLASS.panel)}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <ParkingSquare className="size-5 text-brand-purple" aria-hidden="true" />
          <h2 className="text-base font-semibold">Parkplatz</h2>
          <span className="text-xs tabular-nums text-muted-foreground">({jobs.length})</span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Parkplatz schließen">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <ParkingSquare className="mb-3 size-10 opacity-30" aria-hidden="true" />
            <p className="text-sm font-medium">Keine geparkten Aufträge</p>
            <p className="mt-1 text-xs">Ziehe Aufträge hierher, um sie zu parken.</p>
          </div>
        ) : (
          jobs.map((job) => {
            const context = parkingContexts?.get(job.jobId ?? job.id) ?? null;
            return (
              <div
                key={job.id}
                data-parkplatz-card=""
                data-job-id={job.id}
                className={cn('group relative rounded-lg border bg-card p-3 shadow-xs transition-colors hover:border-brand-purple/40', !readOnly && 'cursor-grab active:cursor-grabbing')}
                onPointerDown={(event) => {
                  // In read-only mode the engine's lock notice answers the press; the card stays put.
                  if ((event.target as HTMLElement).closest('a, button')) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  startDrag(event, {
                    payload: { kind: 'parked', job },
                    ghost: { label: job.title, secondary: job.clientName ?? undefined, width: 220, height: 40 },
                    pointerOffset: { x: Math.min(event.clientX - rect.left, 220), y: Math.min(event.clientY - rect.top, 40) },
                  });
                }}
              >
                {job.jobNumber && (
                  <Link
                    href={`/auftraege/${job.jobNumber}`}
                    className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    title="Auftragsdetails öffnen"
                    aria-label={`Auftragsdetails für ${job.title} öffnen`}
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </Link>
                )}
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Briefcase className="size-3.5 shrink-0 text-brand-purple" aria-hidden="true" />
                    <span className="line-clamp-2 break-words text-sm font-medium" title={job.title}>{job.title}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {job.jobNumber && <span className="font-mono text-[10px] text-muted-foreground">{job.jobNumber}</span>}
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', PRIORITY_CLASS[job.priority] ?? PRIORITY_CLASS.mittel)}>
                      {PRIORITY_LABELS[job.priority] ?? job.priority}
                    </span>
                  </div>
                  {job.clientName && <p className="mt-1 truncate text-[11px] text-muted-foreground">{job.clientName}</p>}
                  {job.assignedUserIds.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {job.assignedUserIds.slice(0, 3).map((userId) => (
                        <span key={userId} className="max-w-[100px] truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{memberNames[userId] ?? 'Mitarbeiter'}</span>
                      ))}
                      {job.assignedUserIds.length > 3 && <span className="text-[10px] text-muted-foreground">+{job.assignedUserIds.length - 3}</span>}
                    </div>
                  )}
                  {parkingContexts && (
                    <div className="mt-1.5 space-y-0.5" data-parking-context={context ? 'set' : 'missing'}>
                      {context ? (
                        <>
                          <p className="text-[11px] text-muted-foreground">
                            {PARKING_REASON_LABELS[context.reason]}
                            {context.note ? ` · ${context.note}` : ''}
                          </p>
                          {(context.responsibleName || context.nextReviewDate) && (
                            <p className="text-[11px] tabular-nums text-muted-foreground">
                              {context.responsibleName ? `Zuständig: ${context.responsibleName}` : ''}
                              {context.responsibleName && context.nextReviewDate ? ' · ' : ''}
                              {context.nextReviewDate ? `Wiedervorlage: ${formatRefusalDate(context.nextReviewDate)}` : ''}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-[11px] italic text-muted-foreground">Kontext fehlt (Altbestand)</p>
                      )}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!readOnly && context && (
                      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" aria-label={`${job.title} einplanen`} onClick={() => onScheduleJob(job)}>
                        <CalendarPlus className="size-3" aria-hidden="true" />
                        Einplanen am …
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" aria-label={`Parkplatz-Kontext für ${job.title} ${context ? 'bearbeiten' : 'ergänzen'}`} onClick={() => onEditContext(job)}>
                      <NotebookPen className="size-3" aria-hidden="true" />
                      {context ? 'Kontext bearbeiten' : 'Kontext ergänzen'}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" aria-label={`Einsatz für ${job.title} senden`} onClick={() => onDispatchJob(job)}>
                      <Send className="size-3" aria-hidden="true" />
                      Einsatz senden
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
