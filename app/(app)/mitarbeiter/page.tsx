import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { InviteDialog } from '@/components/mitarbeiter/invite-dialog';
import { MitarbeiterTabs } from '@/components/mitarbeiter/mitarbeiter-tabs';
import { ActionBanner } from '@/components/shared/action-banner';
import type { OrgMember } from '@/components/mitarbeiter/members-table';
import type { Invite } from '@/components/mitarbeiter/invitations-table';
import type { OrgRole } from '@/lib/members/actions';

export default async function MitarbeiterPage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies()
  ]);

  if (!user) {
    redirect('/login');
  }

  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

  if (!activeOrgId) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Mitarbeiter</h1>
        <p className="mt-4 text-muted-foreground">
          Bitte wähle zuerst eine Organisation aus.
        </p>
      </div>
    );
  }

  const memberships = await getCachedMemberships(user.id);
  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);

  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'manager';

  if (!isAdminOrManager) {
    redirect('/dashboard');
  }

  // Fetch members and invites in parallel
  const supabase = await createSupabaseServerClient();

  const [membersResult, invitesResult] = await Promise.all([
    supabase.rpc('get_org_members', { p_org_id: activeOrgId }),
    supabase
      .from('organization_invites')
      .select(
        'id, email, status, created_at, expires_at, accepted_at, invited_role'
      )
      .eq('organization_id', activeOrgId)
      .order('created_at', { ascending: false })
  ]);

  if (membersResult.error) {
    console.error('Error fetching members:', membersResult.error);
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Mitarbeiter</h1>
        <p className="mt-4 text-destructive">
          Fehler beim Laden der Mitarbeiter:{' '}
          {membersResult.error.message || 'Unbekannter Fehler'}
        </p>
      </div>
    );
  }

  if (invitesResult.error) {
    console.error('Error fetching invites:', invitesResult.error);
  }

  const memberList = (membersResult.data as OrgMember[]) || [];
  const inviteList = (invitesResult.data as Invite[]) || [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Suspense fallback={null}>
        <ActionBanner
          paramKey="removed_member"
          messageTemplate='„{name}" wurde aus der Organisation entfernt.'
        />
      </Suspense>
      <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4 sticky top-0 z-10 shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">Mitarbeiter</h1>
        <InviteDialog />
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <MitarbeiterTabs
          members={memberList}
          invites={inviteList}
          currentUserId={user.id}
          currentUserRole={currentUserRole!}
          organizationId={activeOrgId}
        />
      </div>
    </div>
  );
}
