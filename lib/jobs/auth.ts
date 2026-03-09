import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import type { OrgRole } from './types';
import { MANAGER_ROLES } from './types';

export type AuthContext = {
  userId: string;
  orgId: string;
  role: OrgRole;
  isManagerOrAbove: boolean;
};

type AuthResult =
  | { success: true; context: AuthContext }
  | { success: false; error: string };

/**
 * Shared auth + org + role resolution for all jobs/projects/clients actions.
 * Returns the caller's identity, active org, and role in one call.
 */
export async function authenticateAndAuthorize(): Promise<AuthResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const cookieStore = await cookies();
  const orgId = await resolveActiveOrgId(cookieStore, user.id);

  if (!orgId) {
    return { success: false, error: 'no_active_org' };
  }

  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .single();

  if (membershipError || !membership) {
    return { success: false, error: 'not_a_member' };
  }

  const role = membership.role as OrgRole;

  return {
    success: true,
    context: {
      userId: user.id,
      orgId,
      role,
      isManagerOrAbove: MANAGER_ROLES.includes(role),
    },
  };
}
