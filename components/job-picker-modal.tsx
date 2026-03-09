'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Play,
  ArrowLeftRight,
  Loader2,
  X,
  Search,
  Check,
  Briefcase,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
  mode: 'clock_in' | 'switch';
  currentJobId: string | null;
  isPending: boolean;
}

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

  useRealtimeEvent('jobs', fetchJobs);
  useRealtimeEvent('job_assignments', fetchJobs);

  useEffect(() => {
    if (open) {
      fetchJobs();
      setSelectedJobId(mode === 'switch' ? currentJobId : null);
      setSearchQuery('');
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open, fetchJobs, mode, currentJobId]);

  const filteredJobs = useMemo(() => {
    if (!searchQuery.trim()) return jobs;
    const q = searchQuery.toLowerCase();
    return jobs.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        (j.jobNumber && j.jobNumber.toLowerCase().includes(q)) ||
        (j.projectName && j.projectName.toLowerCase().includes(q)) ||
        (j.clientName && j.clientName.toLowerCase().includes(q))
    );
  }, [jobs, searchQuery]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md flex-col rounded-2xl bg-background shadow-2xl ring-1 ring-border/50 animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Briefcase className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-semibold leading-tight">
                {mode === 'clock_in' ? 'Einstempeln' : 'Auftrag wechseln'}
              </h3>
              <p className="text-xs text-muted-foreground">
                {mode === 'clock_in'
                  ? 'Wähle einen Auftrag aus (optional)'
                  : 'Wähle den neuen Auftrag'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b px-5 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Auftrag suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border bg-muted/50 pl-9 pr-3 text-sm placeholder:text-muted-foreground/70 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
            />
          </div>
        </div>

        {/* Job list */}
        <div className="max-h-[340px] overflow-auto px-3 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* "No job" option */}
              <button
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
                    <p className="truncate font-medium">{job.title}</p>
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
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t px-5 py-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isPending}
          >
            Abbrechen
          </Button>
          <Button
            className="flex-1"
            onClick={() => onConfirm(selectedJobId)}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : mode === 'clock_in' ? (
              <Play className="mr-2 h-4 w-4" />
            ) : (
              <ArrowLeftRight className="mr-2 h-4 w-4" />
            )}
            {mode === 'clock_in' ? 'Einstempeln' : 'Wechseln'}
          </Button>
        </div>
      </div>
    </div>
  );
}
