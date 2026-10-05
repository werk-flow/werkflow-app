'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Play, ArrowLeftRight, Loader2, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SearchInput } from '@/components/ui/search-input';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { filterByQuery } from '@/lib/ui/search';
import { readInBackground } from '@/lib/data/background-read-client';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import {
  JobPickerLoadingRows,
  JobPickerOptionList,
  type PickerJob,
} from '@/components/job-picker-modal-options';

const NO_JOBS: PickerJob[] = [];

interface JobPickerModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (jobId: string | null) => void;
  organizationId: string;
  mode: 'clock_in' | 'switch' | 'resume';
  currentJobId: string | null;
  /** A clock write runs: the picker cannot be dismissed and cannot confirm until it answers. */
  isPending: boolean;
  /** The clock status is not loaded yet: confirming waits, closing does not. */
  isStatusLoading?: boolean;
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
  isStatusLoading = false,
}: JobPickerModalProps) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const view = useLiveView<PickerJob[]>({
    tables: ['jobs', 'projects', 'job_assignments'],
    // Reads over GET, so opening the picker never waits behind a clock transition.
    read: async ({ signal }): Promise<LiveViewResult<PickerJob[]>> => {
      if (!organizationId) return { ok: true, data: [] };
      const result = await readInBackground('job-picker-jobs', { organizationId }, signal);
      return result.success ? { ok: true, data: result.jobs } : { ok: false };
    },
    // Only read while the modal is open; each open triggers a fresh read.
    enabled: open,
    resetKey: organizationId,
  });
  const jobs = view.data ?? NO_JOBS;
  const isLoading = view.isLoading || view.isRefreshing;

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reopening the picker always starts from a clean search and the mode-appropriate selection
      setSearchQuery('');
      setSelectedJobId(mode === 'switch' ? currentJobId : null);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open, mode, currentJobId]);

  // Today's dispatched jobs first (P1-11 occurrences on the Berlin date), then
  // the rest in the reader's alphabetical order.
  const filteredJobs = useMemo(
    () =>
      filterByQuery(jobs, searchQuery, (job) =>
        [job.title, job.jobNumber, job.projectName, job.clientName].filter(Boolean).join(' '),
      ).sort((left, right) => Number(right.plannedToday) - Number(left.plannedToday)),
    [jobs, searchQuery],
  );
  const plannedTodayCount = filteredJobs.filter((job) => job.plannedToday).length;

  const title =
    mode === 'clock_in' ? 'Einstempeln' : mode === 'resume' ? 'Arbeit fortsetzen' : 'Auftrag wechseln';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} pending={isPending}>
      <DialogContent size="md">
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
          <Field label="Auftrag suchen" hideLabel>
            <SearchInput
              ref={searchInputRef}
              placeholder="Auftrag suchen…"
              aria-label="Auftrag suchen"
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
          </Field>

          <DialogBody className="min-h-40">
            {isLoading && jobs.length === 0 ? (
              <JobPickerLoadingRows />
            ) : (
              <JobPickerOptionList
                filteredJobs={filteredJobs}
                plannedTodayCount={plannedTodayCount}
                selectedJobId={selectedJobId}
                setSelectedJobId={setSelectedJobId}
                isLoading={isLoading}
                loadFailed={view.data === undefined}
                onRetry={() => void view.refresh()}
                searchQuery={searchQuery}
              />
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
              // eslint-disable-next-line ui/submit-disabled-only-while-pending -- no field to fill: switching to the job that is already running is not an action
              disabled={
                isPending ||
                isStatusLoading ||
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
              {mode === 'clock_in' ? 'Einstempeln' : mode === 'resume' ? 'Fortsetzen' : 'Wechseln'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
