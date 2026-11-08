'use client';

import { useCallback, useState } from 'react';

import type { useBanner } from '@/components/ui/banner';
import type { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useServerAction } from '@/hooks/use-server-action';
import { createJob } from '@/lib/jobs/actions';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
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
import { isPlanningWarning, type RetryWithPlanningApproval } from '../forms/planning-warning-result';
import {
  CREATE_PROJECT_ERROR_MESSAGES,
  linkJobsToProject,
  projectCreatedBanner,
  type CreateProjectSubmission,
} from '../forms/create-project-submission';
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
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  insertJob: ReturnType<typeof useOptimisticList<Job>>['insert'];
  rollbackJob: ReturnType<typeof useOptimisticList<Job>>['rollback'];
  insertProject: ReturnType<typeof useOptimisticList<ProjectWithDetails>>['insert'];
  rollbackProject: ReturnType<typeof useOptimisticList<ProjectWithDetails>>['rollback'];
};

type AuftraegeProjectCreateOptions = Pick<
  AuftraegeCreateActionsOptions,
  'showBanner' | 'insertProject' | 'rollbackProject' | 'handleProjectCreated'
>;

/** The deferred project create: pending row, server call, job links, rollback. */
function useAuftraegeProjectCreate({
  showBanner,
  insertProject,
  rollbackProject,
  handleProjectCreated,
}: AuftraegeProjectCreateOptions) {
  return useCallback(
    async (submission: CreateProjectSubmission) => {
      const tempId = `pending-project-${crypto.randomUUID()}`;
      insertProject(tempId, buildProjectDraft(tempId, submission.input));
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
    [handleProjectCreated, insertProject, rollbackProject, showBanner],
  );
}

type JobCreateOutcome = Awaited<ReturnType<typeof createJob>>;

/** The pending row's end after the server answered: created, waiting for a confirm, taken back or refused. */
function settleJobCreate(
  outcome: JobCreateOutcome,
  pending: CreateJobSubmission & { tempId: string },
  {
    setJobCreateAwaitingApproval,
    rollbackJob,
    showBanner,
    handleJobCreated,
  }: Pick<AuftraegeCreateActionsOptions, 'rollbackJob' | 'showBanner' | 'handleJobCreated'> & {
    setJobCreateAwaitingApproval: (awaiting: JobCreateAwaitingApproval | null) => void;
  },
): void {
  if (
    !outcome.success &&
    (outcome.error === 'qualification_warning' || outcome.error === 'stale_evaluation') &&
    'evaluation' in outcome
  ) {
    // The confirm step runs at list level; the pending row stays until the user decides.
    setJobCreateAwaitingApproval({ ...pending, evaluation: outcome.evaluation });
    return;
  }
  setJobCreateAwaitingApproval(null);
  rollbackJob(pending.tempId);
  if (outcome.success) {
    handleJobCreated({ job: outcome.job, assignedUserIds: pending.assignedUserIds });
    showBanner({ variant: 'success', message: 'Auftrag erfolgreich erstellt!' });
  } else if (isPlanningWarning(outcome)) {
    // Taken back in the planning dialog: nothing was created.
    showBanner({ variant: 'info', message: JOB_NOT_CREATED });
  } else {
    showBanner({
      variant: 'error',
      message: createFailureMessage(CREATE_JOB_ERROR_MESSAGES, outcome.error, JOB_NOT_CREATED),
    });
  }
}

/** Deferred creates from the dialog: pending row, server call, qualification and planning confirms, rollback. */
export function useAuftraegeCreateActions({
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
    async (
      pending: CreateJobSubmission & { tempId: string },
      approval: AssignmentApproval | null,
      // The planning confirm step, from the lazily loaded create dialogs.
      retryWithPlanningApproval: RetryWithPlanningApproval,
    ) => {
      const settle = (outcome: JobCreateOutcome) =>
        settleJobCreate(outcome, pending, {
          setJobCreateAwaitingApproval,
          rollbackJob,
          showBanner,
          handleJobCreated,
        });
      try {
        settle(
          await retryWithPlanningApproval((planningApproval) =>
            runCreateJob({ ...pending.input, assignmentApproval: approval, planningApproval }),
          ),
        );
      } catch {
        settle({ success: false, error: 'unexpected_error' });
      }
    },
    [handleJobCreated, rollbackJob, runCreateJob, showBanner],
  );

  const handleJobSubmit = useCallback(
    (submission: CreateJobSubmission, retryWithPlanningApproval: RetryWithPlanningApproval) => {
      const tempId = `pending-job-${crypto.randomUUID()}`;
      insertJob(tempId, buildJobDraft(tempId, submission.input));
      void runJobCreate({ ...submission, tempId }, null, retryWithPlanningApproval);
    },
    [insertJob, runJobCreate],
  );

  const handleJobCreateCancel = useCallback(() => {
    if (!jobCreateAwaitingApproval) return;
    rollbackJob(jobCreateAwaitingApproval.tempId);
    setJobCreateAwaitingApproval(null);
    showBanner({ variant: 'info', message: JOB_NOT_CREATED });
  }, [jobCreateAwaitingApproval, rollbackJob, showBanner]);

  const handleProjectSubmit = useAuftraegeProjectCreate({
    showBanner,
    insertProject,
    rollbackProject,
    handleProjectCreated,
  });

  return {
    isCreatingJob,
    jobCreateAwaitingApproval,
    runJobCreate,
    handleJobSubmit,
    handleJobCreateCancel,
    handleProjectSubmit,
  };
}
