/**
 * Detail routes of jobs and projects. The database assigns the number on
 * insert; the id stands in only while an optimistic draft has none yet.
 */
export function projectDetailHref(project: { id: string; projectNumber: string | null }): string {
  return `/auftraege/projekt/${encodeURIComponent(project.projectNumber ?? project.id)}`;
}

export function jobDetailHref(
  job: { id: string; jobNumber: string | null },
  project?: { id: string; projectNumber: string | null } | null,
): string {
  const jobSegment = encodeURIComponent(job.jobNumber ?? job.id);
  return project ? `${projectDetailHref(project)}/${jobSegment}` : `/auftraege/${jobSegment}`;
}
