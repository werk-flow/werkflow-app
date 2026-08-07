import type { createSupabaseAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type ProfileNameFields = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

export function formatProfileName(profile: ProfileNameFields): string {
  return (
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
    profile.email ||
    'Unbekannt'
  );
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
// `profiles(...)` fails with a missing-relationship error — which silently
// emptied this list from P1-02 until the GG-02 gate caught it.
export async function getManagerAssigneeOptions(
  admin: AdminClient,
  orgId: string
): Promise<ManagerAssigneeOption[]> {
  const { data: members, error: membersError } = await admin
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', orgId)
    .in('role', ['admin', 'buero']);
  if (membersError) {
    console.error('Failed to load manager assignee members:', membersError);
    return [];
  }

  const userIds = (members ?? []).map((member) => member.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, first_name, last_name, email')
    .in('id', userIds);
  if (profilesError) {
    console.error('Failed to load manager assignee profiles:', profilesError);
    return [];
  }

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile])
  );
  return (members ?? [])
    .map((member) => {
      const profile = profileById.get(member.user_id) ?? null;
      return {
        userId: member.user_id,
        name: profile ? formatProfileName(profile) : 'Unbekannt',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
