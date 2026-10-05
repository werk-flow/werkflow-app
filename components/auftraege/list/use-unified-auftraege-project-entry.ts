'use client';

import { useActiveJobs } from '@/hooks/use-active-jobs';
import {
  calculateTrafficLightFromCounts,
  getEffectiveProjectStatusFromCounts,
  type Job,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
import { useProjectJobPage } from './use-project-job-page';

type UnifiedAuftraegeProjectEntryOptions = {
  project: ProjectWithDetails;
  expanded: boolean;
  initialChildJobs: Job[];
  pagedChildren: boolean;
  projectAssignedUserIds: string[] | undefined;
  initialClientMap: Record<string, string>;
  initialAssignmentMap: Record<string, string[]>;
  activeJobIds: Set<string>;
};

/** Child-job page and derived status values shared by a project's table row and its mobile card. */
export function useUnifiedAuftraegeProjectEntry({
  project,
  expanded,
  initialChildJobs,
  pagedChildren,
  projectAssignedUserIds,
  initialClientMap,
  initialAssignmentMap,
  activeJobIds,
}: UnifiedAuftraegeProjectEntryOptions) {
  const { activeProjectIds } = useActiveJobs();
  const childPage = useProjectJobPage(project, expanded, initialChildJobs, pagedChildren);
  const childJobs = childPage.jobs;
  const clientMap = { ...initialClientMap, ...childPage.clientMap };
  const jobAssignmentMap = { ...initialAssignmentMap, ...childPage.assignmentMap };
  const effectiveStatus = project.statusOverride ?? getEffectiveProjectStatusFromCounts(project);
  const progress =
    project.jobCount > 0 ? Math.round((project.completedJobCount / project.jobCount) * 100) : 0;
  const trafficLight = calculateTrafficLightFromCounts(project, project.jobCount, project.completedJobCount);

  // A paged child list is one page, never the project's assignee universe.
  const allProjectUserIds =
    projectAssignedUserIds ??
    (pagedChildren ? [] : [...new Set(childJobs.flatMap((j) => jobAssignmentMap[j.id] ?? []))]);
  const hasActiveWork = pagedChildren
    ? activeProjectIds.has(project.id)
    : childJobs.some((j) => activeJobIds.has(j.id));

  return {
    childPage,
    childJobs,
    clientMap,
    jobAssignmentMap,
    effectiveStatus,
    progress,
    trafficLight,
    allProjectUserIds,
    hasActiveWork,
  };
}
