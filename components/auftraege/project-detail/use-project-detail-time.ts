'use client';

import { useMemo } from 'react';

import { useLiveView } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import { getJobDisplayTitle, type Job } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { calculateWorkSessions } from '@/lib/time-tracking/validation';

/** Live time entries of every job in the project and their per-job totals. */
export function useProjectDetailTime(projectId: string, liveJobs: Job[]) {
  const timeView = useLiveView<{ jobId: string; jobTitle: string; entries: TimeEntry[] }[]>({
    tables: ['time_entries', 'time_sessions', 'time_segments'],
    // Reads over GET, outside the Server Action queue the project's saves use.
    read: async ({ signal }) => {
      const result = await readInBackground('project-job-time-entries', { projectId }, signal);
      if (!result.success) return { ok: false, error: result.error };
      const entriesByJobId = new Map(result.jobs.map((job) => [job.jobId, job.entries]));
      return {
        ok: true,
        data: liveJobs.map((job) => ({
          jobId: job.id,
          jobTitle: getJobDisplayTitle(job),
          entries: entriesByJobId.get(job.id) ?? [],
        })),
      };
    },
    resetKey: liveJobs
      .map((job) => job.id)
      .sort()
      .join(','),
  });
  const projectTimeEntries = useMemo(() => timeView.data ?? [], [timeView.data]);
  const isLoadingTime = timeView.isLoading;
  // Only a read that never produced data is a load error; a failed refresh
  // keeps the totals and marks them stale (freshness contract rule 5).
  const timeLoadError = !isLoadingTime && timeView.data === undefined;

  const projectTimeSummary = useMemo(() => {
    let totalMinutes = 0;
    const perJob: Array<{
      jobId: string;
      title: string;
      minutes: number;
      plannedWorkingMinutes: number | null;
    }> = [];
    const jobLookup = new Map(liveJobs.map((job) => [job.id, job]));

    for (const { jobId, jobTitle, entries } of projectTimeEntries) {
      const entriesByUser: Record<string, TimeEntry[]> = {};
      for (const e of entries) {
        const userEntries = entriesByUser[e.userId];
        if (userEntries) userEntries.push(e);
        else entriesByUser[e.userId] = [e];
      }
      const sessions = Object.values(entriesByUser)
        .flatMap((ue) => calculateWorkSessions(ue))
        .filter((s) => s.clockIn && s.clockOut);

      const jobMin = sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
      totalMinutes += jobMin;
      if (jobMin > 0) {
        perJob.push({
          jobId,
          title: jobTitle,
          minutes: jobMin,
          plannedWorkingMinutes: jobLookup.get(jobId)?.plannedWorkingMinutes ?? null,
        });
      }
    }

    return { totalMinutes, perJob: perJob.sort((a, b) => b.minutes - a.minutes) };
  }, [liveJobs, projectTimeEntries]);

  return {
    timeView,
    projectTimeEntries,
    projectTimeSummary,
    isLoadingTime,
    timeLoadError,
  };
}
