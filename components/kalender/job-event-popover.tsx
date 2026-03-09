'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Briefcase,
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
    label: 'Offen',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  },
  in_bearbeitung: {
    label: 'In Bearbeitung',
    className:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
  },
  fertig: {
    label: 'Fertig',
    className:
      'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
  }
};

const PRIORITY_LABELS: Record<string, { label: string; className: string }> = {
  niedrig: {
    label: 'Niedrig',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
  },
  mittel: {
    label: 'Mittel',
    className:
      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
  },
  hoch: {
    label: 'Hoch',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
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
  const [adjustedPos, setAdjustedPos] = useState(position);

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

    setAdjustedPos({ x, y });
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
      className="fixed z-50 w-72 rounded-lg border bg-background p-4 shadow-xl animate-in fade-in-0 zoom-in-95"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{job.title}</p>
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
            <Briefcase className="size-3.5 shrink-0" />
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
