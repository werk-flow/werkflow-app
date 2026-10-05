'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { JobMultiSelect } from '../shared/job-multi-select';
import { OptionsLoadError } from '../shared/options-load-error';
import type { Job } from '@/lib/jobs/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const JOBS_FIELD_ID = 'project-jobs-assignment-jobs';
const JOBS_REQUIRED_MESSAGE = 'Bitte wähle mindestens einen Auftrag aus.';

interface ProjectJobsAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: Job[];
  title?: string;
  isSaving?: boolean;
  isLoading?: boolean;
  loadError?: string | null;
  saveError?: string | null;
  onRetry: () => void;
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
  const [attempted, setAttempted] = useState(false);

  // Set during render, never in an effect: every opening starts from a clean
  // selection, and successful partial assignments leave the retry selection.
  const [adoptedFor, setAdoptedFor] = useState({ open: false, jobs });
  if (open !== adoptedFor.open || jobs !== adoptedFor.jobs) {
    setAdoptedFor({ open, jobs });
    if (open && !adoptedFor.open) {
      setSelectedJobIds([]);
      setAttempted(false);
    } else if (open) {
      setSelectedJobIds((current) => current.filter((jobId) => jobs.some((job) => job.id === jobId)));
    }
  }

  const jobsError = attempted && selectedJobIds.length === 0 ? JOBS_REQUIRED_MESSAGE : undefined;

  const handleSave = async () => {
    if (selectedJobIds.length === 0) {
      setAttempted(true);
      focusFirstInvalidField({ [JOBS_FIELD_ID]: JOBS_REQUIRED_MESSAGE });
      return;
    }
    await onSave(selectedJobIds);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isSaving}>
      <DialogContent size="md" className="overflow-visible sm:top-[47%] sm:translate-y-[-47%]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="Aufträge" hideLabel htmlFor={JOBS_FIELD_ID} error={jobsError}>
            <JobMultiSelect
              jobs={jobs}
              selectedIds={selectedJobIds}
              onSelectionChange={setSelectedJobIds}
              disabled={isSaving}
            />
          </Field>

          {loadError ? (
            <OptionsLoadError error={loadError} onRetry={onRetry} retrying={isLoading} />
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Es sind keine verfügbaren Aufträge ohne Projekt vorhanden.
            </p>
          ) : null}

          <ErrorText>{saveError}</ErrorText>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={isSaving || isLoading || Boolean(loadError)}>
              {(isSaving || isLoading) && <Loader2 className="mr-2 size-4 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
