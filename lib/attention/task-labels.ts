// The labels and links that several attention task derivations share.

import { formatProfileName } from '@/lib/members/profile-name';
import type { Tables } from '@/lib/supabase/database.types';

type WorkTargetJob = Pick<Tables<'jobs'>, 'title' | 'description' | 'job_number'>;
type WorkTargetProject = Pick<Tables<'projects'>, 'name' | 'description' | 'project_number'>;

/** The page of the job, else of the project, else the work list. */
export function workTargetHref(
  job: WorkTargetJob | undefined,
  project: WorkTargetProject | undefined,
): string {
  return job?.job_number
    ? `/auftraege/${encodeURIComponent(job.job_number)}`
    : project?.project_number
      ? `/auftraege/projekt/${encodeURIComponent(project.project_number)}`
      : '/auftraege';
}

export function workTargetLabel(
  job: WorkTargetJob | undefined,
  project: WorkTargetProject | undefined,
): string {
  return (
    job?.title.trim() ||
    job?.description?.trim() ||
    project?.name.trim() ||
    project?.description?.trim() ||
    'Arbeit'
  );
}

/** The display name of each employee record: the member's profile name, else the record's own. */
export function recordDisplayNames(
  records: Array<Pick<Tables<'employee_records'>, 'id' | 'user_id' | 'first_name' | 'last_name'>>,
  profiles: Array<Pick<Tables<'profiles'>, 'id' | 'first_name' | 'last_name' | 'email'>>,
): Map<string, string> {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return new Map(
    records.map((row) => {
      const profile = row.user_id ? profileById.get(row.user_id) : undefined;
      return [
        row.id,
        (profile ? formatProfileName(profile) : null) ||
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          'Unbenannt',
      ];
    }),
  );
}
