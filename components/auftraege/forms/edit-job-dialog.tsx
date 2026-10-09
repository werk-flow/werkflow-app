'use client';

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

import { ParkConfirmationDialog } from './park-confirmation-dialog';
import { QualificationWarningDialog } from '../shared/qualification-warning-dialog';
import { getJobDisplayTitle, type Job } from '@/lib/jobs/types';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import type { ClientSelectItem } from '../shared/client-select-with-create';
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
  /** The job's customer as the page shows it, labelled before the server answers. */
  selectedClient: ClientSelectItem | null;
  members: OrgMemberOption[];
  /** The job's project as the page shows it. */
  knownProject: JobEntityOption | undefined;
  onSuccess?: ((payload: { job: Job; selectedEmployeeIds?: string[] }) => void | Promise<void>) | undefined;
}

export function EditJobDialog({
  job,
  open,
  onOpenChange,
  selectedClient,
  members,
  knownProject,
  onSuccess,
}: EditJobDialogProps) {
  const form = useEditJobForm({ job, open, knownProject });
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

              <EditJobAssignmentFields form={form} selectedClient={selectedClient} />

              <EditJobPlanningFields form={form} members={members} />

              <ErrorText>{error}</ErrorText>
            </DialogBody>
            <DialogFooter>
              <Button pending={isLoading} type="submit" disabled={submitDisabled}>
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
