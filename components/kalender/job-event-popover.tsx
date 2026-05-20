'use client';

import { useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Briefcase,
  Building2,
  MapPin,
  Users,
  ExternalLink,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CalendarJob } from '@/lib/jobs/types';

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  nicht_bearbeitet: {
    label: 'Nicht bearbeitet',
    className: 'bg-secondary text-secondary-foreground'
  },
  in_bearbeitung: {
    label: 'In Bearbeitung',
    className:
      'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
  },
  fertig: {
    label: 'Fertig',
    className:
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
  }
};

const PRIORITY_LABELS: Record<string, { label: string; className: string }> = {
  niedrig: {
    label: 'Niedrig',
    className: 'bg-secondary text-secondary-foreground'
  },
  mittel: {
    label: 'Mittel',
    className:
      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
  },
  hoch: {
    label: 'Hoch',
    className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
  }
};

interface JobEventPopoverProps {
  job: CalendarJob;
  position: { x: number; y: number };
  onClose: () => void;
  memberNames?: Record<string, string>;
}

export function JobEventPopover({
  job,
  position,
  onClose,
  memberNames = {}
}: JobEventPopoverProps) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > vw - 16) x = vw - rect.width - 16;
    if (x < 16) x = 16;
    if (y + rect.height > vh - 16) y = position.y - rect.height - 8;
    if (y < 16) y = 16;

    ref.current.style.left = `${x}px`;
    ref.current.style.top = `${y}px`;
  }, [position]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const statusInfo = STATUS_LABELS[job.status] ?? STATUS_LABELS.nicht_bearbeitet;
  const priorityInfo = PRIORITY_LABELS[job.priority] ?? PRIORITY_LABELS.mittel;

  const jobUrl = job.projectNumber
    ? `/auftraege/projekt/${job.projectNumber}/${job.jobNumber}`
    : `/auftraege/${job.jobNumber}`;

  return (
    <div
      ref={ref}
      className="fixed z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-4 shadow-xl animate-in fade-in-0 zoom-in-95"
      style={{ left: position.x, top: position.y }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold line-clamp-3 break-words" title={job.title}>
            {job.title}
          </p>
          {job.jobNumber && (
            <p className="text-xs text-muted-foreground">{job.jobNumber}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-0.5 hover:bg-accent transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            statusInfo.className
          )}
        >
          {statusInfo.label}
        </span>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            priorityInfo.className
          )}
        >
          {priorityInfo.label}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        {job.clientName && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" />
            <span className="truncate">{job.clientName}</span>
          </div>
        )}

        {job.projectName && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Briefcase className="size-3.5 shrink-0" />
            <span className="truncate">
              Projekt: {job.projectName}
              {job.projectNumber && ` (${job.projectNumber})`}
            </span>
          </div>
        )}

        {job.location && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{job.location}</span>
          </div>
        )}

        {job.assignedUserIds.length > 0 && (
          <div className="flex items-start gap-2 text-muted-foreground">
            <Users className="size-3.5 shrink-0 mt-0.5" />
            <span className="truncate">
              {job.assignedUserIds
                .map((uid) => memberNames[uid] ?? 'Mitarbeiter')
                .join(', ')}
            </span>
          </div>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        onClick={() => {
          onClose();
          router.push(jobUrl);
        }}
      >
        <ExternalLink className="mr-2 size-3.5" />
        Details anzeigen
      </Button>
    </div>
  );
}
