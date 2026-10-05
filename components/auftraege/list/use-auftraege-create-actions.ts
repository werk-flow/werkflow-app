'use client';

import { useCallback, useState } from 'react';

import type { useBanner } from '@/components/ui/banner';
import type { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useServerAction } from '@/hooks/use-server-action';
import { createJob } from '@/lib/jobs/actions';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';
import { createProject } from '@/lib/projects/actions';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import {
  JOB_NOT_CREATED,
  PROJECT_NOT_CREATED,
  buildJobDraft,
  buildProjectDraft,
  createFailureMessage,
} from './auftraege-list-drafts';
import { CREATE_JOB_ERROR_MESSAGES, type CreateJobSubmission } from '../forms/create-job-submission';
import {
  CREATE_PROJECT_ERROR_MESSAGES,
  linkJobsToProject,
  projectCreatedBanner,
  type CreateProjectSubmission,
} from '../forms/create-project-form-content';
import type { useAuftraegeLocalUpdates } from './use-auftraege-local-updates';

/** A deferred job create the server answered with a qualification confirm step. */
type JobCreateAwaitingApproval = CreateJobSubmission & {
  tempId: string;
  evaluation: AssignmentEvaluation;
};

type AuftraegeCreateActionsOptions = Pick<
  ReturnType<typeof useAuftraegeLocalUpdates>,
  'handleJobCreated' | 'handleProjectCreated'
> & {
  clients: Client[];
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  insertJob: ReturnType<typeof useOptimisticList<Job>>['insert'];
  rollbackJob: ReturnType<typeof useOptimisticList<Job>>['rollback'];
  insertProject: ReturnType<typeof useOptimisticList<ProjectWithDetails>>['insert'];
  rollbackProject: ReturnType<typeof useOptimisticList<ProjectWithDetails>>['rollback'];
};

/** Deferred creates from the dialog: pending row, server call, qualification confirm, rollback. */
export function useAuftraegeCreateActions({
  clients,
  showBanner,
  insertJob,
  rollbackJob,
  insertProject,
  rollbackProject,
  handleJobCreated,
  handleProjectCreated,
}: AuftraegeCreateActionsOptions) {
  const { run: runCreateJob, isPending: isCreatingJob } = useServerAction(createJob);
  const [jobCreateAwaitingApproval, setJobCreateAwaitingApproval] =
    useState<JobCreateAwaitingApproval | null>(null);

  const runJobCreate = useCallback(
    async (pending: CreateJobSubmission & { tempId: string }, approval: AssignmentApproval | null) => {
      try {
        const result = await runCreateJob({
          ...pending.input,
          assignmentApproval: approval,
        });
        if (result.success) {
          setJobCreateAwaitingApproval(null);
          rollbackJob(pending.tempId);
          handleJobCreated({
            job: result.job,
            assignedUserIds: pending.assignedUserIds,
          });
          showBanner({ variant: 'success', message: 'Auftrag erfolgreich erstellt!' });
          return;
        }
        if (
          (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
          'evaluation' in result
        ) {
          // The confirm step runs at list level; the pending row stays until
          // the user decides.
          setJobCreateAwaitingApproval({ ...pending, evaluation: result.evaluation });
          return;
        }
        setJobCreateAwaitingApproval(null);
        rollbackJob(pending.tempId);
        showBanner({
          variant: 'error',
          message: createFailureMessage(CREATE_JOB_ERROR_MESSAGES, result.error, JOB_NOT_CREATED),
        });
      } catch {
        setJobCreateAwaitingApproval(null);
        rollbackJob(pending.tempId);
        showBanner({
          variant: 'error',
          message: createFailureMessage(CREATE_JOB_ERROR_MESSAGES, 'unexpected_error', JOB_NOT_CREATED),
        });
      }
    },
    [handleJobCreated, rollbackJob, runCreateJob, showBanner],
  );

  const handleJobSubmit = useCallback(
    (submission: CreateJobSubmission) => {
      const tempId = `pending-job-${crypto.randomUUID()}`;
      insertJob(tempId, buildJobDraft(tempId, submission.input));
      void runJobCreate({ ...submission, tempId }, null);
    },
    [insertJob, runJobCreate],
  );

  const handleJobCreateCancel = useCallback(() => {
    if (!jobCreateAwaitingApproval) return;
    rollbackJob(jobCreateAwaitingApproval.tempId);
    setJobCreateAwaitingApproval(null);
    showBanner({ variant: 'info', message: JOB_NOT_CREATED });
  }, [jobCreateAwaitingApproval, rollbackJob, showBanner]);

  const handleProjectSubmit = useCallback(
    async (submission: CreateProjectSubmission) => {
      const tempId = `pending-project-${crypto.randomUUID()}`;
      insertProject(tempId, buildProjectDraft(tempId, submission.input, clients));
      try {
        const result = await createProject(submission.input);
        if (!result.success) {
          rollbackProject(tempId);
          showBanner({
            variant: 'error',
            message: createFailureMessage(CREATE_PROJECT_ERROR_MESSAGES, result.error, PROJECT_NOT_CREATED),
          });
          return;
        }
        const failedLinkCount = await linkJobsToProject(result.project.id, submission.linkedJobIds);
        rollbackProject(tempId);
        handleProjectCreated({
          project: result.project,
          linkedJobIds: submission.linkedJobIds,
        });
        showBanner(projectCreatedBanner(failedLinkCount));
      } catch {
        rollbackProject(tempId);
        showBanner({
          variant: 'error',
          message: createFailureMessage(
            CREATE_PROJECT_ERROR_MESSAGES,
            'unexpected_error',
            PROJECT_NOT_CREATED,
          ),
        });
      }
    },
    [clients, handleProjectCreated, insertProject, rollbackProject, showBanner],
  );

  return {
    isCreatingJob,
    jobCreateAwaitingApproval,
    runJobCreate,
    handleJobSubmit,
    handleJobCreateCancel,
    handleProjectSubmit,
  };
}
