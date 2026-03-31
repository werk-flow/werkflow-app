'use client';

import { useRef, useState, useEffect } from 'react';
import { X, Briefcase, ParkingSquare, GripVertical, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CalendarJob } from '@/lib/jobs/types';

export const PARKPLATZ_MIME = 'application/x-werkflow-job';

let _ghostEl: HTMLDivElement | null = null;
export function getDragGhost(): HTMLDivElement {
  if (!_ghostEl) {
    _ghostEl = document.createElement('div');
    _ghostEl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0.01;pointer-events:none;';
    document.body.appendChild(_ghostEl);
  }
  return _ghostEl;
}

export type DragJobPayload = {
  jobId: string;
  source: 'parkplatz' | 'day' | 'week' | 'month';
  sourceDate?: string;
  sourceTime?: string;
  sourceMemberId?: string;
  durationMinutes?: number;
};

const PRIORITY_COLORS: Record<string, string> = {
  hoch: 'bg-red-500/15 text-red-700 dark:text-red-400',
  mittel: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  niedrig: 'bg-green-500/15 text-green-700 dark:text-green-400',
};

const PRIORITY_LABELS: Record<string, string> = {
  hoch: 'Hoch',
  mittel: 'Mittel',
  niedrig: 'Niedrig',
};

interface ParkplatzPanelProps {
  jobs: CalendarJob[];
  onClose: () => void;
  memberNames: Record<string, string>;
  onParkJob?: (jobId: string) => void;
  onDragJobStart?: (job: CalendarJob) => void;
  onDragJobEnd?: () => void;
  isExternalDragOver?: boolean;
}

export function ParkplatzPanel({ jobs, onClose, memberNames, onParkJob, onDragJobStart, onDragJobEnd, isExternalDragOver }: ParkplatzPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [draggingJobId, setDraggingJobId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Clear draggingJobId when the job disappears from the list (e.g. optimistic unpark
  // removes the card from DOM before onDragEnd can fire)
  useEffect(() => {
    if (draggingJobId && !jobs.some(j => j.id === draggingJobId)) {
      setDraggingJobId(null);
      onDragJobEnd?.();
      document.body.classList.remove('is-dragging');
    }
  }, [jobs, draggingJobId, onDragJobEnd]);

  return (
    <div
      ref={panelRef}
      data-parkplatz-panel=""
      className={cn(
        'fixed right-0 top-0 bottom-0 z-40 w-80 bg-background border-l shadow-xl flex flex-col animate-in slide-in-from-right duration-200',
        (isDragOver || isExternalDragOver) && 'ring-2 ring-inset ring-brand-purple/50 border-l-brand-purple/40'
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PARKPLATZ_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setIsDragOver(true);
        }
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes(PARKPLATZ_MIME)) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        if (related && (e.currentTarget as HTMLElement).contains(related)) return;
        setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        document.body.classList.remove('is-dragging');
        const raw = e.dataTransfer.getData(PARKPLATZ_MIME);
        if (!raw || !onParkJob) return;
        try {
          const payload: DragJobPayload = JSON.parse(raw);
          if (payload.source !== 'parkplatz' && payload.jobId) {
            onParkJob(payload.jobId);
          }
        } catch { /* ignore parse errors */ }
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 sm:py-4 border-b shrink-0">
        <div className="flex items-center gap-2">
          <ParkingSquare className="size-5 text-brand-purple" />
          <h2 className="font-semibold text-base">Parkplatz</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            ({jobs.length})
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <ParkingSquare className="size-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">Keine geparkten Aufträge</p>
            <p className="text-xs mt-1">
              Ziehe Aufträge hierher, um sie zu parken.
            </p>
          </div>
        ) : (
          jobs.map((job) => {
            const isDragging = draggingJobId === job.id;
            return (
              <div
                key={job.id}
                draggable
                data-parkplatz-pill=""
                data-job-id={job.id}
                data-job-title={job.title}
                data-duration={String(job.estimatedDurationMinutes ?? 60)}
                className={cn(
                  'group relative rounded-lg border bg-card p-3 cursor-grab active:cursor-grabbing transition-all hover:shadow-md',
                  'hover:border-brand-purple/40',
                  isDragging && 'opacity-50 scale-[0.97] shadow-none border-brand-purple/30'
                )}
                onDragStart={(e) => {
                  const payload: DragJobPayload = {
                    jobId: job.id,
                    source: 'parkplatz',
                    durationMinutes: job.estimatedDurationMinutes ?? 60,
                  };
                  e.dataTransfer.setData(PARKPLATZ_MIME, JSON.stringify(payload));
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setDragImage(getDragGhost(), 0, 0);
                  setDraggingJobId(job.id);
                  onDragJobStart?.(job);
                  document.body.classList.add('is-dragging');
                }}
                onDragEnd={() => {
                  setDraggingJobId(null);
                  onDragJobEnd?.();
                  document.body.classList.remove('is-dragging');
                }}
              >
                {/* Detail page link icon — hidden during drag */}
                {!isDragging && job.jobNumber && (
                  <Link
                    href={`/auftraege/${job.jobNumber}`}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-all z-10"
                    title="Auftragsdetails öffnen"
                  >
                    <ExternalLink className="size-3.5" />
                  </Link>
                )}

                <div className="flex items-start gap-2">
                  <GripVertical className="size-4 mt-0.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground/70 transition-colors" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Briefcase className="size-3.5 shrink-0 text-brand-purple" />
                      <span className="font-medium text-sm truncate">{job.title}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {job.jobNumber && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {job.jobNumber}
                        </span>
                      )}
                      <span className={cn(
                        'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                        PRIORITY_COLORS[job.priority] ?? PRIORITY_COLORS.mittel
                      )}>
                        {PRIORITY_LABELS[job.priority] ?? job.priority}
                      </span>
                    </div>
                    {job.clientName && (
                      <p className="text-[11px] text-muted-foreground mt-1 truncate">
                        {job.clientName}
                      </p>
                    )}
                    {job.assignedUserIds.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {job.assignedUserIds.slice(0, 3).map((uid) => (
                          <span
                            key={uid}
                            className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full truncate max-w-[100px]"
                          >
                            {memberNames[uid] ?? uid.slice(0, 8)}
                          </span>
                        ))}
                        {job.assignedUserIds.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{job.assignedUserIds.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
