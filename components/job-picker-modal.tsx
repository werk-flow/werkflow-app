'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Play, ArrowLeftRight, Loader2, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Skeleton } from '@/components/ui/skeleton';
import { getJobsForPicker } from '@/lib/time-tracking/actions';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

type PickerJob = {
  id: string;
  title: string;
  jobNumber: string | null;
  status: string;
  projectName: string | null;
  clientName: string | null;
};

interface JobPickerModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (jobId: string | null) => void;
  organizationId: string;
  mode: 'clock_in' | 'switch' | 'resume';
  currentJobId: string | null;
  isPending: boolean;
}

// Job picking for the clock flows: a shell over the Dialog primitive (which
// suspends Realtime router refreshes while open) and the registry's
// SearchableSelect, which owns search, filtering, and empty states.
export function JobPickerModal({
  open,
  onClose,
  onConfirm,
  organizationId,
  mode,
  currentJobId,
  isPending,
}: JobPickerModalProps) {
  const [jobs, setJobs] = useState<PickerJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>('');

  const openRef = useRef(open);
  openRef.current = open;

  const fetchJobs = useCallback(async () => {
    if (!organizationId) return;
    setIsLoading(true);
    try {
      const result = await getJobsForPicker(organizationId);
      if (result.success) {
        setJobs(result.jobs);
      }
    } catch (err) {
      console.error('Error fetching picker jobs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  // Only refetch on realtime events when the modal is actually open
  const realtimeFetchJobs = useCallback(() => {
    if (openRef.current) fetchJobs();
  }, [fetchJobs]);

  useRealtimeEvent('jobs', realtimeFetchJobs);
  useRealtimeEvent('projects', realtimeFetchJobs);
  useRealtimeEvent('job_assignments', realtimeFetchJobs);

  useEffect(() => {
    if (open) {
      fetchJobs();
      setSelectedJobId(mode === 'switch' ? currentJobId ?? '' : '');
    }
  }, [open, fetchJobs, mode, currentJobId]);

  const jobOptions = useMemo(
    () =>
      jobs.map((job) => ({
        value: job.id,
        label: job.title,
        description:
          [job.jobNumber, job.clientName, job.projectName]
            .filter(Boolean)
            .join(' · ') || undefined,
      })),
    [jobs]
  );

  const title =
    mode === 'clock_in'
      ? 'Einstempeln'
      : mode === 'resume'
        ? 'Arbeit fortsetzen'
        : 'Auftrag wechseln';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Briefcase className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {mode === 'clock_in'
                  ? 'Wähle einen Auftrag aus (optional)'
                  : mode === 'resume'
                    ? 'Wähle den Auftrag für die Fortsetzung'
                    : 'Wähle den neuen Auftrag'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(selectedJobId || null);
          }}
          noValidate
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="job-picker-job">Auftrag</Label>
            {isLoading && jobs.length === 0 ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <SearchableSelect
                id="job-picker-job"
                options={jobOptions}
                value={selectedJobId}
                onChange={setSelectedJobId}
                placeholder="Ohne Auftrag"
                searchPlaceholder="Auftrag suchen..."
                emptyMessage="Keine Aufträge gefunden"
                allowNone
                noneLabel="Ohne Auftrag"
              />
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              className="select-none"
              disabled={
                isPending ||
                (mode === 'switch' && selectedJobId === (currentJobId ?? ''))
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : mode === 'switch' ? (
                <ArrowLeftRight className="mr-2 h-4 w-4" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {mode === 'clock_in'
                ? 'Einstempeln'
                : mode === 'resume'
                  ? 'Fortsetzen'
                  : 'Wechseln'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
