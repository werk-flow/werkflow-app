import type { ActionResult } from '@/lib/action-result';
import type { AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { logError } from '@/lib/logging';

export type ProfileNameFields = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

export function formatProfileName(profile: ProfileNameFields): string {
  return [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || 'Unbekannt';
}

export type ManagerAssigneeOption = {
  userId: string;
  name: string;
};

// Admin/Büro members of the organization as selectable responsible persons.
// Requests are an office surface, so employees are deliberately excluded.
//
// Two-step lookup on purpose: organization_members has no direct foreign key
// to profiles (both only reference auth.users), so a PostgREST embed
// `profiles(...)` fails with a missing-relationship error and would silently
// empty this list. A failed read is `load_failed`, never an empty list.
export async function getManagerAssigneeOptions(
  admin: AdminClient,
  orgId: string,
): Promise<ActionResult<{ options: ManagerAssigneeOption[] }, 'load_failed'>> {
  const { data: members, error: membersError } = await admin
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', orgId)
    .in('role', ['admin', 'buero']);
  if (membersError) {
    logError('Failed to load manager assignee members:', membersError);
    return { success: false, error: 'load_failed' };
  }

  const userIds = members.map((member) => member.user_id);
  if (userIds.length === 0) return { success: true, options: [] };

  const { data: profiles, error: profilesError } = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (profilesError) {
    logError('Failed to load manager assignee profiles:', profilesError);
    return { success: false, error: 'load_failed' };
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const options = members
    .map((member) => {
      const profile = profileById.get(member.user_id) ?? null;
      return {
        userId: member.user_id,
        name: profile ? formatProfileName(profile) : 'Unbekannt',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { success: true, options };
}

/** Avatar initials; a missing name part contributes nothing. */
export function getInitials(firstName: string | null, lastName: string | null): string {
  return `${firstName?.charAt(0) ?? ''}${lastName?.charAt(0) ?? ''}`.toUpperCase();
}
