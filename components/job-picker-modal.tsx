'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Play,
  ArrowLeftRight,
  Loader2,
  Briefcase,
  Search,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { filterByQuery } from '@/lib/ui/search';
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

/**
 * Job picking for the clock flows. DELIBERATELY NOT a collapsed select:
 * clocking in is the field worker's most frequent action, so the search bar
 * and the full option list are visible IMMEDIATELY when the modal opens —
 * no extra click to expand a dropdown. This flat-list presentation is an
 * owner-confirmed registry design (restored 2026-08-23 after a regression
 * replaced it with a SearchableSelect inside the dialog); keep it.
 * The Dialog primitive host provides the Realtime-refresh suspension.
 */
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
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      setSearchQuery('');
      setSelectedJobId(mode === 'switch' ? currentJobId : null);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open, fetchJobs, mode, currentJobId]);

  const filteredJobs = useMemo(
    () =>
      filterByQuery(jobs, searchQuery, (job) =>
        [job.title, job.jobNumber, job.projectName, job.clientName]
          .filter(Boolean)
          .join(' ')
      ),
    [jobs, searchQuery]
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
            onConfirm(selectedJobId);
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Auftrag suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border bg-muted/50 pl-9 pr-3 text-sm placeholder:text-muted-foreground/70 transition-colors focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <DialogBody className="min-h-40">
            {isLoading && jobs.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-0.5" role="radiogroup" aria-label="Auftrag">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedJobId === null}
                  onClick={() => setSelectedJobId(null)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                    selectedJobId === null
                      ? 'bg-primary/10 ring-1 ring-primary/20'
                      : 'hover:bg-accent'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      selectedJobId === null
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                    )}
                  >
                    {selectedJobId === null && <Check className="h-3 w-3" />}
                  </div>
                  <span className="text-muted-foreground">Ohne Auftrag</span>
                </button>

                {filteredJobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    role="radio"
                    aria-checked={selectedJobId === job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                      selectedJobId === job.id
                        ? 'bg-primary/10 ring-1 ring-primary/20'
                        : 'hover:bg-accent'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                        selectedJobId === job.id
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/30'
                      )}
                    >
                      {selectedJobId === job.id && <Check className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="line-clamp-2 break-words font-medium"
                        title={job.title}
                      >
                        {job.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[job.jobNumber, job.clientName, job.projectName]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </button>
                ))}

                {filteredJobs.length === 0 && !isLoading && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      {searchQuery
                        ? 'Keine Aufträge gefunden'
                        : 'Keine Aufträge verfügbar'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-initial"
              onClick={onClose}
              disabled={isPending}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              className="flex-1 select-none sm:flex-initial"
              disabled={
                isPending ||
                (mode === 'switch' && (selectedJobId ?? '') === (currentJobId ?? ''))
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
