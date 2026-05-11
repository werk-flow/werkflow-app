'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Briefcase,
  Check,
  Clock,
  Coffee,
  ExternalLink,
  Info,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  User,
  X
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TimeInput } from '@/components/ui/time-input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time-tracking/helpers';
import {
  addManualEntry,
  deleteEntriesBatch,
  deleteEntry,
  reviewEntry,
  updateEntry
} from '@/lib/time-tracking/actions';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type {
  InteractiveCalendarSession,
  TimeEntry,
  WorkSession,
  WorkSessionBreak
} from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';

interface EntryDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkSession;
  currentUserRole: OrgRole;
  currentUserId?: string;
  onRefresh: () => void;
  startInEditMode?: boolean;
  jobName?: string | null;
  entryUserRole?: OrgRole;
}

type EditableBreak = {
  key: string;
  breakStartEntry: TimeEntry | null;
  breakEndEntry: TimeEntry | null;
  breakStart: Date;
  breakEnd: Date | null;
  isNew?: boolean;
};

type StatusConfig = { label: string; className: string };

const STATUS_LABELS: Record<string, StatusConfig> = {
  approved: {
    label: 'Genehmigt',
    className: 'bg-green-500/20 text-green-700 dark:text-green-300'
  },
  pending: {
    label: 'Ausstehend',
    className: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300'
  },
  rejected: {
    label: 'Abgelehnt',
    className: 'bg-red-500/20 text-red-700 dark:text-red-300'
  },
  draft: {
    label: 'Neu',
    className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
  }
};

function formatDateTime(date: Date): string {
  return date.toLocaleString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

function formatActionError(error: string): string {
  if (error === 'pending_request_exists') {
    return 'Es gibt bereits einen ausstehenden Änderungsantrag für diesen Eintrag.';
  }

  if (
    error === 'overlapping_entries' ||
    error === 'overlapping_session' ||
    error === 'validation_failed'
  ) {
    return 'Diese Zeitänderung würde zu einer ungültigen oder überlappenden Arbeitszeit führen.';
  }

  return error;
}

function sortTimeEntries(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => {
    const diff =
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (diff !== 0) return diff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function deriveBreaksFromEntries(entries: TimeEntry[]): WorkSessionBreak[] {
  const breaks: WorkSessionBreak[] = [];
  let currentBreakStart: TimeEntry | null = null;

  for (const entry of sortTimeEntries(entries)) {
    if (entry.entryType === 'break_start') {
      currentBreakStart = entry;
      continue;
    }

    if (
      currentBreakStart &&
      (entry.entryType === 'break_end' || entry.entryType === 'clock_out')
    ) {
      breaks.push({
        breakStart: currentBreakStart,
        breakEnd: entry.entryType === 'break_end' ? entry : null
      });
      currentBreakStart = null;
    }
  }

  if (currentBreakStart) {
    breaks.push({
      breakStart: currentBreakStart,
      breakEnd: null
    });
  }

  return breaks;
}

function buildEditableBreaks(breaks: WorkSessionBreak[]): EditableBreak[] {
  return breaks.map((workBreak, index) => ({
    key: `${workBreak.breakStart.id}:${workBreak.breakEnd?.id ?? index}`,
    breakStartEntry: workBreak.breakStart,
    breakEndEntry: workBreak.breakEnd,
    breakStart: new Date(workBreak.breakStart.timestamp),
    breakEnd: workBreak.breakEnd ? new Date(workBreak.breakEnd.timestamp) : null
  }));
}

function getBreakDurationMinutes(workBreak: {
  breakStart: Date;
  breakEnd: Date | null;
}): number {
  const breakEnd = workBreak.breakEnd ?? new Date();
  return Math.max(
    0,
    (breakEnd.getTime() - workBreak.breakStart.getTime()) / 60000
  );
}

function applyDatePart(base: Date, dateSource: Date): Date {
  const updated = new Date(base);
  updated.setFullYear(
    dateSource.getFullYear(),
    dateSource.getMonth(),
    dateSource.getDate()
  );
  return updated;
}

function buildDefaultBreakRange(start: Date, end: Date) {
  const totalMinutes = Math.max(1, (end.getTime() - start.getTime()) / 60000);
  const desiredBreakMinutes = Math.min(
    30,
    Math.max(5, Math.floor(totalMinutes / 3))
  );
  const centerMs = start.getTime() + (end.getTime() - start.getTime()) / 2;
  const breakStart = new Date(centerMs - desiredBreakMinutes * 30000);
  const breakEnd = new Date(breakStart.getTime() + desiredBreakMinutes * 60000);

  if (breakStart <= start) {
    breakStart.setTime(start.getTime() + 5 * 60000);
    breakEnd.setTime(
      Math.min(
        end.getTime() - 5 * 60000,
        breakStart.getTime() + desiredBreakMinutes * 60000
      )
    );
  }

  if (breakEnd >= end) {
    breakEnd.setTime(end.getTime() - 5 * 60000);
    breakStart.setTime(
      Math.max(
        start.getTime() + 5 * 60000,
        breakEnd.getTime() - desiredBreakMinutes * 60000
      )
    );
  }

  return { breakStart, breakEnd };
}

function getStatusConfig(entry?: TimeEntry | null): StatusConfig {
  if (!entry) return STATUS_LABELS.draft;
  return STATUS_LABELS[entry.status] ?? STATUS_LABELS.approved;
}

function getEntryLabel(entry: TimeEntry, index = 0): string {
  switch (entry.entryType) {
    case 'clock_in':
      return 'Arbeitsbeginn';
    case 'clock_out':
      return 'Arbeitsende';
    case 'break_start':
      return index > 0 ? `Pausenbeginn ${index + 1}` : 'Pausenbeginn';
    case 'break_end':
      return index > 0 ? `Pausenende ${index + 1}` : 'Pausenende';
    default:
      return 'Eintrag';
  }
}

function buildDraftEntry(
  key: string,
  entryType: TimeEntry['entryType'],
  timestamp: Date,
  userId?: string,
  organizationId?: string
): TimeEntry {
  const isoTimestamp = timestamp.toISOString();

  return {
    id: key,
    userId: userId ?? '',
    organizationId: organizationId ?? '',
    entryType,
    timestamp: isoTimestamp,
    isManual: true,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp
  };
}

interface DateTimePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  label: string;
  dateLabel?: string;
  disableDateEditing?: boolean;
}

function DateTimePicker({
  value,
  onChange,
  label,
  dateLabel,
  disableDateEditing = false
}: DateTimePickerProps) {
  const [timeValue, setTimeValue] = useState(formatTime(value));

  useEffect(() => {
    setTimeValue(formatTime(value));
  }, [value]);

  const handleDateChange = (newDate: Date | undefined) => {
    if (!newDate) return;
    const updated = new Date(value);
    updated.setFullYear(newDate.getFullYear());
    updated.setMonth(newDate.getMonth());
    updated.setDate(newDate.getDate());
    onChange(updated);
  };

  const handleTimeChange = (newTime: string) => {
    setTimeValue(newTime);
    const [hours, minutes] = newTime.split(':').map(Number);
    if (!isNaN(hours) && !isNaN(minutes)) {
      const newDate = new Date(value);
      newDate.setHours(hours);
      newDate.setMinutes(minutes);
      onChange(newDate);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <div className="flex-1">
          {disableDateEditing ? (
            <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
              {dateLabel ?? value.toLocaleDateString('de-DE')}
            </div>
          ) : (
            <DatePicker value={value} onChange={handleDateChange} />
          )}
        </div>
        <div className="relative w-28">
          <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
          <TimeInput
            value={timeValue}
            onChange={handleTimeChange}
            className="pl-10 pr-2"
          />
        </div>
      </div>
    </div>
  );
}

function DetailCard({
  icon,
  label,
  value,
  onClick,
  disabled
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const interactive = !!onClick && !disabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={cn(
        'flex w-full items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-left text-sm transition-colors',
        interactive && 'cursor-pointer hover:bg-accent'
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
      {interactive && (
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

export function EntryDetailsDialog({
  open,
  onOpenChange,
  session,
  currentUserRole,
  currentUserId,
  onRefresh,
  startInEditMode = false,
  jobName,
  entryUserRole
}: EntryDetailsDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(startInEditMode);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editedClockIn, setEditedClockIn] = useState<Date | null>(null);
  const [editedClockOut, setEditedClockOut] = useState<Date | null>(null);
  const [editedBreaks, setEditedBreaks] = useState<EditableBreak[]>([]);
  const [removedBreaks, setRemovedBreaks] = useState<EditableBreak[]>([]);
  const [editedBlockDate, setEditedBlockDate] = useState<Date | null>(null);

  const router = useRouter();
  const interactiveSession = session as InteractiveCalendarSession;
  const [resolvedJob, setResolvedJob] = useState<{
    title: string;
    jobNumber: string | null;
    projectNumber: string | null;
  } | null>(
    jobName ? { title: jobName, jobNumber: null, projectNumber: null } : null
  );

  const sourceEntries = useMemo(() => {
    if (interactiveSession.sourceEntries?.length) {
      return sortTimeEntries(interactiveSession.sourceEntries);
    }

    return sortTimeEntries(
      [session.clockIn, session.clockOut].filter(Boolean) as TimeEntry[]
    );
  }, [interactiveSession.sourceEntries, session.clockIn, session.clockOut]);

  const sessionBreaks = useMemo(() => {
    if (interactiveSession.breaks?.length) {
      return interactiveSession.breaks;
    }

    return deriveBreaksFromEntries(sourceEntries);
  }, [interactiveSession.breaks, sourceEntries]);

  const actualClockOutEntry = useMemo(() => {
    return (
      [...sourceEntries]
        .reverse()
        .find((entry) => entry.entryType === 'clock_out') ?? null
    );
  }, [sourceEntries]);

  const startEntry = session.clockIn ?? null;
  const clockInTimestamp = startEntry?.timestamp ?? null;
  const clockOutTimestamp = actualClockOutEntry?.timestamp ?? null;
  const clockInDate = useMemo(
    () => (clockInTimestamp ? new Date(clockInTimestamp) : null),
    [clockInTimestamp]
  );
  const clockOutDate = useMemo(
    () => (clockOutTimestamp ? new Date(clockOutTimestamp) : null),
    [clockOutTimestamp]
  );
  const sessionBreakSignature = useMemo(
    () =>
      sessionBreaks
        .map(
          (workBreak) =>
            `${workBreak.breakStart.id}:${workBreak.breakStart.timestamp}:${
              workBreak.breakEnd?.id ?? 'open'
            }:${workBreak.breakEnd?.timestamp ?? 'open'}`
        )
        .join('|'),
    [sessionBreaks]
  );

  const sessionEntriesForReview = useMemo(
    () =>
      sourceEntries.filter(
        (entry, index, entries) =>
          entries.findIndex((candidate) => candidate.id === entry.id) === index
      ),
    [sourceEntries]
  );
  const blockReferenceDate = useMemo(
    () =>
      clockInDate ??
      clockOutDate ??
      (sessionBreaks[0]
        ? new Date(sessionBreaks[0].breakStart.timestamp)
        : null),
    [clockInDate, clockOutDate, sessionBreaks]
  );

  useEffect(() => {
    if (!open || !session.jobId) {
      if (!jobName) setResolvedJob(null);
      return;
    }

    let cancelled = false;
    createSupabaseBrowserClient()
      .from('jobs')
      .select('title, job_number, projects(project_number)')
      .eq('id', session.jobId)
      .single()
      .then(
        ({
          data
        }: {
          data: {
            title: string;
            job_number: string | null;
            projects: { project_number: string } | null;
          } | null;
        }) => {
          if (!cancelled && data) {
            setResolvedJob({
              title: data.title,
              jobNumber: data.job_number,
              projectNumber: data.projects?.project_number ?? null
            });
          }
        }
      );

    return () => {
      cancelled = true;
    };
  }, [jobName, open, session.jobId]);

  useEffect(() => {
    if (!open) return;

    setIsEditing(startInEditMode);
    setError(null);
    setSuccessMessage(null);
    setEditedClockIn(clockInTimestamp ? new Date(clockInTimestamp) : null);
    setEditedClockOut(clockOutTimestamp ? new Date(clockOutTimestamp) : null);
    setEditedBreaks(buildEditableBreaks(sessionBreaks));
    setRemovedBreaks([]);
    setEditedBlockDate(
      blockReferenceDate ? new Date(blockReferenceDate) : null
    );
  }, [
    blockReferenceDate,
    clockInTimestamp,
    clockOutTimestamp,
    open,
    sessionBreakSignature,
    startInEditMode
  ]);

  const jobDetailUrl = resolvedJob?.jobNumber
    ? resolvedJob.projectNumber
      ? `/auftraege/projekt/${resolvedJob.projectNumber}/${resolvedJob.jobNumber}`
      : `/auftraege/${resolvedJob.jobNumber}`
    : null;

  const employeeName = interactiveSession.employeeName ?? null;
  const effectiveEntryUserRole =
    interactiveSession.employeeRole ?? entryUserRole;
  const entryUserId =
    sourceEntries[0]?.userId ??
    session.clockIn?.userId ??
    session.clockOut?.userId;
  const entryOrganizationId =
    sourceEntries[0]?.organizationId ??
    session.clockIn?.organizationId ??
    session.clockOut?.organizationId ??
    null;
  const employeeDetailUrl = entryUserId ? `/mitarbeiter/${entryUserId}` : null;
  const isOwnEntry = currentUserId && entryUserId === currentUserId;
  const isOrphan = session.isOrphan || !session.clockIn;
  const hasActualBreaks = editedBreaks.length > 0;
  const totalBreakMinutes = useMemo(
    () =>
      editedBreaks.reduce(
        (total, workBreak) => total + getBreakDurationMinutes(workBreak),
        0
      ),
    [editedBreaks]
  );
  const totalWorkMinutes = useMemo(() => {
    const blockStart = editedClockIn ?? clockInDate;
    const blockEnd =
      editedClockOut ?? clockOutDate ?? (blockStart ? new Date() : null);

    if (!blockStart || !blockEnd) {
      return null;
    }

    const totalMinutes = Math.max(
      0,
      (blockEnd.getTime() - blockStart.getTime()) / 60000
    );
    return Math.max(0, totalMinutes - totalBreakMinutes);
  }, [
    editedClockIn,
    editedClockOut,
    clockInDate,
    clockOutDate,
    totalBreakMinutes
  ]);

  const canEdit = (() => {
    if (currentUserRole === 'admin') return true;
    if (currentUserRole === 'buero') {
      if (isOwnEntry) return true;
      if (effectiveEntryUserRole && effectiveEntryUserRole !== 'employee') {
        return false;
      }
      return true;
    }
    return false;
  })();

  const pendingEntries = sessionEntriesForReview.filter(
    (entry) => entry.status === 'pending'
  );
  const hasPendingEntry = pendingEntries.length > 0;
  const isActiveBlock = !isOrphan && !actualClockOutEntry;
  const showBlockScopedTotalHint = !isOrphan;
  const showBoundaryExplanation =
    !isOrphan &&
    !actualClockOutEntry &&
    !interactiveSession.isOnBreakBlock &&
    (session.endEntryType === 'break_start' || session.clockOut !== null);
  const canApprove =
    hasPendingEntry &&
    (currentUserRole === 'admin' ||
      (currentUserRole === 'buero' && !isOwnEntry && canEdit));

  const getDescriptionText = () => {
    if (isOrphan) {
      if (session.clockIn && !session.clockOut) {
        return 'Einzelner Einstempel-Eintrag (unvollständig)';
      }

      return 'Einzelner Ausstempel-Eintrag (unvollständig)';
    }

    if (session.durationMinutes) {
      return `Arbeitszeit: ${formatDuration(session.durationMinutes)}`;
    }

    return 'Aktive Sitzung';
  };

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditedClockIn(clockInDate ? new Date(clockInDate) : null);
    setEditedClockOut(clockOutDate ? new Date(clockOutDate) : null);
    setEditedBreaks(buildEditableBreaks(sessionBreaks));
    setRemovedBreaks([]);
    setEditedBlockDate(
      blockReferenceDate ? new Date(blockReferenceDate) : null
    );
    setError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedClockIn(clockInDate ? new Date(clockInDate) : null);
    setEditedClockOut(clockOutDate ? new Date(clockOutDate) : null);
    setEditedBreaks(buildEditableBreaks(sessionBreaks));
    setRemovedBreaks([]);
    setEditedBlockDate(
      blockReferenceDate ? new Date(blockReferenceDate) : null
    );
    setError(null);
  };

  const handleAddBreak = () => {
    if (!editedClockIn || !editedClockOut) return;

    const { breakStart, breakEnd } = buildDefaultBreakRange(
      editedClockIn,
      editedClockOut
    );

    setEditedBreaks([
      {
        key: `new-break-${Date.now()}`,
        breakStartEntry: null,
        breakEndEntry: null,
        breakStart,
        breakEnd,
        isNew: true
      }
    ]);
  };

  const handleStartEditWithBreak = () => {
    handleStartEdit();

    const baseClockIn = clockInDate ? new Date(clockInDate) : null;
    const baseClockOut = clockOutDate ? new Date(clockOutDate) : null;
    if (!baseClockIn || !baseClockOut) return;

    const { breakStart, breakEnd } = buildDefaultBreakRange(
      baseClockIn,
      baseClockOut
    );

    setEditedBreaks([
      {
        key: `new-break-${Date.now()}`,
        breakStartEntry: null,
        breakEndEntry: null,
        breakStart,
        breakEnd,
        isNew: true
      }
    ]);
  };

  const handleRemoveBreak = (key: string) => {
    setEditedBreaks((prev) => {
      const targetBreak = prev.find((workBreak) => workBreak.key === key);

      if (targetBreak && !targetBreak.isNew) {
        setRemovedBreaks((current) => [...current, targetBreak]);
      }

      return prev.filter((workBreak) => workBreak.key !== key);
    });
  };

  const handleBreakChange = (
    key: string,
    field: 'breakStart' | 'breakEnd',
    value: Date
  ) => {
    setEditedBreaks((prev) =>
      prev.map((workBreak) =>
        workBreak.key === key
          ? {
              ...workBreak,
              [field]: value
            }
          : workBreak
      )
    );
  };

  const handleBlockDateChange = (nextDate: Date | undefined) => {
    if (!nextDate) return;

    setEditedBlockDate(new Date(nextDate));
    setEditedClockIn((prev) => (prev ? applyDatePart(prev, nextDate) : prev));
    setEditedClockOut((prev) => (prev ? applyDatePart(prev, nextDate) : prev));
    setEditedBreaks((prev) =>
      prev.map((workBreak) => ({
        ...workBreak,
        breakStart: applyDatePart(workBreak.breakStart, nextDate),
        breakEnd: workBreak.breakEnd
          ? applyDatePart(workBreak.breakEnd, nextDate)
          : null
      }))
    );
  };

  const validateTimeline = () => {
    const referenceDay =
      editedClockIn ??
      editedClockOut ??
      editedBreaks[0]?.breakStart ??
      clockInDate ??
      clockOutDate;

    const now = Date.now();

    if (editedClockIn && editedClockIn.getTime() > now) {
      return 'Arbeitsbeginn kann nicht in der Zukunft liegen.';
    }

    if (editedClockOut && editedClockOut.getTime() > now) {
      return 'Arbeitsende kann nicht in der Zukunft liegen.';
    }

    if (editedClockIn && editedClockOut && editedClockOut <= editedClockIn) {
      return 'Das Arbeitsende muss nach dem Arbeitsbeginn liegen.';
    }

    if (!referenceDay) {
      return null;
    }

    const sameLocalDay = (value: Date) =>
      value.getFullYear() === referenceDay.getFullYear() &&
      value.getMonth() === referenceDay.getMonth() &&
      value.getDate() === referenceDay.getDate();

    const sortedBreaks = [...editedBreaks].sort(
      (a, b) => a.breakStart.getTime() - b.breakStart.getTime()
    );

    let previousBreakEnd: Date | null = null;

    for (const [index, workBreak] of sortedBreaks.entries()) {
      if (workBreak.breakStart.getTime() > now) {
        return 'Pausenbeginn kann nicht in der Zukunft liegen.';
      }

      if (!sameLocalDay(workBreak.breakStart)) {
        return 'Pausenzeiten müssen innerhalb desselben Tages liegen.';
      }

      if (!workBreak.breakEnd) {
        return 'Bitte gib für die Pause auch ein Pausenende an.';
      }

      if (workBreak.breakEnd.getTime() > now) {
        return 'Pausenende kann nicht in der Zukunft liegen.';
      }

      if (!sameLocalDay(workBreak.breakEnd)) {
        return 'Pausenzeiten müssen innerhalb desselben Tages liegen.';
      }

      if (editedClockIn && workBreak.breakStart <= editedClockIn) {
        return 'Der Pausenbeginn muss nach dem Arbeitsbeginn liegen.';
      }

      if (workBreak.breakEnd <= workBreak.breakStart) {
        return 'Das Pausenende muss nach dem Pausenbeginn liegen.';
      }

      if (editedClockOut && workBreak.breakEnd >= editedClockOut) {
        return 'Die Pause muss vor dem Arbeitsende abgeschlossen sein.';
      }

      if (previousBreakEnd && workBreak.breakStart <= previousBreakEnd) {
        return `Pausen dürfen sich nicht überschneiden (Pause ${index + 1}).`;
      }

      previousBreakEnd = workBreak.breakEnd;
    }

    return null;
  };

  const handleSaveEdit = async () => {
    setError(null);
    setSuccessMessage(null);

    const validationError = validateTimeline();
    if (validationError) {
      setError(validationError);
      return;
    }

    startTransition(async () => {
      let requestCreated = false;
      const appliedUpdates: Array<{
        entryId: string;
        originalTimestamp: string;
        originalEntryType?: TimeEntry['entryType'];
        originalJobId?: string | null;
      }> = [];
      const createdEntries: TimeEntry[] = [];

      const rollbackUpdates = async () => {
        for (const rollback of [...appliedUpdates].reverse()) {
          await updateEntry(rollback.entryId, {
            timestamp: rollback.originalTimestamp,
            entryType: rollback.originalEntryType,
            jobId: rollback.originalJobId
          });
        }

        for (const entry of createdEntries.reverse()) {
          await deleteEntry(entry.id);
        }
      };

      const performUpdate = async (entryId: string, timestamp: string) => {
        const result = await updateEntry(entryId, { timestamp });

        if (!result.success) {
          setError(formatActionError(result.error));
          return false;
        }

        if ('request' in result) {
          requestCreated = true;
        }

        return true;
      };

      const performDelete = async (entryId: string, pairedEntryId?: string) => {
        const result = await deleteEntry(entryId, pairedEntryId);

        if (!result.success) {
          setError(formatActionError(result.error));
          return false;
        }

        if ('request' in result) {
          requestCreated = true;
        }

        return true;
      };

      try {
        const updates: Array<{
          entryId: string;
          originalTimestamp: string;
          nextTimestamp: string;
        }> = [];

        if (startEntry && editedClockIn && clockInDate) {
          if (editedClockIn.getTime() !== clockInDate.getTime()) {
            updates.push({
              entryId: startEntry.id,
              originalTimestamp: startEntry.timestamp,
              nextTimestamp: editedClockIn.toISOString()
            });
          }
        }

        if (actualClockOutEntry && editedClockOut && clockOutDate) {
          if (editedClockOut.getTime() !== clockOutDate.getTime()) {
            updates.push({
              entryId: actualClockOutEntry.id,
              originalTimestamp: actualClockOutEntry.timestamp,
              nextTimestamp: editedClockOut.toISOString()
            });
          }
        }

        for (const workBreak of editedBreaks) {
          if (
            workBreak.breakStartEntry &&
            workBreak.breakStart.getTime() !==
              new Date(workBreak.breakStartEntry.timestamp).getTime()
          ) {
            updates.push({
              entryId: workBreak.breakStartEntry.id,
              originalTimestamp: workBreak.breakStartEntry.timestamp,
              nextTimestamp: workBreak.breakStart.toISOString()
            });
          }

          if (
            workBreak.breakEndEntry &&
            workBreak.breakEnd &&
            workBreak.breakEnd.getTime() !==
              new Date(workBreak.breakEndEntry.timestamp).getTime()
          ) {
            updates.push({
              entryId: workBreak.breakEndEntry.id,
              originalTimestamp: workBreak.breakEndEntry.timestamp,
              nextTimestamp: workBreak.breakEnd.toISOString()
            });
          }
        }

        const laterUpdates = updates
          .filter(
            (update) =>
              new Date(update.nextTimestamp).getTime() >
              new Date(update.originalTimestamp).getTime()
          )
          .sort(
            (a, b) =>
              new Date(b.originalTimestamp).getTime() -
              new Date(a.originalTimestamp).getTime()
          );

        const earlierUpdates = updates
          .filter(
            (update) =>
              new Date(update.nextTimestamp).getTime() <
              new Date(update.originalTimestamp).getTime()
          )
          .sort(
            (a, b) =>
              new Date(a.originalTimestamp).getTime() -
              new Date(b.originalTimestamp).getTime()
          );

        for (const update of [...laterUpdates, ...earlierUpdates]) {
          const success = await performUpdate(
            update.entryId,
            update.nextTimestamp
          );
          if (!success) {
            await rollbackUpdates();
            return;
          }

          appliedUpdates.push({
            entryId: update.entryId,
            originalTimestamp: update.originalTimestamp
          });
        }

        const newBreaks = editedBreaks.filter((workBreak) => workBreak.isNew);
        if (newBreaks.length > 0) {
          if (!entryOrganizationId || !entryUserId) {
            setError('Die Pause konnte nicht zugeordnet werden.');
            await rollbackUpdates();
            return;
          }

          for (const workBreak of newBreaks) {
            if (!workBreak.breakEnd) {
              setError('Bitte gib für die neue Pause auch ein Pausenende an.');
              await rollbackUpdates();
              return;
            }

            const result = await addManualEntry({
              organizationId: entryOrganizationId,
              targetUserId: entryUserId,
              entries: [
                {
                  entryType: 'break_start',
                  timestamp: workBreak.breakStart.toISOString()
                },
                {
                  entryType: 'break_end',
                  timestamp: workBreak.breakEnd.toISOString()
                }
              ]
            });

            if (!result.success) {
              setError(formatActionError(result.error));
              await rollbackUpdates();
              return;
            }

            createdEntries.push(...result.entries);
          }
        }

        for (const removedBreak of removedBreaks) {
          if (!removedBreak.breakStartEntry) continue;

          const convertsBoundaryToClockOut =
            !actualClockOutEntry &&
            !!removedBreak.breakEndEntry &&
            removedBreak.breakEndEntry?.id === session.clockOut?.id &&
            removedBreak.breakEndEntry.entryType === 'break_end';

          if (convertsBoundaryToClockOut && removedBreak.breakEndEntry) {
            const convertedResult = await updateEntry(
              removedBreak.breakEndEntry.id,
              {
                entryType: 'clock_out',
                jobId: null
              }
            );

            if (!convertedResult.success) {
              setError(formatActionError(convertedResult.error));
              await rollbackUpdates();
              return;
            }

            if ('request' in convertedResult) {
              requestCreated = true;
            }

            appliedUpdates.push({
              entryId: removedBreak.breakEndEntry.id,
              originalTimestamp: removedBreak.breakEndEntry.timestamp,
              originalEntryType: removedBreak.breakEndEntry.entryType,
              originalJobId: removedBreak.breakEndEntry.jobId
            });
          }

          const success = await performDelete(
            removedBreak.breakStartEntry.id,
            convertsBoundaryToClockOut
              ? undefined
              : removedBreak.breakEndEntry?.id
          );

          if (!success) {
            await rollbackUpdates();
            return;
          }
        }

        if (requestCreated) {
          setSuccessMessage(
            'Änderungsantrag wurde zur Genehmigung eingereicht.'
          );
          setIsEditing(false);
          setTimeout(() => {
            onOpenChange(false);
            onRefresh();
          }, 2000);
          return;
        }

        setIsEditing(false);
        onRefresh();
      } catch (err) {
        console.error('Error updating entry:', err);
        setError('Ein Fehler ist aufgetreten.');
      }
    });
  };

  const handleDelete = async () => {
    setError(null);
    setSuccessMessage(null);

    startTransition(async () => {
      try {
        let requestCreated = false;
        const entryIds = [
          ...new Set(sessionEntriesForReview.map((entry) => entry.id))
        ];

        if (entryIds.length > 1) {
          const result = await deleteEntriesBatch(entryIds);
          if (!result.success) {
            setError(formatActionError(result.error));
            return;
          }
        } else {
          for (const entry of [...sessionEntriesForReview].reverse()) {
            const result = await deleteEntry(entry.id);

            if (!result.success) {
              setError(formatActionError(result.error));
              return;
            }

            if ('request' in result) {
              requestCreated = true;
            }
          }
        }

        if (requestCreated) {
          setSuccessMessage('Löschantrag wurde zur Genehmigung eingereicht.');
          setTimeout(() => {
            onOpenChange(false);
            onRefresh();
          }, 2000);
          return;
        }

        onOpenChange(false);
        onRefresh();
      } catch (err) {
        console.error('Error deleting entry:', err);
        setError('Ein Fehler ist aufgetreten.');
      }
    });
  };

  const handleApprove = async () => {
    startTransition(async () => {
      try {
        for (const entry of pendingEntries) {
          const result = await reviewEntry(entry.id, 'approved');
          if (!result.success) {
            setError(result.error);
            return;
          }
        }

        onRefresh();
      } catch (err) {
        console.error('Error approving entry:', err);
        setError('Ein Fehler ist aufgetreten.');
      }
    });
  };

  const handleReject = async () => {
    startTransition(async () => {
      try {
        for (const entry of pendingEntries) {
          const result = await reviewEntry(entry.id, 'rejected');
          if (!result.success) {
            setError(result.error);
            return;
          }
        }

        onRefresh();
      } catch (err) {
        console.error('Error rejecting entry:', err);
        setError('Ein Fehler ist aufgetreten.');
      }
    });
  };

  const canAddBreak =
    canEdit &&
    isEditing &&
    editedBreaks.length === 0 &&
    !!editedClockIn &&
    !!editedClockOut &&
    !isOrphan;
  const canOfferAddBreak =
    canEdit &&
    !isEditing &&
    sessionBreaks.length === 0 &&
    !!clockInDate &&
    !!clockOutDate &&
    !isOrphan;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Eintrag Details</DialogTitle>
          <DialogDescription>{getDescriptionText()}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {employeeName && (
            <DetailCard
              icon={<User className="size-4" />}
              label="Mitarbeiter"
              value={employeeName}
              onClick={
                employeeDetailUrl
                  ? () => {
                      onOpenChange(false);
                      router.push(employeeDetailUrl);
                    }
                  : undefined
              }
              disabled={!employeeDetailUrl}
            />
          )}

          {resolvedJob && (
            <DetailCard
              icon={<Briefcase className="size-4" />}
              label="Auftrag"
              value={resolvedJob.title}
              onClick={
                jobDetailUrl
                  ? () => {
                      onOpenChange(false);
                      router.push(jobDetailUrl);
                    }
                  : undefined
              }
              disabled={!jobDetailUrl}
            />
          )}

          {!isOrphan && totalWorkMinutes !== null && (
            <div
              className={cn(
                'rounded-md border border-green-500/30 bg-green-500/8 px-3 py-3',
                isActiveBlock && 'animate-pulse'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm font-medium">
                    Arbeitszeit gesamt
                  </span>
                </div>
                <span className="text-base font-semibold text-green-700 dark:text-green-300">
                  {formatDuration(totalWorkMinutes)}
                </span>
              </div>
              {showBlockScopedTotalHint && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Bezieht sich nur auf diesen geöffneten Arbeitsblock, nicht auf
                  den gesamten Tag.
                </p>
              )}
            </div>
          )}

          {isEditing && editedBlockDate && (
            <div className="space-y-2 rounded-md border border-border/60 px-3 py-3">
              <Label>Datum des Arbeitsblocks</Label>
              <DatePicker
                value={editedBlockDate}
                onChange={handleBlockDateChange}
              />
              <p className="text-xs text-muted-foreground">
                Dieses Datum gilt für alle Zeiten dieses Arbeitsblocks.
              </p>
            </div>
          )}

          {startEntry && (
            <div className="space-y-2 rounded-md border border-border/60 px-3 py-3">
              {isEditing && editedClockIn ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <DateTimePicker
                      value={editedClockIn}
                      onChange={setEditedClockIn}
                      label={getEntryLabel(startEntry)}
                      dateLabel={
                        editedBlockDate?.toLocaleDateString('de-DE') ??
                        clockInDate?.toLocaleDateString('de-DE')
                      }
                      disableDateEditing
                    />
                  </div>
                  <span
                    className={cn(
                      'mt-7 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      getStatusConfig(startEntry).className
                    )}
                  >
                    {getStatusConfig(startEntry).label}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <Label>{getEntryLabel(startEntry)}</Label>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        getStatusConfig(startEntry).className
                      )}
                    >
                      {getStatusConfig(startEntry).label}
                    </span>
                  </div>
                  <p className="text-sm">
                    {clockInDate ? formatDateTime(clockInDate) : '-'}
                  </p>
                </>
              )}
              {startEntry.isManual && !isEditing && (
                <p className="text-xs text-muted-foreground">
                  Manuell eingetragen
                </p>
              )}
            </div>
          )}

          {editedBreaks.map((workBreak, index) => {
            const breakStartStatus = getStatusConfig(workBreak.breakStartEntry);
            const breakEndStatus = getStatusConfig(workBreak.breakEndEntry);
            const breakStartEntry =
              workBreak.breakStartEntry ??
              buildDraftEntry(
                workBreak.key,
                'break_start',
                workBreak.breakStart,
                entryUserId,
                entryOrganizationId
              );
            const breakEndEntry = workBreak.breakEnd
              ? (workBreak.breakEndEntry ??
                buildDraftEntry(
                  `${workBreak.key}-end`,
                  'break_end',
                  workBreak.breakEnd,
                  entryUserId,
                  entryOrganizationId
                ))
              : null;

            return (
              <div
                key={workBreak.key}
                className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Coffee className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span>Pause</span>
                  </div>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    {formatDuration(getBreakDurationMinutes(workBreak))}
                  </span>
                  {isEditing && canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveBreak(workBreak.key)}
                      className="h-7 px-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Entfernen
                    </Button>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <DateTimePicker
                          value={workBreak.breakStart}
                          onChange={(value) =>
                            handleBreakChange(
                              workBreak.key,
                              'breakStart',
                              value
                            )
                          }
                          label={getEntryLabel(breakStartEntry, index)}
                          dateLabel={
                            editedBlockDate?.toLocaleDateString('de-DE') ??
                            workBreak.breakStart.toLocaleDateString('de-DE')
                          }
                          disableDateEditing
                        />
                      </div>
                      <span
                        className={cn(
                          'mt-7 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                          breakStartStatus.className
                        )}
                      >
                        {breakStartStatus.label}
                      </span>
                    </div>

                    {workBreak.breakEnd ? (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <DateTimePicker
                            value={workBreak.breakEnd}
                            onChange={(value) =>
                              handleBreakChange(
                                workBreak.key,
                                'breakEnd',
                                value
                              )
                            }
                            label={
                              breakEndEntry
                                ? getEntryLabel(breakEndEntry, index)
                                : ''
                            }
                            dateLabel={
                              editedBlockDate?.toLocaleDateString('de-DE') ??
                              workBreak.breakEnd.toLocaleDateString('de-DE')
                            }
                            disableDateEditing
                          />
                        </div>
                        <span
                          className={cn(
                            'mt-7 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                            breakEndStatus.className
                          )}
                        >
                          {breakEndStatus.label}
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label>
                          {getEntryLabel(
                            { ...breakStartEntry, entryType: 'break_end' },
                            index
                          )}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Noch in Pause
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label>{getEntryLabel(breakStartEntry, index)}</Label>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            breakStartStatus.className
                          )}
                        >
                          {breakStartStatus.label}
                        </span>
                      </div>
                      <p className="text-sm">
                        {formatDateTime(new Date(breakStartEntry.timestamp))}
                      </p>
                      {breakStartEntry.isManual && (
                        <p className="text-xs text-muted-foreground">
                          Manuell eingetragen
                        </p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label>
                          {breakEndEntry
                            ? getEntryLabel(breakEndEntry, index)
                            : getEntryLabel(
                                {
                                  ...breakStartEntry,
                                  entryType: 'break_end'
                                },
                                index
                              )}
                        </Label>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            breakEndStatus.className
                          )}
                        >
                          {breakEndStatus.label}
                        </span>
                      </div>
                      <p className="text-sm">
                        {breakEndEntry
                          ? formatDateTime(new Date(breakEndEntry.timestamp))
                          : 'Noch in Pause'}
                      </p>
                      {breakEndEntry?.isManual && (
                        <p className="text-xs text-muted-foreground">
                          Manuell eingetragen
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {editedBreaks.length > 1 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/8 px-3 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Coffee className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-medium">Pausenzeit gesamt</span>
                </div>
                <span className="text-base font-semibold text-amber-700 dark:text-amber-300">
                  {formatDuration(totalBreakMinutes)}
                </span>
              </div>
            </div>
          )}

          {canAddBreak && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddBreak}
              className="w-full gap-2"
            >
              <Plus className="h-4 w-4" />
              Pause hinzufügen
            </Button>
          )}

          {canOfferAddBreak && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleStartEditWithBreak}
              className="w-full gap-2"
            >
              <Plus className="h-4 w-4" />
              Pause hinzufügen
            </Button>
          )}

          {actualClockOutEntry && (
            <div className="space-y-2 rounded-md border border-border/60 px-3 py-3">
              {isEditing && editedClockOut ? (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <DateTimePicker
                      value={editedClockOut}
                      onChange={setEditedClockOut}
                      label={getEntryLabel(actualClockOutEntry)}
                      dateLabel={
                        editedBlockDate?.toLocaleDateString('de-DE') ??
                        clockOutDate?.toLocaleDateString('de-DE')
                      }
                      disableDateEditing
                    />
                  </div>
                  <span
                    className={cn(
                      'mt-7 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      getStatusConfig(actualClockOutEntry).className
                    )}
                  >
                    {getStatusConfig(actualClockOutEntry).label}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <Label>{getEntryLabel(actualClockOutEntry)}</Label>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        getStatusConfig(actualClockOutEntry).className
                      )}
                    >
                      {getStatusConfig(actualClockOutEntry).label}
                    </span>
                  </div>
                  <p className="text-sm">
                    {clockOutDate ? formatDateTime(clockOutDate) : '-'}
                  </p>
                </>
              )}
              {actualClockOutEntry.isManual && !isEditing && (
                <p className="text-xs text-muted-foreground">
                  Manuell eingetragen
                </p>
              )}
            </div>
          )}

          {!actualClockOutEntry &&
            !interactiveSession.isOnBreakBlock &&
            !isOrphan &&
            !hasActualBreaks &&
            !isEditing && (
              <div className="space-y-2 rounded-md border border-border/60 px-3 py-3">
                <div className="flex items-center justify-between">
                  <Label>Arbeitsende</Label>
                </div>
                <p className="text-sm text-muted-foreground">Noch aktiv</p>
              </div>
            )}

          {showBoundaryExplanation && (
            <div className="rounded-md border border-blue-500/30 bg-blue-500/8 px-3 py-3">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <p className="text-xs text-muted-foreground">
                  Dieser Arbeitsblock endet hier, weil danach die Arbeit in
                  einem neuen Arbeitsblock oder Auftrag weitergeführt wurde. Das
                  ist kein Arbeitsende des gesamten Arbeitstages.
                </p>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
              {successMessage}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {canApprove && !isEditing && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleApprove}
                disabled={isPending}
                className="gap-1"
              >
                <Check className="h-4 w-4" />
                Genehmigen
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReject}
                disabled={isPending}
                className="gap-1 text-destructive hover:text-destructive"
              >
                <X className="h-4 w-4" />
                Ablehnen
              </Button>
            </div>
          )}

          {canEdit && !isEditing && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartEdit}
                disabled={isPending}
                className="gap-1"
              >
                <Pencil className="h-4 w-4" />
                Bearbeiten
              </Button>
              {!hasPendingEntry && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      className="gap-1 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Löschen
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Arbeitsblock löschen?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Diese Aktion kann nicht rückgängig gemacht werden. Alle
                        zu diesem Arbeitsblock gehörenden Zeit-Einträge,
                        inklusive eventueller Pausen, werden gelöscht.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Löschen
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}

          {isEditing && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEdit}
                disabled={isPending}
              >
                Abbrechen
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Speichern
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
