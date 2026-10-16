'use client';

import { useEffect, useState } from 'react';
import { readInBackground } from '@/lib/data/background-read-client';
import type { ProjectJobPageResult } from '@/lib/jobs/list-actions';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import { describeFailure } from '@/lib/action-messages';

/** The project job page's own failures; the shared codes come from `describeFailure`. */
const PROJECT_JOB_PAGE_MESSAGES = {
  project_jobs_load_failed: 'Aufträge konnten nicht geladen werden.',
  project_clients_load_failed: 'Kunden konnten nicht geladen werden.',
} as const;

export function useProjectJobPage(
  project: ProjectWithDetails,
  expanded: boolean,
  initialJobs: Job[],
  enabled: boolean,
) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{
    project: ProjectWithDetails;
    page: number;
    attempt: number;
    result: ProjectJobPageResult;
  } | null>(null);
  const result = response?.result;
  const isCurrentResponse =
    response?.project === project && response.page === page && response.attempt === attempt;
  const busy = expanded && enabled && !isCurrentResponse;
  useEffect(() => {
    if (!expanded || !enabled) return;
    const controller = new AbortController();
    // The background read never rejects; its transport failure reads as a failed page.
    void readInBackground('project-job-page', { projectId: project.id, page }, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return;
        const result: ProjectJobPageResult =
          !response.success && response.error === 'background_read_failed'
            ? { success: false, error: 'project_jobs_load_failed' }
            : response;
        setResponse({ project, page, attempt, result });
      },
    );
    return () => controller.abort();
  }, [project, expanded, enabled, page, attempt]);
  return {
    jobs: enabled && result?.success ? result.jobs : initialJobs,
    total: result?.success ? result.total : project.jobCount,
    clientMap: result?.success ? result.clientMap : {},
    assignmentMap: result?.success ? result.assignmentMap : {},
    // Last-known rows stay visible while the next page loads; a retry hides the old error until it answers.
    page,
    setPage,
    busy,
    error:
      isCurrentResponse && result?.success === false
        ? describeFailure(
            result.error,
            PROJECT_JOB_PAGE_MESSAGES,
            PROJECT_JOB_PAGE_MESSAGES.project_jobs_load_failed,
          )
        : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
