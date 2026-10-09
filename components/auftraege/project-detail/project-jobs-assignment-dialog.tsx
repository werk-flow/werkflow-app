'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { JobMultiSelect } from '../shared/job-multi-select';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

const JOBS_FIELD_ID = 'project-jobs-assignment-jobs';
const JOBS_REQUIRED_MESSAGE = 'Bitte wähle mindestens einen Auftrag aus.';

interface ProjectJobsAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  isSaving?: boolean;
  saveError?: string | null;
  /** Resolves with the jobs that were linked; they leave the selection. */
  onSave: (jobIds: string[]) => Promise<string[]>;
}

/**
 * Adds jobs to a project. The choices are searched on the server: every job
 * without a project that is not finished.
 */
export function ProjectJobsAssignmentDialog({
  open,
  onOpenChange,
  title = 'Aufträge zuweisen',
  isSaving = false,
  saveError,
  onSave,
}: ProjectJobsAssignmentDialogProps) {
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const jobSearch = useJobEntityOptions({ kind: 'jobs', purpose: 'project-jobs' }, selectedJobIds);

  // Set during render, never in an effect: every opening starts from a clean selection.
  const [adoptedOpen, setAdoptedOpen] = useState(false);
  if (open !== adoptedOpen) {
    setAdoptedOpen(open);
    if (open) {
      setSelectedJobIds([]);
      setAttempted(false);
    }
  }

  const jobsError = attempted && selectedJobIds.length === 0 ? JOBS_REQUIRED_MESSAGE : undefined;

  const handleSave = async () => {
    if (selectedJobIds.length === 0) {
      setAttempted(true);
      focusFirstInvalidField({ [JOBS_FIELD_ID]: JOBS_REQUIRED_MESSAGE });
      return;
    }
    const linkedJobIds = new Set(await onSave(selectedJobIds));
    // A partial failure keeps only the jobs that still need a retry.
    setSelectedJobIds((current) => current.filter((jobId) => !linkedJobIds.has(jobId)));
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
              search={jobSearch}
              selectedIds={selectedJobIds}
              onSelectionChange={setSelectedJobIds}
              disabled={isSaving}
            />
          </Field>

          <ErrorText>{saveError}</ErrorText>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Abbrechen
            </Button>
            <Button pending={isSaving} onClick={handleSave} disabled={isSaving}>
              Speichern
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
