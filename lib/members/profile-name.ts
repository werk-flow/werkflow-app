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
export async function getManagerAssigneeOptions(
  admin: AdminClient,
  orgId: string
): Promise<ManagerAssigneeOption[]> {
  const { data } = await admin
    .from('organization_members')
    .select('user_id, role, profiles(first_name, last_name, email)')
    .eq('organization_id', orgId)
    .in('role', ['admin', 'buero']);

  return (data ?? [])
    .map((member) => {
      // supabase-js types embedded to-one relations inconsistently; accept
      // both the object and single-element-array shapes.
      const raw = member.profiles as unknown;
      const profile = (Array.isArray(raw) ? (raw[0] ?? null) : raw) as
        | ProfileNameFields
        | null;
      return {
        userId: member.user_id,
        name: profile ? formatProfileName(profile) : 'Unbekannt',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
