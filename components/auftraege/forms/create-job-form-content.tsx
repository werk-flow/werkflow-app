'use client';

import { Button } from '@/components/ui/button';
import { useReportPending } from '@/hooks/use-report-pending';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { QualificationWarningDialog } from '../shared/qualification-warning-dialog';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';
import type { CalendarEntryDraft } from '@/components/kalender/calendar-entry-draft';
import {
  CreateJobAssignmentFields,
  CreateJobBasicsFields,
  CreateJobPlanningFields,
} from './create-job-form-sections';
import type { CreateJobSubmission } from './create-job-submission';
import { useCreateJobForm } from './use-create-job-form';

export type { CreateJobSubmission };

export interface CreateJobFormContentProps {
  clients: Client[];
  members: OrgMemberOption[];
  projects?: ProjectWithDetails[] | undefined;
  initialJobNumber?: string | null | undefined;
  defaultProjectId?: string | undefined;
  defaultClientId?: string | undefined;
  defaultEmployeeIds?: string[] | undefined;
  readOnlyClient?: boolean | undefined;
  readOnlyProject?: boolean | undefined;
  defaultDate?: Date | undefined;
  defaultTime?: string | undefined;
  defaultDurationHours?: string | undefined;
  onSuccess?: (payload: { job: Job; assignedUserIds: string[] }) => void | Promise<void>;
  onDraftChange?: ((draft: CalendarEntryDraft | null) => void) | undefined;
  /**
   * Deferred submit (feedback canon, create from a dialog): the form hands the
   * validated input over instead of awaiting the server, so the caller closes
   * the dialog at once and shows a pending row. The caller then owns the
   * result — the qualification confirm step, the banners, the rollback.
   */
  onSubmitDeferred?: ((submission: CreateJobSubmission) => void) | undefined;
  /** Whether the form is active/visible. Controls data-fetching effects. Defaults to true. */
  isActive?: boolean | undefined;
  /** Reports the running create call, so the surrounding dialog stays open until it answers. */
  onPendingChange?: ((pending: boolean) => void) | undefined;
}

export function CreateJobFormContent({
  clients,
  members,
  readOnlyProject,
  onPendingChange,
  ...formOptions
}: CreateJobFormContentProps) {
  const form = useCreateJobForm({ clients, ...formOptions });
  const { isLoading } = form;

  useReportPending(isLoading, onPendingChange);

  return (
    <>
      <form onSubmit={form.handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="grid gap-4 py-2">
          <CreateJobBasicsFields form={form} />

          <CreateJobAssignmentFields form={form} clients={clients} readOnlyProject={readOnlyProject} />

          <CreateJobPlanningFields form={form} members={members} />

          <ErrorText>{form.error}</ErrorText>
        </DialogBody>
        <DialogFooter>
          <Button pending={isLoading} type="submit" disabled={form.submitDisabled}>
            {isLoading ? 'Wird erstellt…' : 'Auftrag erstellen'}
          </Button>
        </DialogFooter>
      </form>
      <QualificationWarningDialog
        evaluation={form.qualificationWarning}
        isSubmitting={isLoading}
        onCancel={() => form.setQualificationWarning(null)}
        onConfirm={form.submitJob}
      />
    </>
  );
}
