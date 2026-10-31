'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Play, ArrowLeftRight, Briefcase } from 'lucide-react';
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
import { readInBackground } from '@/lib/data/background-read-client';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import {
  JobPickerLoadingRows,
  JobPickerOptionList,
  type PickerJob,
} from '@/components/job-picker-modal-options';
import { PICKER_PAGE_SIZE } from '@/lib/time-tracking/picker-types';

const NO_JOBS: PickerJob[] = [];
const SEARCH_DEBOUNCE_MS = 150;

type PickerPage = { jobs: PickerJob[]; hasMore: boolean; selected: PickerJob | null };
type PickerRequest = { query: string; limit: number };
type PickerReadInput = {
  organizationId: string;
  request: PickerRequest;
  mode: JobPickerModalProps['mode'];
  currentJobId: string | null;
};

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

/** One page read of the picker: the search and length it answers for, and the running job of a switch. */
async function readJobPickerPage(
  signal: AbortSignal,
  { organizationId, request, mode, currentJobId }: PickerReadInput,
): Promise<LiveViewResult<PickerPage>> {
  if (!organizationId) return { ok: true, data: { jobs: [], hasMore: false, selected: null } };
  const result = await readInBackground(
    'job-picker-jobs',
    {
      organizationId,
      query: request.query,
      limit: request.limit,
      ...(mode === 'switch' && currentJobId ? { selectedJobId: currentJobId } : {}),
    },
    signal,
  );
  return result.success
    ? { ok: true, data: { jobs: result.jobs, hasMore: result.hasMore, selected: result.selected } }
    : { ok: false };
}

/** The picker's search, the live page of jobs it shows and the chosen job; each opening starts fresh. */
function useJobPickerState({
  open,
  organizationId,
  mode,
  currentJobId,
}: Pick<JobPickerModalProps, 'open' | 'organizationId' | 'mode' | 'currentJobId'>) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // The search and the shown length the server answers for; typing settles for a moment first.
  const [request, setRequest] = useState<PickerRequest>({ query: '', limit: PICKER_PAGE_SIZE });
  const requestRef = useRef(request);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const view = useLiveView<PickerPage>({
    tables: ['jobs', 'projects', 'job_assignments'],
    // Reads over GET, so opening the picker never waits behind a clock transition. The
    // database searches and ranks today's own visits first; the list re-reads what it shows.
    read: ({ signal }) =>
      readJobPickerPage(signal, { organizationId, request: requestRef.current, mode, currentJobId }),
    // Only read while the modal is open; each open triggers a fresh read.
    enabled: open,
    resetKey: organizationId,
  });
  const { refresh } = view;
  // A new search or a longer list reads at once; the first read comes with opening the modal.
  useEffect(() => {
    if (requestRef.current === request) return;
    requestRef.current = request;
    if (open) void refresh();
  }, [request, open, refresh]);
  useEffect(() => {
    if (searchQuery === requestRef.current.query) return;
    const timer = setTimeout(
      () => setRequest({ query: searchQuery, limit: PICKER_PAGE_SIZE }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const page = view.data;
  const isLoading = view.isLoading || view.isRefreshing;
  const searchPending = searchQuery !== request.query || (isLoading && page !== undefined);

  useEffect(() => {
    if (!open) {
      // A closed picker forgets its search, so the read of the next opening asks for the first page.
      const initial = { query: '', limit: PICKER_PAGE_SIZE };
      requestRef.current = initial;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the closed picker resets the search it will open with
      setRequest(initial);
      // Clearing the text also cancels a debounce still pending from before the close.
      setSearchQuery('');
      return;
    }
    setSearchQuery('');
    setSelectedJobId(mode === 'switch' ? currentJobId : null);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [open, mode, currentJobId]);

  // Today's dispatched jobs first (P1-11 occurrences on the Berlin date), then
  // the rest in title order, as the database ranked them. The running job of a
  // switch stays listed while no search hides it.
  const filteredJobs = useMemo(() => {
    const jobs = page?.jobs ?? NO_JOBS;
    const selected = page?.selected;
    return selected && !request.query && !jobs.some((job) => job.id === selected.id)
      ? [...jobs, { ...selected, plannedToday: false }]
      : jobs;
  }, [page, request.query]);
  const plannedTodayCount = filteredJobs.filter((job) => job.plannedToday).length;
  const onLoadMore = page?.hasMore
    ? () => setRequest((current) => ({ ...current, limit: current.limit + PICKER_PAGE_SIZE }))
    : undefined;
  return {
    selectedJobId,
    setSelectedJobId,
    searchQuery,
    setSearchQuery,
    request,
    onLoadMore,
    searchInputRef,
    view,
    page,
    isLoading,
    searchPending,
    filteredJobs,
    plannedTodayCount,
  };
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
  const { searchInputRef, ...picker } = useJobPickerState({ open, organizationId, mode, currentJobId });

  const title =
    mode === 'clock_in' ? 'Einstempeln' : mode === 'resume' ? 'Arbeit fortsetzen' : 'Auftrag wechseln';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} pending={isPending}>
      <DialogContent size="md">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
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
            onConfirm(picker.selectedJobId);
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <Field label="Auftrag suchen" hideLabel>
            <SearchInput
              ref={searchInputRef}
              placeholder="Auftrag suchen…"
              aria-label="Auftrag suchen"
              value={picker.searchQuery}
              onValueChange={picker.setSearchQuery}
              pending={picker.searchPending}
            />
          </Field>

          <JobPickerResults
            isLoading={picker.isLoading}
            page={picker.page}
            stale={picker.view.isStale}
            onRefresh={picker.view.refresh}
            loadFailed={picker.view.data === undefined}
            filteredJobs={picker.filteredJobs}
            plannedTodayCount={picker.plannedTodayCount}
            selectedJobId={picker.selectedJobId}
            setSelectedJobId={picker.setSelectedJobId}
            searchQuery={picker.request.query}
            onLoadMore={picker.onLoadMore}
          />

          <JobPickerFooter
            mode={mode}
            onClose={onClose}
            isPending={isPending}
            isStatusLoading={isStatusLoading}
            selectedJobId={picker.selectedJobId}
            currentJobId={currentJobId}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The job list under the search: skeleton rows on the first read, then the options, inert while stale. */
function JobPickerResults({
  isLoading,
  page,
  stale,
  onRefresh,
  loadFailed,
  filteredJobs,
  plannedTodayCount,
  selectedJobId,
  setSelectedJobId,
  searchQuery,
  onLoadMore,
}: {
  isLoading: boolean;
  page: PickerPage | undefined;
  stale: boolean;
  onRefresh: () => Promise<void>;
  loadFailed: boolean;
  filteredJobs: PickerJob[];
  plannedTodayCount: number;
  selectedJobId: string | null;
  setSelectedJobId: (jobId: string | null) => void;
  searchQuery: string;
  onLoadMore: (() => void) | undefined;
}) {
  return (
    <DialogBody className="min-h-40">
      {isLoading && page === undefined ? (
        <JobPickerLoadingRows />
      ) : (
        <StaleRegion stale={stale} onRetry={onRefresh}>
          <JobPickerOptionList
            filteredJobs={filteredJobs}
            plannedTodayCount={plannedTodayCount}
            selectedJobId={selectedJobId}
            setSelectedJobId={setSelectedJobId}
            isLoading={isLoading}
            loadFailed={loadFailed}
            onRetry={() => void onRefresh()}
            searchQuery={searchQuery}
            onLoadMore={onLoadMore}
          />
        </StaleRegion>
      )}
    </DialogBody>
  );
}

/** Cancel and confirm; confirming waits for the clock status, a switch needs another job. */
function JobPickerFooter({
  mode,
  onClose,
  isPending,
  isStatusLoading,
  selectedJobId,
  currentJobId,
}: Pick<JobPickerModalProps, 'mode' | 'onClose' | 'isPending' | 'currentJobId'> & {
  isStatusLoading: boolean;
  selectedJobId: string | null;
}) {
  return (
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
        pending={isPending}
        // eslint-disable-next-line ui/submit-disabled-only-while-pending -- no field to fill: switching to the job that is already running is not an action
        disabled={isStatusLoading || (mode === 'switch' && (selectedJobId ?? '') === (currentJobId ?? ''))}
      >
        {mode === 'switch' ? <ArrowLeftRight className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
        {mode === 'clock_in' ? 'Einstempeln' : mode === 'resume' ? 'Fortsetzen' : 'Wechseln'}
      </Button>
    </DialogFooter>
  );
}
