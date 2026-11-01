import { formatProfileName } from '@/lib/members/profile-name';

export function profileName(
  profile: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null,
): string {
  return profile ? formatProfileName(profile) : 'Nicht erfasst';
}

export function firstRelation<T>(relation: T | T[] | null): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}

/** A job's detail route under its project when it has one; null while the job has no number. */
export function customerJobHref(
  jobNumber: string | null,
  projectNumber: string | null | undefined,
): string | null {
  if (!jobNumber) return null;
  return projectNumber
    ? `/auftraege/projekt/${encodeURIComponent(projectNumber)}/${encodeURIComponent(jobNumber)}`
    : `/auftraege/${encodeURIComponent(jobNumber)}`;
}
