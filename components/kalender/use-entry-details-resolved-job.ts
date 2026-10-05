'use client';

import { useEffect, useState } from 'react';

import { getJobDisplayTitle } from '@/lib/jobs/types';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { WorkSession } from '@/lib/time-tracking/types';

export type EntryDetailsResolvedJob = {
  title: string;
  jobNumber: string | null;
  projectNumber: string | null;
};

/** Resolves the session's job title and detail link while the dialog is open. */
export function useEntryDetailsResolvedJob({
  open,
  session,
  jobName,
}: {
  open: boolean;
  session: WorkSession;
  jobName: string | null | undefined;
}): { resolvedJob: EntryDetailsResolvedJob | null; jobDetailUrl: string | null } {
  const [resolvedJob, setResolvedJob] = useState<EntryDetailsResolvedJob | null>(
    jobName ? { title: jobName, jobNumber: null, projectNumber: null } : null,
  );

  useEffect(() => {
    if (!open || !session.jobId) {
      if (!jobName) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- a closed dialog or a session without a job must not keep the previously resolved job
        setResolvedJob(null);
      }
      return;
    }

    let cancelled = false;
    createSupabaseBrowserClient()
      .from('jobs')
      .select('title, description, job_number, projects(project_number)')
      .eq('id', session.jobId)
      .single()
      .then(
        ({
          data,
        }: {
          data: {
            title: string;
            description: string | null;
            job_number: string | null;
            projects: { project_number: string } | null;
          } | null;
        }) => {
          if (!cancelled && data) {
            setResolvedJob({
              title: getJobDisplayTitle({
                title: data.title,
                description: data.description,
              }),
              jobNumber: data.job_number,
              projectNumber: data.projects?.project_number ?? null,
            });
          }
        },
      );

    return () => {
      cancelled = true;
    };
  }, [jobName, open, session.jobId]);

  const jobDetailUrl = resolvedJob?.jobNumber
    ? resolvedJob.projectNumber
      ? `/auftraege/projekt/${resolvedJob.projectNumber}/${resolvedJob.jobNumber}`
      : `/auftraege/${resolvedJob.jobNumber}`
    : null;

  return { resolvedJob, jobDetailUrl };
}
