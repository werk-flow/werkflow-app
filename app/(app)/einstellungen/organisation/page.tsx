import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { OrganizationSettingsForm } from '@/components/settings/organization-settings-form';
import { getCachedMemberships, getCachedUser } from '@/lib/data/cached';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function OrganizationSettingsPage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

  if (!user) {
    redirect('/login');
  }

  const memberships = await getCachedMemberships(user.id);
  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);
  const activeMembership =
    memberships.find((membership) => membership.orgId === activeOrgId) ??
    memberships[0] ??
    null;

  if (!activeMembership) {
    redirect('/dashboard');
  }

  const supabase = await createSupabaseServerClient();
  const { data: organization, error } = await supabase
    .from('organizations')
    .select('id, name, unique_code, created_at')
    .eq('id', activeMembership.orgId)
    .single();

  if (error || !organization) {
    redirect('/dashboard');
  }

  const createdAtLabel = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'long',
  }).format(new Date(organization.created_at));

  return (
    <OrganizationSettingsForm
      initialOrganization={{
        name: organization.name,
        uniqueCode: organization.unique_code,
        createdAtLabel,
        role: activeMembership.role,
      }}
    />
  );
}
