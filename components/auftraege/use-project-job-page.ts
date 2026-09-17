'use client';

import { useEffect, useState } from 'react';
import { getProjectJobPage, type ProjectJobPageResult } from '@/lib/jobs/list-actions';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';

export function useProjectJobPage(project: ProjectWithDetails, expanded: boolean, initialJobs: Job[], enabled: boolean) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{ project: ProjectWithDetails; page: number; attempt: number; result: ProjectJobPageResult } | null>(null);
  const result = response?.result;
  const isCurrentResponse = response?.project === project && response.page === page && response.attempt === attempt;
  const busy = expanded && enabled && !isCurrentResponse;
  useEffect(() => {
    if (!expanded || !enabled) return;
    let cancelled = false;
    void getProjectJobPage({ projectId: project.id, page }).then((response) => {
      if (!cancelled) setResponse({ project, page, attempt, result: response });
    }).catch(() => { if (!cancelled) setResponse({ project, page, attempt, result: { success: false, error: 'Aufträge konnten nicht geladen werden.' } }); });
    return () => { cancelled = true; };
  }, [project, expanded, enabled, page, attempt]);
  return { jobs: enabled && result?.success ? result.jobs : initialJobs, total: result?.success ? result.total : project.jobCount,
    clientMap: result?.success ? result.clientMap : {}, assignmentMap: result?.success ? result.assignmentMap : {},
    // Last-known rows stay visible while the next page loads; a retry hides the old error until it answers.
    page, setPage, busy, error: isCurrentResponse && result?.success === false ? result.error : null, retry: () => setAttempt((value) => value + 1) };
}
