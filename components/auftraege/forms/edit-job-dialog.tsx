'use client';

import { Loader2 } from 'lucide-react';

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
import { ErrorText } from '@/components/ui/error-text';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { OptionsLoadError } from '../shared/options-load-error';

import { ParkConfirmationDialog } from './park-confirmation-dialog';
import { QualificationWarningDialog } from '../shared/qualification-warning-dialog';
import { getJobDisplayTitle, type Client, type Job, type ProjectWithDetails } from '@/lib/jobs/types';
import {
  EditJobAssignmentFields,
  EditJobIdentityFields,
  EditJobPlanningFields,
} from './edit-job-form-fields';
import { useEditJobForm } from './use-edit-job-form';
import { useEditJobSubmit } from './use-edit-job-submit';

interface EditJobDialogProps {
  job: Job;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  members: OrgMemberOption[];
  projects?: ProjectWithDetails[];
  /** The on-demand option load: a failure shows with a retry instead of empty lists. */
  optionsLoad?: { error: string | null; retry: () => void; isLoading: boolean } | undefined;
  onSuccess?: ((payload: { job: Job; selectedEmployeeIds?: string[] }) => void | Promise<void>) | undefined;
}

export function EditJobDialog({
  job,
  open,
  onOpenChange,
  clients,
  members,
  projects = [],
  optionsLoad,
  onSuccess,
}: EditJobDialogProps) {
  const form = useEditJobForm({ job, open, clients, projects });
  const { submitChanges, handleSubmit } = useEditJobSubmit({
    job,
    form,
    onOpenChange,
    onSuccess,
  });
  const {
    jobNumber,
    title,
    description,
    isLoading,
    error,
    submitDisabled,
    showAutoParkDialog,
    setShowAutoParkDialog,
    qualificationWarning,
    setQualificationWarning,
    confirmedDateRemovalForWarning,
    setConfirmedDateRemovalForWarning,
  } = form;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} pending={isLoading}>
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Auftrag bearbeiten</DialogTitle>
            <DialogDescription>Ändere die Daten des Auftrags.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="grid gap-4 py-2">
              <EditJobIdentityFields form={form} />

              <EditJobAssignmentFields form={form} clients={clients} />

              <EditJobPlanningFields form={form} members={members} />

              {optionsLoad && (
                <OptionsLoadError
                  error={optionsLoad.error}
                  onRetry={optionsLoad.retry}
                  retrying={optionsLoad.isLoading}
                />
              )}
              <ErrorText>{error}</ErrorText>
            </DialogBody>
            <DialogFooter>
              <Button type="submit" disabled={submitDisabled}>
                {isLoading && <Loader2 className="size-4 animate-spin" />}
                {isLoading ? 'Wird gespeichert…' : 'Speichern'}
              </Button>
            </DialogFooter>
          </form>

          <ParkConfirmationDialog
            open={showAutoParkDialog}
            onOpenChange={setShowAutoParkDialog}
            variant="job"
            title={
              title.trim() || description.trim()
                ? getJobDisplayTitle({ title, description })
                : getJobDisplayTitle(job)
            }
            identifier={jobNumber.trim() || job.jobNumber || undefined}
            mode="auto-park-date-removal"
            onConfirm={() => submitChanges(true)}
          />
        </DialogContent>
      </Dialog>
      <QualificationWarningDialog
        evaluation={qualificationWarning}
        isSubmitting={isLoading}
        onCancel={() => {
          setQualificationWarning(null);
          setConfirmedDateRemovalForWarning(false);
        }}
        onConfirm={(approval) => submitChanges(confirmedDateRemovalForWarning, approval)}
      />
    </>
  );
}
