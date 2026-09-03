'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { JobMultiSelect } from './job-multi-select';
import type { Job } from '@/lib/jobs/types';

interface ProjectJobsAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: Job[];
  title?: string;
  isSaving?: boolean;
  isLoading?: boolean;
  loadError?: string | null;
  saveError?: string | null;
  onRetry?: () => void;
  onSave: (jobIds: string[]) => Promise<void> | void;
}

export function ProjectJobsAssignmentDialog({
  open,
  onOpenChange,
  jobs,
  title = 'Aufträge zuweisen',
  isSaving = false,
  isLoading = false,
  loadError,
  saveError,
  onRetry,
  onSave,
}: ProjectJobsAssignmentDialogProps) {
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the dialog should always start from a clean job selection
    setSelectedJobIds([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- successful partial assignments disappear from the retry selection
    setSelectedJobIds((current) =>
      current.filter((jobId) => jobs.some((job) => job.id === jobId))
    );
  }, [jobs, open]);

  const handleSave = async () => {
    await onSave(selectedJobIds);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-visible sm:top-[47%] sm:max-w-[420px] sm:translate-y-[-47%]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <JobMultiSelect
            jobs={jobs}
            selectedIds={selectedJobIds}
            onSelectionChange={setSelectedJobIds}
            disabled={isSaving}
          />

          {loadError ? (
            <div className="flex items-center justify-between gap-3">
              <ErrorText>{loadError}</ErrorText>
              {onRetry && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  disabled={isLoading}
                >
                  Erneut laden
                </Button>
              )}
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Es sind keine verfügbaren Aufträge ohne Projekt vorhanden.
            </p>
          ) : null}

          <ErrorText>{saveError}</ErrorText>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                isSaving ||
                isLoading ||
                Boolean(loadError) ||
                selectedJobIds.length === 0
              }
            >
              {(isSaving || isLoading) && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
